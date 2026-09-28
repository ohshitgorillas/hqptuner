"""The junk-filter advisor and auto-pilot behind ``Config.advisor_enabled``.

With the advisor off, auto-pilot is inert: its stored switch is not reported,
the switch route writes nothing, a live snapshot save records no auto-pilot
state, and the metering reader is never built. Each case runs the same wire
traffic with the advisor on and off and reads one surface back, so the two
readings differ on the flag alone.

The auto-pilot store is seeded on before the app starts, because that is the
state a user who switched it on carries into a build where the feature is off:
what the file already holds must stay where it is and act on nothing.

Everything is driven over the REST surface: ``GET /api/status``,
``POST /api/autopilot`` and ``PUT /api/livepresets/{name}``. The store file is
read back with a plain ``json.loads``; the one key pinned, ``enabled``, is wire
contract. Not here: ``GET /api/livepresets/snapshot``, the save popover's
preview, which reads the same value the save records and cannot fail on its own.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Protocol

import pytest
from apps import wait_for_api
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

SEEDED_ON = {"schema": 1, "enabled": True, "presets": {}}


class AdvisorClient(Protocol):
    """The REST app built for one setting of the advisor flag."""

    def __call__(self, *, advisor: bool) -> TestClient: ...


@pytest.fixture
def advisor_client(http_daemon: dict[str, Any], threaded_daemon_port: int, tmp_path: Path) -> Iterator[AdvisorClient]:
    """The REST surface on both fakes, the auto-pilot store seeded on, built for one setting of the advisor flag."""
    opened: list[TestClient] = []

    def build(*, advisor: bool) -> TestClient:
        (tmp_path / "autopilot.json").write_text(json.dumps(SEEDED_ON))
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
            advisor_enabled=advisor,
        )
        client = TestClient(create_app(cfg, VirtualClock()))
        client.__enter__()
        opened.append(client)
        wait_for_api(client, lambda c: bool(c.get("/api/health").json()["reachable"]))
        return client

    yield build
    for client in opened:
        client.__exit__(None, None, None)


def stored_enabled(tmp_path: Path) -> bool | None:
    store: dict[str, Any] = json.loads((tmp_path / "autopilot.json").read_text())
    return store.get("enabled")


@pytest.mark.parametrize(("advisor", "reported"), [(True, True), (False, False)])
def test_status_reports_the_stored_switch_only_while_the_advisor_is_on(
    *, advisor_client: AdvisorClient, advisor: bool, reported: bool
) -> None:
    assert advisor_client(advisor=advisor).get("/api/status").json()["data"]["autopilot"] is reported


@pytest.mark.parametrize(("advisor", "reported"), [(True, True), (False, False)])
def test_status_says_whether_the_advisor_is_on(*, advisor_client: AdvisorClient, advisor: bool, reported: bool) -> None:
    assert advisor_client(advisor=advisor).get("/api/status").json()["data"]["advisor"] is reported


@pytest.mark.parametrize(("advisor", "reported"), [(True, True), (False, False)])
def test_the_metering_reader_runs_only_while_the_advisor_is_on(
    *, advisor_client: AdvisorClient, advisor: bool, reported: bool
) -> None:
    assert advisor_client(advisor=advisor).get("/api/status").json()["data"]["metering"] is reported


@pytest.mark.parametrize(("advisor", "stored"), [(True, False), (False, True)])
def test_the_switch_route_writes_the_store_only_while_the_advisor_is_on(
    *, advisor_client: AdvisorClient, tmp_path: Path, advisor: bool, stored: bool
) -> None:
    advisor_client(advisor=advisor).post("/api/autopilot", json={"enabled": False})
    assert stored_enabled(tmp_path) is stored


@pytest.mark.parametrize(("advisor", "recorded"), [(True, True), (False, None)])
def test_a_saved_live_preset_carries_auto_pilot_only_while_the_advisor_is_on(
    *, advisor_client: AdvisorClient, advisor: bool, recorded: bool | None
) -> None:
    client = advisor_client(advisor=advisor)
    client.put("/api/livepresets/Warm")
    warm = next(p for p in client.get("/api/livepresets").json()["presets"] if p["name"] == "Warm")
    assert warm.get("autopilot") is recorded
