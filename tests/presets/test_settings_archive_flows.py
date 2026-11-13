"""The settings backup and restore flows, run in the presets layer with no route
and no HTTP request in front of them.

Each flow takes the connection manager and the description store. A backup is
the daemon's own ``/backup`` archive with this install's profile descriptions
riding along as one extra member; a restore folds a carried descriptions member
into the store and hands the daemon everything else exactly as it was uploaded.
The route-level wire contract of both is pinned in
``tests/presets/test_description_routes.py``; this file pins the same flows one
lane down, where a caller other than the route can run them.

The manager runs on the faithful fake 8088 daemon, and every reference for "the
daemon's own members" is read straight off that fake's ``GET /backup``, never
from another trip through HQPTuner, so a flow that mangled a member on every
call cannot agree with itself.
"""

import io
import json
import zipfile
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from virtual_clock import VirtualClock

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.conf.presetzip import DESCRIPTIONS_MEMBER, embed_descriptions
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.presets import archive
from hqptuner.presets.store.descriptions import DescriptionStore

NAME = "Living Room"
TEXT = "Wide stereo, gentle tilt below 200 Hz."
CARRIED = "warm"

#: A stamp left by an earlier write, far enough in the past that no write made
#: during a test run can land on it.
ANCIENT = "2000-01-01T00:00:00+00:00"

#: A carried descriptions member no HQPTuner can parse.
UNREADABLE = b"not json at all {"


def stamped(profiles: dict[str, dict[str, str]]) -> bytes:
    """A descriptions payload as another HQPTuner would have carried it."""
    return json.dumps({"schema": 1, "profiles": profiles}).encode()


def members(zip_bytes: bytes) -> dict[str, bytes]:
    """Every member of an archive by name; nothing at all for bytes that are not one."""
    if not zipfile.is_zipfile(io.BytesIO(zip_bytes)):
        return {}
    opened = zipfile.ZipFile(io.BytesIO(zip_bytes))
    return {name: opened.read(name) for name in opened.namelist()}


def carried_texts(zip_bytes: bytes) -> dict[str, str]:
    """The profile texts an archive's descriptions member carries, by name."""
    payload = members(zip_bytes).get(DESCRIPTIONS_MEMBER)
    if payload is None:
        return {}
    return {name: entry["text"] for name, entry in json.loads(payload)["profiles"].items()}


def stored_texts(store: DescriptionStore) -> dict[str, str]:
    return {name: entry["text"] for name, entry in store.read().items()}


def daemon_backup(http_daemon: dict[str, Any]) -> bytes:
    """The archive hqplayerd itself serves, read straight off the fake's own ``GET /backup``."""
    with httpx.Client(base_url=f"http://127.0.0.1:{http_daemon['_port']}") as raw:
        return raw.get("/backup/settings.zip").content


@pytest.fixture
def store(tmp_path: Path) -> DescriptionStore:
    return DescriptionStore(tmp_path / "descriptions.json")


@pytest.fixture
async def dead_lane_manager(closed_port: int, tmp_path: Path) -> AsyncIterator[ConnectionManager]:
    """A manager whose 8088 lane points at a port nothing serves."""
    http = HttpConfigClient("127.0.0.1", closed_port, "u", "p")
    manager = ConnectionManager(
        Config(alarm_threshold=1.0, backup_dir=tmp_path, preset_dir=tmp_path / "presets"), http, VirtualClock()
    )
    yield manager
    await manager.aclose()
    await http.aclose()


# --- backup ------------------------------------------------------------------------


async def test_a_backup_carries_the_stored_description_text(
    http_manager: ConnectionManager, store: DescriptionStore
) -> None:
    store.write(NAME, TEXT)
    assert carried_texts(await archive.backup(http_manager, store)).get(NAME) == TEXT


async def test_a_backup_leaves_the_daemons_own_members_byte_identical(
    http_manager: ConnectionManager, store: DescriptionStore, http_daemon: dict[str, Any]
) -> None:
    plain = members(daemon_backup(http_daemon))
    store.write(NAME, TEXT)
    carried = members(await archive.backup(http_manager, store))
    assert {name: body for name, body in carried.items() if name != DESCRIPTIONS_MEMBER} == plain


async def test_a_backup_of_an_empty_store_holds_exactly_the_daemons_members(
    http_manager: ConnectionManager, store: DescriptionStore, http_daemon: dict[str, Any]
) -> None:
    assert members(await archive.backup(http_manager, store)) == members(daemon_backup(http_daemon))


async def test_a_backup_that_cannot_reach_the_daemon_raises_the_lane_error(
    dead_lane_manager: ConnectionManager, store: DescriptionStore
) -> None:
    with pytest.raises(httpx.HTTPError):
        await archive.backup(dead_lane_manager, store)


# --- restore -----------------------------------------------------------------------


async def test_a_restore_merges_the_carried_descriptions_into_the_store(
    http_manager: ConnectionManager, store: DescriptionStore, http_daemon: dict[str, Any]
) -> None:
    upload = embed_descriptions(daemon_backup(http_daemon), stamped({NAME: {"text": CARRIED, "updated": ANCIENT}}))
    await archive.restore(http_manager, store, upload)
    assert stored_texts(store).get(NAME) == CARRIED


async def test_a_restore_hands_the_daemon_every_other_member_byte_identical(
    http_manager: ConnectionManager, store: DescriptionStore, http_daemon: dict[str, Any]
) -> None:
    plain = daemon_backup(http_daemon)
    upload = embed_descriptions(plain, stamped({NAME: {"text": CARRIED, "updated": ANCIENT}}))
    await archive.restore(http_manager, store, upload)
    assert members(http_daemon.get("_restore_bytes", b"")) == members(plain)


async def test_a_restore_with_no_carried_member_hands_the_daemon_the_upload_unchanged(
    http_manager: ConnectionManager, store: DescriptionStore, http_daemon: dict[str, Any]
) -> None:
    plain = daemon_backup(http_daemon)
    await archive.restore(http_manager, store, plain)
    assert http_daemon.get("_restore_bytes", b"") == plain


async def test_a_restore_with_an_unreadable_carried_member_still_hands_the_daemon_the_rest(
    http_manager: ConnectionManager, store: DescriptionStore, http_daemon: dict[str, Any]
) -> None:
    plain = daemon_backup(http_daemon)
    await archive.restore(http_manager, store, embed_descriptions(plain, UNREADABLE))
    assert members(http_daemon.get("_restore_bytes", b"")) == members(plain)


async def test_a_restore_that_cannot_reach_the_daemon_raises_the_lane_error(
    dead_lane_manager: ConnectionManager, store: DescriptionStore, http_daemon: dict[str, Any]
) -> None:
    upload = daemon_backup(http_daemon)
    with pytest.raises(httpx.HTTPError):
        await archive.restore(dead_lane_manager, store, upload)
