"""The restart gate on the persistent write path (docs/testing.md — behavior
only, one assertion per test, public API only, fakes speak the wire protocol).

``POST /restore`` is answered 200 as soon as the daemon has written the files;
the process that answers it is still the OLD one, and it goes on serving the
settings it booted on for about 5.6 s before it exits and comes back. On the
Control API that window has exactly one signature: the connection breaks and a
new one is established (docs/protocol.md §3.6 — an adopted restore is
scope=system). Until that happens every reading of the engine describes a
process whose settings the restore has already superseded.

So the contract asserted here: nothing an apply stores may be read off the
pre-restart process. A preset written after an apply carries the applied config
and the engine that came back, never the engine that was there before; an apply
whose daemon never comes back reports no success and overlays nothing; and the
mirror an auto-saving apply uploads agrees with the working config it rides
beside.

The 4321 fake is armed from inside the 8088 fake's ``_on_restore`` hook, the way
``test_load_resync`` arms it — but with ``restart_after``, so the old process
answers the window out before the socket goes. What the manager holds afterwards
is therefore compared against the engine the daemon actually came back as, never
against a value the test handed it.
"""

import asyncio
import io
import zipfile
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import Any

import pytest
from conftest import DaemonFactory, eventually
from fake_config_xml import elem_attr
from fake_control import restart_after

from hqptuner.conf import presetconf
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.presets import presetlane

#: How many more commands the pre-restart process answers after the 200 — the
#: ~5.6 s window, counted in the only unit this lane exposes. One is the case
#: worth expressing: the readback that immediately follows the restore is served
#: by the process the restore superseded, and the command after it finds the
#: socket gone. It also has to be a number the traffic actually reaches; a window
#: wider than the wait's own command count is a daemon that never restarts,
#: which is a different case with its own tests.
WINDOW = 1

#: The other end of the same knob: the restart is already done by the time the
#: next command reaches the socket. Used where the case is about what an apply
#: concludes once a new process is there, not about what the old one served.
PROMPT = 0

#: A manager on both lanes plus its 4321 fake's live State.
DualLane = Callable[..., Awaitable[tuple[ConnectionManager, dict[str, str]]]]


@pytest.fixture
async def dual_lane(daemon: DaemonFactory, http_daemon: dict[str, Any], tmp_path: Path) -> AsyncIterator[DualLane]:
    """A connected manager on both lanes — 4321 for the engine picture, 8088 for
    the restore the write path rides — settled before it comes back.

    Keyword arguments are the control fake's State overrides. The poll interval
    is left at the production pacing deliberately: a background poll would eat
    the pre-restart window the cases here are written around."""
    built: list[tuple[ConnectionManager, asyncio.Task[None], HttpConfigClient]] = []

    async def build(**overrides: str) -> tuple[ConnectionManager, dict[str, str]]:
        port, _log, state = await daemon(**overrides)
        http = HttpConfigClient("127.0.0.1", http_daemon["_port"], "u", "p")
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=port,
            alarm_threshold=1.0,
            backup_dir=tmp_path / "backups",
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
        )
        manager = ConnectionManager(cfg, http)
        task = asyncio.create_task(manager.run())
        await eventually(
            lambda: manager.reachable and manager.state is not None and manager.loaded_at is not None,
            timeout=5.0,
        )
        built.append((manager, task, http))
        return manager, state

    yield build
    for manager, task, http in built:
        manager.stop()
        await task
        await manager.aclose()
        await http.aclose()


async def _armed(manager: ConnectionManager, name: str) -> None:
    """Auto-save armed on a preset captured off the running daemon: saving makes
    it active, and the flag is what makes the fold happen at all."""
    await manager.presetops.save_preset(name)
    manager.presetops.store.set_autosave(enabled=True)


def _restore_landed(http_daemon: dict[str, Any]) -> None:
    """The restore reached the daemon, or a failure naming the setup that never
    got there — the restart window is the premise of these cases, not the
    behavior under test, so it raises rather than spending an assertion."""
    if not http_daemon.get("_restore_attempts"):
        raise AssertionError("no POST /restore ever arrived: there was no restart window to serve")


def _uploaded(http_daemon: dict[str, Any]) -> zipfile.ZipFile:
    """The settings archive the last apply put on the wire, verbatim."""
    return zipfile.ZipFile(io.BytesIO(http_daemon["_restore_bytes"]))


