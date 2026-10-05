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
import struct
from typing import TYPE_CHECKING, Any, Protocol

import fake_metering
import pytest
from apps import advance_app, app_manager, wait_for_api
from conftest import METADATA_MIN, spawn_threaded_daemon
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

SEEDED_ON = {"schema": 1, "enabled": True, "presets": {}}

SOURCE_RATE = 96_000
STREAM_BANDWIDTH = SOURCE_RATE / 2
STREAM_BINS = 1025
SPUR_KHZ = 30.0

#: What `State` reports while the engine is playing, the only state in which the reader holds its 4322 socket.
PLAYING = "2"

#: Poll passes the reader gets to form a recommendation before a case reads it.
POLLS = 20


class AdvisorClient(Protocol):
    """The REST app built for one setting of the advisor flag."""

    def __call__(self, *, advisor: bool) -> TestClient: ...


def _reachable(client: TestClient) -> bool:
    return bool(client.get("/api/health").json()["reachable"])


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
        wait_for_api(client, _reachable)
        return client

    yield build
    for client in opened:
        client.__exit__(None, None, None)


def spur_frame() -> bytes:
    """One single-channel metering frame: a -60 dB floor in every bin but the one nearest ``SPUR_KHZ``, at 0 dB."""
    reals = [1e-3] * STREAM_BINS
    reals[round(SPUR_KHZ * 1000 * (STREAM_BINS - 1) / STREAM_BANDWIDTH)] = 1.0
    header = struct.pack("<4I3fI", 1, 1, STREAM_BINS, 11, STREAM_BANDWIDTH, 0.1, 0.0, 0)
    levels = (-3.0, -6.0, -20.0, -18.0)
    return header + struct.pack(f"<4f{2 * STREAM_BINS}f", *levels, *reals, *([0.0] * STREAM_BINS))


@pytest.fixture
def spur_client(tmp_path: Path) -> Iterator[AdvisorClient]:
    """The REST surface on a playing daemon and a 4322 stream carrying a spur, built for one setting of the advisor
    flag; torn down clients first, so each reader hangs up before the fakes behind it close."""
    closing = contextlib.ExitStack()
    fakes: list[Iterator[int]] = []

    def build(*, advisor: bool) -> TestClient:
        daemon = spawn_threaded_daemon({"state": PLAYING, "_metadata": f'<metadata samplerate="{SOURCE_RATE}"/>'})
        stream = fake_metering.spawn(spur_frame())
        fakes.extend([daemon, stream])
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=next(daemon),
            hqp_metering_port=next(stream),
            hqp_username="",
            hqp_password="",
            data_dir=METADATA_MIN,
            backup_dir=tmp_path,
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
            autopilot_file=tmp_path / "autopilot.json",
            advisor_enabled=advisor,
        )
        client = closing.enter_context(TestClient(create_app(cfg, VirtualClock())))
        wait_for_api(client, _reachable)
        return client

    yield build
    closing.close()
    for fake in fakes:
        next(fake, None)


def stored_enabled(tmp_path: Path) -> bool | None:
    store: dict[str, Any] = json.loads((tmp_path / "autopilot.json").read_text())
    return store.get("enabled")


def junk_ceiling(client: TestClient) -> float | None:
    """The ceiling of the first recommendation `/api/status` serves within ``POLLS`` poll passes, or None."""
    interval = app_manager(client).cfg.poll_interval
    for _ in range(POLLS):
        junk = client.get("/api/status").json()["data"]["junk"]
        if junk is not None:
            ceiling: float = junk["ceiling_khz"]
            return ceiling
        advance_app(client, interval)
    return None


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
    assert junk_ceiling(spur_client(advisor=advisor)) == ceiling


@pytest.mark.parametrize(("advisor", "stored"), [(True, False), (False, True)])
def test_the_switch_route_writes_the_store_only_while_the_advisor_is_on(
    *, advisor_client: AdvisorClient, tmp_path: Path, advisor: bool, stored: bool
) -> None:
    advisor_client(advisor=advisor).post("/api/autopilot", json={"enabled": False})
    assert stored_enabled(tmp_path) is stored
