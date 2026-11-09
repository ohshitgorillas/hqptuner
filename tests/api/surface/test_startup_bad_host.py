"""A saved host that is not a daemon address never stops the start (docs/testing.md).

A record whose host fails the host rule is handled like a record that does not parse: the app starts without it, the
Connection panel is what the user meets, and the file stays on disk until a save replaces it. Either kind of record
counts as a host the user chose, so the start does not go looking for a daemon at the container's alias. The start's
outcome is taken as a value (the status ``/api/health`` answers, or the name of the exception the build raised) so a
start that fails is an assertion failure, not an error out of the fixture.
"""

import asyncio
import dataclasses
import functools
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import fake_network
import httpx
import pytest
from fake_network import NETWORK
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config

#: Where the container alias is pointed, with a fake that counts the dials made to it.
ALIAS_HOST = "127.0.0.3"

#: A host the 8088 client cannot build a URL from, as a file edited by hand or left by an older build would hold it.
BAD_HOST = "a:b"

#: A record the host rule refuses.
INVALID_HOST_RECORD = json.dumps({"schema": 1, "host": BAD_HOST, "username": "u", "password": "p", "remember": True})


@pytest.fixture
def record_path(tmp_path: Path) -> Path:
    """The record file holding ``BAD_HOST`` with the pair the app is configured with."""
    path = tmp_path / "connection.json"
    path.write_text(INVALID_HOST_RECORD, encoding="utf-8")
    return path


@pytest.fixture
def cfg(closed_port: int, http_daemon: dict[str, Any], tmp_path: Path, record_path: Path) -> Config:
    """The config the app starts with: the daemon at the host in force, and the record file at ``record_path``."""
    return Config(
        hqp_host="127.0.0.1",
        hqp_control_port=closed_port,
        hqp_http_port=http_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        connection_file=record_path,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
    )


def after_start(cfg: Config, ask: Callable[[TestClient], int]) -> int | str:
    """What ``ask`` answers on the started app, or the name of the exception the build raised."""
    try:
        app = create_app(cfg, VirtualClock(), NETWORK)
    except httpx.InvalidURL as exc:
        return type(exc).__name__
    with TestClient(app, raise_server_exceptions=False) as client:
        return ask(client)


def test_a_start_over_a_record_naming_an_invalid_host_serves_the_health_read(cfg: Config) -> None:
    assert after_start(cfg, lambda client: client.get("/api/health").status_code) == 200


def test_the_login_after_such_a_start_succeeds(cfg: Config) -> None:
    pair = {"username": "u", "password": "p", "remember": False}
    assert after_start(cfg, lambda client: client.post("/api/login", json=pair).status_code) == 200


def test_the_record_file_is_still_on_disk_after_such_a_start(cfg: Config, record_path: Path) -> None:
    after_start(cfg, lambda client: client.get("/api/health").status_code)
    assert record_path.exists()


async def _count_dial(_reader: asyncio.StreamReader, writer: asyncio.StreamWriter, *, dials: list[None]) -> None:
    """Stream fake that answers nothing and records that it was dialed."""
    dials.append(None)
    writer.close()
    await writer.wait_closed()


def alias_asked(cfg: Config) -> bool:
    """Whether a start of ``cfg`` dials the container alias, whose control port is a counting fake."""
    dials: list[None] = []
    with fake_network.serving(functools.partial(_count_dial, dials=dials), host=ALIAS_HOST) as control:
        aliased = dataclasses.replace(cfg, hqp_control_port=control, container_host_alias=ALIAS_HOST)
        after_start(aliased, lambda client: client.get("/api/health").status_code)
    return bool(dials)


#: What the file holds at start, and whether the start looks for a daemon at the alias: only when nothing was chosen.
ALIAS_BY_RECORD = [(None, True), (INVALID_HOST_RECORD, False), ("{not json", False)]


@pytest.mark.parametrize(("text", "asked"), ALIAS_BY_RECORD, ids=["no-record", "invalid-host", "unparseable"])
def test_a_start_asks_the_container_alias_only_where_no_record_was_chosen(
    monkeypatch: pytest.MonkeyPatch, cfg: Config, record_path: Path, text: str | None, *, asked: bool
) -> None:
    monkeypatch.delenv("HQPTUNER_HQP_HOST", raising=False)
    if text is None:
        record_path.unlink()
    else:
        record_path.write_text(text, encoding="utf-8")
    assert alias_asked(cfg) is asked