# --- an autosaved apply never folds the pre-restart process's readings --------
# The 8088 fake's config file starts on the SDM chain with filter enum 40; the
# 4321 fake is started on an SDM engine, so the pre-restart process is a real
# alternative source for every field below and a fold off it is visible.


async def test_an_autosaved_apply_stores_the_applied_mode_not_the_pre_restart_engines(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    # the field the bug was reported on: the engine answering during the window
    # is still in SDM, while the config the apply just wrote says PCM
    manager, state = await dual_lane(mode="2", _active_mode="SDM (DSD)")
    await _armed(manager, "Kept")
    http_daemon["_on_restore"] = lambda: restart_after(state, {"mode": "1", "_active_mode": "PCM"}, commands=WINDOW)
    await manager.applyops.apply({}, {"mode": "pcm", "title": "Renamed"})
    await presetlane.autosave(manager)
    _restore_landed(http_daemon)
    assert elem_attr(manager.presetops.store.read("Kept"), "mode", "value") == "pcm"


async def test_an_autosaved_apply_stores_the_chain_filter_of_the_engine_that_came_back(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    # the daemon comes back running PCM with filter slot 2 loaded, which that
    # chain numbers 25 (`sinc-M`) — a value neither the applied config (enum 40)
    # nor the pre-restart engine could supply, since under SDM the PCM filter is
    # dormant and contributes nothing at all
    manager, state = await dual_lane(mode="2", _active_mode="SDM (DSD)")
    await _armed(manager, "Kept")
    http_daemon["_on_restore"] = lambda: restart_after(
        state, {"mode": "1", "_active_mode": "PCM", "filterNx": "2"}, commands=WINDOW
    )
    await manager.applyops.apply({}, {"mode": "pcm", "title": "Renamed"})
    await presetlane.autosave(manager)
    _restore_landed(http_daemon)
    assert elem_attr(manager.presetops.store.read("Kept"), "pcm", "filter") == "25"


async def test_an_autosaved_apply_stores_the_rate_limit_of_the_engine_that_came_back(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    # per-family rate limit, the third live-domain slot: the pre-restart engine
    # is pinned to PCM index 4 (384000 Hz) and the one that comes back to index 1
    # (44100 Hz), so which process was read is readable off <defaults samplerate>
    manager, state = await dual_lane(rate="4")
    await _armed(manager, "Kept")
    http_daemon["_on_restore"] = lambda: restart_after(state, {"rate": "1"}, commands=WINDOW)
    await manager.applyops.apply({}, {"title": "Renamed"})
    await presetlane.autosave(manager)
    _restore_landed(http_daemon)
    assert elem_attr(manager.presetops.store.read("Kept"), "defaults", "samplerate") == "44100"


# --- no process comes back: the applied config alone, no overlay --------------


async def test_an_apply_whose_daemon_never_restarts_stores_the_config_it_wrote(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    # nothing is armed on the 4321 fake, so the process that answered the 200 is
    # still the one on the socket when the deadline passes. The config the apply
    # wrote says filter 57; the engine says slot 2, which PCM numbers 25 — so an
    # engine-derived overlay is what 25 would mean, and there must not be one.
    manager, _state = await dual_lane(filterNx="2")
    await _armed(manager, "Kept")
    await manager.applyops.apply({}, {"filter": "57", "title": "Renamed"})
    await presetlane.autosave(manager)
    _restore_landed(http_daemon)
    assert elem_attr(manager.presetops.store.read("Kept"), "pcm", "filter") == "57"


# --- the apply's own verdict --------------------------------------------------


async def test_an_apply_whose_daemon_never_restarts_reports_not_applied(dual_lane: DualLane) -> None:
    # the daemon adopted the restore and answers the readback with the new value,
    # but it answers as the process the restore superseded — a readback from that
    # process is not proof the change is running, so it is not success
    manager, _state = await dual_lane()
    report = await manager.applyops.apply({}, {"title": "Renamed"})
    assert report["persistent"]["applied"] is False


async def test_an_apply_whose_daemon_restarts_reports_applied(dual_lane: DualLane, http_daemon: dict[str, Any]) -> None:
    # the other half of the gate: once a new process is on the socket the same
    # readback is proof, so the ordinary apply still converges
    manager, state = await dual_lane()
    http_daemon["_on_restore"] = lambda: restart_after(state, commands=PROMPT)
    report = await manager.applyops.apply({}, {"title": "Renamed"})
    assert report["persistent"]["applied"] is True


async def test_an_apply_with_no_control_lane_at_all_reports_applied(http_manager: ConnectionManager) -> None:
    # The gate exists to keep a departed process's engine readings out of a
    # stored preset. This manager has no 4321 connection at all, so there are no
    # engine readings: nothing is resynced, the live overlay is empty, and there
    # is nothing left for the boundary to protect. Withholding success here would
    # refuse every write whenever 4321 is unreachable and 8088 still serves —
    # trading the write path for a guarantee with nothing to guard. Scoped to
    # "no connection at all": a lane that drops mid-restore IS the restart, and
    # a manager that has a lane still has to observe one.
    report = await http_manager.applyops.apply({}, {"title": "Renamed"})
    assert report["persistent"]["applied"] is True


# --- the archive one apply uploads is internally consistent -------------------


async def test_the_mirror_and_the_working_config_of_one_apply_agree_on_mode(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    # an auto-saving apply uploads the preset mirror beside the working config it
    # is applying; the two are the same settings written twice, so a mode read
    # from a different process for one of them is a divergence on the wire
    manager, state = await dual_lane(mode="2", _active_mode="SDM (DSD)")
    await _armed(manager, "Kept")
    http_daemon["_on_restore"] = lambda: restart_after(state, {"mode": "1", "_active_mode": "PCM"}, commands=WINDOW)
    await manager.applyops.apply({}, {"mode": "pcm", "title": "Renamed"})
    archive = _uploaded(http_daemon)
    working = elem_attr(archive.read("hqplayerd.xml"), "mode", "value")
    assert elem_attr(archive.read("data/cfgs/Kept.xml"), "mode", "value") == working


# --- a preset load followed by an autosave stores the preset that was loaded --
# The real-world report: switching Headphones -> Speakers wrote Headphones'
# modulator and SDM mode into Speakers. "B" is active on an SDM engine holding
# ASDM7EC (enum 3); "A" is a PCM preset whose modulator is ASDM5 (enum 0).


async def _load_a_over_b(
    dual_lane: DualLane, http_daemon: dict[str, Any], restarted_as: dict[str, str]
) -> ConnectionManager:
    manager, state = await dual_lane(mode="2", _active_mode="SDM (DSD)", shaper="1")
    await _armed(manager, "B")
    store = manager.presetops.store
    store.save("A", presetconf.apply_edits(store.read("B"), {"mode": "pcm", "modulator": "0"}))
    http_daemon["_on_restore"] = lambda: restart_after(state, restarted_as, commands=WINDOW)
    await presetlane.load(manager, "A")
    await presetlane.autosave(manager)
    _restore_landed(http_daemon)
    return manager


async def test_an_autosave_after_a_load_stores_the_loaded_presets_own_mode(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    manager = await _load_a_over_b(dual_lane, http_daemon, {"mode": "1", "_active_mode": "PCM"})
    assert elem_attr(manager.presetops.store.read("A"), "mode", "value") == "pcm"


async def test_an_autosave_after_a_load_stores_the_loaded_presets_own_modulator(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    # the pre-restart process is holding SDM shaper slot 1, which that chain
    # numbers 3 (ASDM7EC) — B's modulator, and the value the report was about
    manager = await _load_a_over_b(dual_lane, http_daemon, {"mode": "1", "_active_mode": "PCM", "shaper": "0"})
    assert elem_attr(manager.presetops.store.read("A"), "sdm", "modulator") == "0"


# --- regression: applies stay incremental against the running config ----------


async def test_a_second_apply_leaves_the_field_the_first_one_set(
    dual_lane: DualLane, http_daemon: dict[str, Any]
) -> None:
    # each apply edits the config the daemon is running, so the second one must
    # carry the first one's title through rather than reset it to the value the
    # manager loaded at connect time
    manager, state = await dual_lane()
    http_daemon["_on_restore"] = lambda: restart_after(state, commands=PROMPT)
    await manager.applyops.apply({}, {"title": "Renamed"})
    await manager.applyops.apply({}, {"net_ipv6": "1"})
    assert http_daemon["title"] == "Renamed"
