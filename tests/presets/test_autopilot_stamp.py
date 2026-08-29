"""Flipping the auto-pilot switch stamps the active config preset.

Auto-pilot is one flag in its own JSON store, and that store also keeps a copy
per config preset (``{"enabled": ..., "presets": {"<name>": true|false}}``) —
the copy a preset load restores auto-pilot from. With auto-save armed and a
preset active, the switch is an applied change like any other, so it folds into
the active preset's copy too; with auto-save off, or with no preset active, the
switch writes the top-level flag alone.

Everything here is driven over the REST surface — ``POST /api/autopilot``,
``POST /api/autosave``, ``POST /api/profile/save``, ``POST /api/profile/load`` —
and read back either off a route or off the store's own file on disk. Nothing
reads a private attribute, and nothing asserts the whole file: the two keys
pinned, ``enabled`` and ``presets``, are wire contract.

The app is wired to both fakes at once because a config preset save and load
ride the 8088 http lane while the app's control lane wants a daemon to be
reachable. Every store path lands in ``tmp_path``, auto-pilot's file included,
so no case here writes into the repo's state directory.
"""

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from conftest import wait_for_api
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config

#: The preset every case makes active.
ACTIVE = "Kept"


@pytest.fixture
def stamp_client(http_daemon: dict[str, Any], threaded_daemon_port: int, tmp_path: Path) -> Iterator[TestClient]:
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=threaded_daemon_port,
        hqp_http_port=http_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
        autopilot_file=tmp_path / "autopilot.json",
        hqp_home="/x/home",
    )
    with TestClient(create_app(cfg)) as client:
        wait_for_api(client, lambda c: bool(c.get("/api/health").json()["reachable"]))
        yield client


def stamped(tmp_path: Path, name: str) -> bool | None:
    """The flag the auto-pilot store carries for that preset, read off its file
    on disk; ``None`` when nothing has stamped a copy for it. ``presets`` may be
    absent from the file entirely, and the file itself may not exist yet."""
    path = tmp_path / "autopilot.json"
    if not path.exists():
        return None
    store: dict[str, Any] = json.loads(path.read_text())
    flag = store.get("presets", {}).get(name)
    return None if flag is None else bool(flag)


def switch(client: TestClient, *, enabled: bool) -> None:
    client.post("/api/autopilot", json={"enabled": enabled})


def arm_autosave(client: TestClient) -> None:
    client.post("/api/autosave", json={"enabled": True})


def make_active(client: TestClient, name: str = ACTIVE) -> None:
    """Saving the running config as a named preset is what makes it active."""
    client.post("/api/profile/save", json={"name": name})


# --- auto-save armed, a preset active: the switch folds in --------------------


def test_switching_on_under_autosave_records_the_active_preset_as_carrying_it_on(
    stamp_client: TestClient, tmp_path: Path
) -> None:
    # saved with auto-pilot off, so the stored copy starts False and only the
    # fold can turn it True: a build that never stamped would leave False here
    make_active(stamp_client)
    arm_autosave(stamp_client)
    switch(stamp_client, enabled=True)
    assert stamped(tmp_path, ACTIVE) is True


def test_switching_off_under_autosave_records_the_active_preset_as_carrying_it_off(
    stamp_client: TestClient, tmp_path: Path
) -> None:
    # the pairing case, set up so the stored copy is True before the switch:
    # the explicit save records auto-pilot as it stands, so a build that folded
    # nothing in leaves True behind and only a real fold writes False
    switch(stamp_client, enabled=True)
    make_active(stamp_client)
    arm_autosave(stamp_client)
    switch(stamp_client, enabled=False)
    assert stamped(tmp_path, ACTIVE) is False


# --- auto-save off: the switch touches no preset ------------------------------


def test_switching_on_with_autosave_off_leaves_the_presets_stored_flag_alone(
    stamp_client: TestClient, tmp_path: Path
) -> None:
    # saved with auto-pilot off, and auto-save never armed: the switch is the
    # user's own, not an applied change the active preset asked to carry
    make_active(stamp_client)
    switch(stamp_client, enabled=True)
    assert stamped(tmp_path, ACTIVE) is False


# --- auto-save armed, nothing active ------------------------------------------


def test_switching_on_under_autosave_with_no_active_preset_still_answers_on(
    stamp_client: TestClient,
) -> None:
    # there is no preset to stamp; the switch itself still has to land
    arm_autosave(stamp_client)
    assert stamp_client.post("/api/autopilot", json={"enabled": True}).json()["enabled"] is True


# --- the round trip the stamp exists for --------------------------------------


def test_loading_the_active_preset_after_switching_on_under_autosave_leaves_it_on(
    stamp_client: TestClient,
) -> None:
    # the whole point: without the fold the load restores the stale copy the
    # save wrote and silently switches auto-pilot back off
    make_active(stamp_client)
    arm_autosave(stamp_client)
    switch(stamp_client, enabled=True)
    stamp_client.post("/api/profile/load", json={"name": ACTIVE})
    assert stamp_client.get("/api/autopilot").json()["enabled"] is True
