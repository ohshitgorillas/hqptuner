"""The junk-filter advisor and auto-pilot behind ``Config.advisor_enabled``.

With the advisor off, auto-pilot is inert: its stored switch is not reported
and the switch route writes nothing. The metering reader runs either way, and
its recommendation is served only while the advisor is on. Each case runs the
same wire traffic with the advisor on and off and reads one surface back, so
the two readings differ on the flag alone.

The auto-pilot store is seeded on before the app starts, because that is the
state a user who switched it on carries into a build where the feature is off:
what the file already holds must stay where it is and act on nothing.

The recommendation cases run on a daemon playing a 96 kHz source and a 4322
stream of one single-channel frame (``<4I3fI`` header, four ``f32`` levels in
dBFS, then reals and imaginaries) whose transform carries a -60 dB floor and
one 0 dB bin at ``SPUR_KHZ``: a persistent tone the reader's spur rule reads.
Their auto-pilot store is left unwritten, so nothing engages a filter that
would quiet the note.

Everything is driven over the REST surface: ``GET /api/status`` and
``POST /api/autopilot``. The store file is read back with a plain
``json.loads``; the one key pinned, ``enabled``, is wire contract.
"""

from __future__ import annotations

import contextlib
import json
from dataclasses import replace
from typing import TYPE_CHECKING, Any, Protocol

import fake_metering
import pytest
from apps import connection_stands, control_config, served_ceiling, two_lane_config, wait_for_api
from conftest import spawn_threaded_daemon
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

SEEDED_ON = {"schema": 1, "enabled": True, "presets": {}}

SOURCE_RATE = 96_000
SPUR_KHZ = 30.0

#: What `State` reports while the engine is playing, the only state in which the reader holds its 4322 socket.
PLAYING = "2"

#: Poll passes the reader gets to form a recommendation before a case reads it.
POLLS = 20


class AdvisorClient(Protocol):
    """The REST app built for one setting of the advisor flag."""

    def __call__(self, *, advisor: bool) -> TestClient: ...


@pytest.fixture
def advisor_client(http_daemon: dict[str, Any], threaded_daemon_port: int, tmp_path: Path) -> Iterator[AdvisorClient]:
    """The REST surface on both fakes, the auto-pilot store seeded on, built for one setting of the advisor flag."""
    opened: list[TestClient] = []

    def build(*, advisor: bool) -> TestClient:
        (tmp_path / "autopilot.json").write_text(json.dumps(SEEDED_ON))
        cfg = replace(two_lane_config(http_daemon, threaded_daemon_port, tmp_path), advisor_enabled=advisor)
        client = TestClient(create_app(cfg, VirtualClock()))
        client.__enter__()
        opened.append(client)
        wait_for_api(client, connection_stands)
        return client

    yield build
    for client in opened:
        client.__exit__(None, None, None)


@pytest.fixture
def spur_client(tmp_path: Path) -> Iterator[AdvisorClient]:
    """The REST surface on a playing daemon and a 4322 stream carrying a spur, built for one setting of the advisor
    flag; torn down clients first, so each reader hangs up before the fakes behind it close."""
    closing = contextlib.ExitStack()
    fakes: list[Iterator[int]] = []

    def build(*, advisor: bool) -> TestClient:
        daemon = spawn_threaded_daemon({"state": PLAYING, "_metadata": f'<metadata samplerate="{SOURCE_RATE}"/>'})
        stream = fake_metering.spawn(
            fake_metering.spur_frame(source_rate=SOURCE_RATE, spur_khz=SPUR_KHZ, transform_time=0.1)
        )
        fakes.extend([daemon, stream])
        cfg = replace(control_config(next(daemon), tmp_path), hqp_metering_port=next(stream), advisor_enabled=advisor)
        client = closing.enter_context(TestClient(create_app(cfg, VirtualClock())))
        wait_for_api(client, connection_stands)
        return client

    yield build
    closing.close()
    for fake in fakes:
        next(fake, None)


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


@pytest.mark.parametrize("advisor", [True, False])
def test_the_metering_reader_runs_whether_or_not_the_advisor_is_on(
    *, advisor_client: AdvisorClient, advisor: bool
) -> None:
    assert advisor_client(advisor=advisor).get("/api/status").json()["data"]["metering"] is True


@pytest.mark.parametrize(("advisor", "ceiling"), [(True, SPUR_KHZ), (False, None)])
def test_status_serves_the_readers_recommendation_only_while_the_advisor_is_on(
    *, spur_client: AdvisorClient, advisor: bool, ceiling: float | None
) -> None:
    assert served_ceiling(spur_client(advisor=advisor), POLLS) == ceiling


@pytest.mark.parametrize(("advisor", "stored"), [(True, False), (False, True)])
def test_the_switch_route_writes_the_store_only_while_the_advisor_is_on(
    *, advisor_client: AdvisorClient, tmp_path: Path, advisor: bool, stored: bool
) -> None:
    advisor_client(advisor=advisor).post("/api/autopilot", json={"enabled": False})
    assert stored_enabled(tmp_path) is stored
