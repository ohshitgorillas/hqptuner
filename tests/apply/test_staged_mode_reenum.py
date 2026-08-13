"""A staged apply leaves the daemon's enumerations re-read, so the NEXT apply
resolves against the lists the engine is actually offering.

`SetMode` swaps the filter/shaper/rate enumerations wholesale (architecture §5,
protocol.md §4), and the two chains number the same filter under different enum
IDs at different list positions. The config form speaks enum IDs, `State` speaks
list indices, and the domains never mix — so a second, separate staged apply
that resolved its enum ID against the list the previous mode was offering lands
on a different filter, silently and with everything reporting OK.

The fixture facts these lean on (`tests/support/fake_control.py`): the PCM chain
enumerates `none`/`poly-sinc-gauss-long`/`sinc-M`/`poly-sinc-short-mp` as enum
0/40/25/57 at indices 0-3, the SDM chain enumerates
`poly-sinc-gauss-long`/`sinc-M`/`poly-sinc-short-lp` as enum 38/23/57 at indices
0-2, and enum 57 is therefore a real filter on BOTH lists at different indices
under different names. Everything runs against the fake daemons over a real
socket; the assertions are on the daemon's own reports and the traffic that
reached it (docs/testing.md).
"""

import asyncio
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

import fake_http
import pytest
from conftest import DaemonFactory, LiveManager, eventually
from narrow import present

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager


def _running_filter_name(manager: ConnectionManager) -> str:
    """The NAME the engine's current main-filter index carries on the list the
    engine is currently enumerating — what the user sees for what is running."""
    index = present(manager.state).get("filterNx")
    return next((item["name"] for item in present(manager.enums)["filters"] if item["index"] == index), "")


def _filter_enum_ids(manager: ConnectionManager) -> list[str]:
    return [item["value"] for item in present(manager.enums)["filters"]]


# --- a mode-only apply, then a chain field in a separate apply -----------------
# The engine starts on the SDM chain, where enum 57 is `poly-sinc-short-lp` at
# index 2. After the switch to PCM the same enum ID is `poly-sinc-short-mp` at
# index 3, so an index resolved against the pre-switch list moves the engine to
# PCM's index 2 (`sinc-M`) — a filter the user never picked.


async def test_a_later_apply_resolves_its_filter_on_the_entered_modes_list(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager(mode="2")
    await manager.applyops.apply({}, {"mode": "pcm"})
    await manager.applyops.apply({}, {"filter": "57"})
    assert present(manager.state)["filterNx"] == "3"


async def test_a_later_apply_leaves_the_engine_running_the_filter_that_was_named(
    live_manager: LiveManager,
) -> None:
    manager, _, _ = await live_manager(mode="2")
    await manager.applyops.apply({}, {"mode": "pcm"})
    await manager.applyops.apply({}, {"filter": "57"})
    assert _running_filter_name(manager) == "poly-sinc-short-mp"


# --- the mode the engine is already in ----------------------------------------
# `SetMode` is not free even when it changes nothing: it clears the engine's rate
# pin and reloads the chain (probe_mode_rate_pin.py on 6.0.4). So a staged apply
# of the running mode must put no mode setter on the wire at all.


async def test_a_mode_apply_matching_the_running_mode_sends_no_mode_setter(live_manager: LiveManager) -> None:
    manager, log, _ = await live_manager(mode="1")
    log.clear()
    await manager.applyops.apply({}, {"mode": "pcm"})
    assert not any(command == "SetMode" for command, _attrs in log)


# --- a filter-only apply re-reads too -----------------------------------------
# The engine's mode is moved here from OUTSIDE HQPTuner — a switch made in
# HQPlayer's own UI, which no command of ours caused, so it is written straight
# onto the daemon's live State (the `daemon` fixture's documented use). The
# lists the daemon serves swap with it, and an apply that re-reads afterwards
# ends up holding the SDM chain's enum IDs rather than the PCM ones it started
# the batch with.


async def test_a_filter_apply_leaves_the_enumerations_re_read(live_manager: LiveManager) -> None:
    manager, _, state = await live_manager(mode="1")
    state["mode"] = "2"
    await manager.applyops.apply({}, {"filter": "57"})
    assert _filter_enum_ids(manager) == ["38", "23", "57"]


# --- a mode the daemon answers OK for and never applies ------------------------
# `result="OK"` is not proof the setter took (protocol.md §6), so the readback
# disagrees and the mode is reported not applied. It does NOT escalate onto the
# restore lane: the pending-changes bar promised this batch would stay live, and
# an unverified setter must not silently turn into a daemon restart.


@pytest.fixture
def pcm_file_daemon() -> Iterator[dict[str, Any]]:
    """The 8088 fake whose config file says mode `pcm`, so a staged `sdm` is a
    real change the file can be read back for (the fake's default is `sdm`)."""
    yield from fake_http.spawn(fake_http.state(mode="pcm"))


@pytest.fixture
async def deaf_mode_manager(
    daemon: DaemonFactory, pcm_file_daemon: dict[str, Any], tmp_path: Path
) -> AsyncIterator[ConnectionManager]:
    """Both lanes live, against a control daemon that answers `SetMode`
    `result="OK"` and never applies it (the `_deaf` knob — protocol.md §6, OK is
    not proof). So the readback disagrees with what was asked for, which is a
    mode the live lane could not apply."""
    port, _log, _state = await daemon(mode="1", _deaf="SetMode")
    http = HttpConfigClient("127.0.0.1", pcm_file_daemon["_port"], "u", "p")
    manager = ConnectionManager(
        Config(
            hqp_host="127.0.0.1",
            hqp_control_port=port,
            alarm_threshold=1.0,
            poll_interval=0.02,
            backup_dir=tmp_path,
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
        ),
        http,
    )
    task = asyncio.create_task(manager.run())
    await eventually(lambda: manager.reachable)
    yield manager
    manager.stop()
    await task
    await manager.aclose()
    await http.aclose()


async def test_a_mode_the_daemon_answered_but_never_applied_reports_not_applied(
    deaf_mode_manager: ConnectionManager,
) -> None:
    report = await deaf_mode_manager.applyops.apply({}, {"mode": "sdm"})
    assert next(entry["ok"] for entry in report["live"] if entry["setting"] == "mode") is False


async def test_a_mode_the_daemon_answered_but_never_applied_does_not_restart_the_daemon(
    deaf_mode_manager: ConnectionManager,
) -> None:
    report = await deaf_mode_manager.applyops.apply({}, {"mode": "sdm"})
    assert report["persistent"] is None


# --- regression guard: the batch that already applies live -------------------
# Covered elsewhere; pinned here so a re-read added to the mode path cannot turn
# a live-routed batch into a restart.


async def test_a_mode_beside_a_live_routable_field_stays_off_the_restore_lane(live_manager: LiveManager) -> None:
    manager, _, _ = await live_manager(mode="1")
    report = await manager.applyops.apply({}, {"mode": "sdm", "modulator": "3"})
    assert report["persistent"] is None
