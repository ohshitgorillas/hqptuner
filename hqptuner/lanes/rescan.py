"""Putting the live settings back after a device rescan.

hqplayerd's ``GET /config/refresh`` stops the engine to re-scan its outputs, and
the engine comes back on the config file — which never learned a live-routed
setting, because a live setting is applied over 4321 and written nowhere
(``snapshot``). Every OTHER daemon reload survives that, since a
restore-shaped write folds the active preset's stored values into the XML it
pushes (``presetfields.carried_live_fields``); a rescan writes no config at all,
so nothing carries them and the user's filters and mode are gone.

This is the carrier for that one case: read what the engine is running BEFORE the
rescan, put it back after. Gated on auto-save, because auto-save is the user
saying "keep what I set" — with it off a rescan loses live settings exactly as it
always did.

A replay that cannot run says so. Losing the settings quietly is the bug this
module exists to fix, and a rescan that reports nothing but success while the
engine sits on the config file's values is that same bug with a different cause.

The matrix profile is deliberately not here. Loading one needs live playback
(``matrixlane``), and the engine is stopped at the point this runs, so the
frontend says so beside the rescan control instead.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING

from hqptuner.engine.controlerrors import ControlError
from hqptuner.lanes.live import chain, lane, routing
from hqptuner.lanes.live.snapshot import live_snapshot
from hqptuner.lanes.writer import LiveWriteOk

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.core.manager import ConnectionManager
    from hqptuner.lanes.live.lane import LiveApplyReport
    from hqptuner.lanes.writer import LiveWriteResult

log = logging.getLogger(__name__)

READY_INTERVAL = 0.25

NO_DAEMON = "The engine did not come back after the rescan — your live settings were not restored."
WRITE_FAILED = "The rescan finished, but restoring your live settings failed."


def snapshot(mgr: ConnectionManager) -> dict[str, str]:
    """Read the live settings a rescan is about to cost, in live-write terms.

    ``live_snapshot`` is the reader, the same one a live snapshot is taken with —
    the chains' filters and shapers, output mode, adaptive volume, and the junk
    filter, which exists ONLY on the engine and so is readable no other way.

    Narrowed to what the live lane accepts (``routing.live_fields``): the rate
    limits are persistent config (``live.chain.RATE_LIMIT_FIELD``) and survive a
    rescan on their own.

    Empty when auto-save is off — the flag is the whole gate, and the auto-save
    toggle cannot be on without an active preset (``store/actions.js``) — and
    empty when the engine cannot say which chain it has loaded, which
    ``live_snapshot`` refuses with ``ChainUnknownError`` rather than report a
    half-taken record.
    """
    if not mgr.presetops.store.autosave:
        return {}
    if chain.active_chain(mgr) is None:
        return {}
    accepted = routing.live_fields()
    return {field: item["value"] for field, item in live_snapshot(mgr).fields.items() if field in accepted}


def _setting_of(name: str) -> str:
    """Return the writer's setting key for a config-form field, which is what the apply report names."""
    return routing.ROUTABLE[name].setting if name in routing.ROUTABLE else name


def _restored(report: list[LiveWriteResult], fields: dict[str, str]) -> dict[str, str]:
    """Return the snapshot fields whose setter came back verified by readback.

    A field held for the chain the engine did not load is not in here: it was
    remembered, not written, and reporting it as restored would claim an engine
    change nobody can hear (``lane.apply_now``). A replay that dies partway
    reports what landed before it did, for the same reason.
    """
    landed = {entry.setting for entry in report if isinstance(entry, LiveWriteOk)}
    return {name: value for name, value in fields.items() if _setting_of(name) in landed}


async def _await_engine(mgr: ConnectionManager) -> bool:
    """Wait until the control lane answers again, polling to the alarm deadline; False when it never does.

    Asks the lane, not the manager's reachable flag: that flag is flipped by the
    poll loop, which races the replay to a dead socket, so trusting it would make
    the answer depend on which task noticed first. The probe is the re-read itself,
    so a lane that answers leaves the manager holding what the engine came back on.
    """
    end = mgr.clock.monotonic() + mgr.alarm_threshold
    while mgr.clock.monotonic() < end:
        try:
            await _reread_engine(mgr)
        except ControlError as exc:
            log.debug("device rescan: engine not answering yet: %s", exc)
            await mgr.clock.sleep(READY_INTERVAL)
            continue
        return True
    return False


async def _reread_engine(mgr: ConnectionManager) -> None:
    """Re-read State and the enumerations the engine came back on.

    Without this the manager is still holding what it read BEFORE the rescan, and
    every question the replay asks of it gets a pre-rescan answer — most
    damagingly ``lane.mode_already_running``, which then reports the engine
    as already running the mode it was just dropped from and the mode write is
    skipped. The lists move too: the engine reverts to the config file's mode, so
    the filter and shaper enumerations the replay resolves against are the other
    chain's.
    """
    client = mgr.require_control()
    mgr.readings.state = await client.get_state()
    mgr.readings.enums = await client.get_all_enumerations()


def _moved(mgr: ConnectionManager, fields: dict[str, str]) -> dict[str, str]:
    """Return the snapshot fields the engine is no longer running.

    Read through the same ``snapshot`` the snapshot was taken with, so both
    sides of the comparison speak one domain. Only these are written: a live
    setter is not free even when it changes nothing — ``SetMode`` clears the rate
    pin outright and ``SetFilter`` reloads the engine — so re-asserting a setting
    the rescan did not disturb would cost the user something for no gain.
    """
    after = live_snapshot(mgr).fields if chain.active_chain(mgr) is not None else {}
    return {field: value for field, value in fields.items() if (after.get(field) or {}).get("value") != value}


def _lost(mgr: ConnectionManager, fields: dict[str, str], restored: dict[str, str], held: dict[str, str]) -> set[str]:
    """Return the snapshot fields that neither landed nor were deliberately held.

    Judged on the readback-verified report, because nothing else can be trusted
    to say so. ``lane`` absorbs a control-lane failure of its own and answers
    with unverified setters rather than raising, and the manager's cached
    ``State`` is whatever it read BEFORE that failure — so a replay can lose every
    setting while both the return value and the cached state still look right. A
    setter that verified by readback is the one thing here that cannot be stale.

    A HELD field is not lost: it belongs to the chain the engine has not loaded,
    and ``lane`` puts it back when that chain comes round
    (``lane.reassert_chain``). Nor is a mode the engine is already running —
    ``apply_preset`` drops that rather than re-sending it, since ``SetMode``
    clears the rate pin even when it changes nothing.
    """
    missing = {name for name in fields if name not in restored and name not in held}
    mode = fields.get("mode")
    if mode is not None and lane.mode_already_running(mgr, mode):
        missing.discard("mode")
    return missing


class ReplayOutcome(Enum):
    """What a post-rescan replay of the live snapshot came back with."""

    NOTHING_TO_RESTORE = "nothing_to_restore"  # no snapshot taken, or nothing the rescan actually moved
    UNREACHABLE = "unreachable"  # the daemon is unreachable after the restart
    WRITE_FAILED = "write_failed"  # the replay raised, or a field fails verification
    RESTORED = "restored"  # every field the rescan moved verifies


#: What the user is told for each outcome that left the engine off what it ran before the rescan.
WARNINGS = {ReplayOutcome.UNREACHABLE: NO_DAEMON, ReplayOutcome.WRITE_FAILED: WRITE_FAILED}


@dataclass(frozen=True)
class ReplayResult:
    """A replay's outcome, and the snapshot fields whose setter verified by readback."""

    outcome: ReplayOutcome
    restored: dict[str, str] = field(default_factory=dict)


async def replay(mgr: ConnectionManager, fields: dict[str, str]) -> ReplayResult:
    """Put a snapshot back on the engine once it answers again.

    Answers ``restored`` — the fields whose setter verified by readback — and an
    outcome saying whether the engine is running what it ran before. The rescan
    itself succeeded either way, so no outcome is an error: the caller reports the
    rescan as done and words the outcome (``WARNINGS``).

    No outcome is silent. A rescan reported as a plain success while the engine
    sits on the config file's values is exactly what this module exists to stop,
    so the check is on the outcome and not on whether anything raised.
    """
    if not fields:
        return ReplayResult(ReplayOutcome.NOTHING_TO_RESTORE)
    if not await _await_engine(mgr):
        log.warning("device rescan: daemon never came back, live settings not restored")
        return ReplayResult(ReplayOutcome.UNREACHABLE)
    moved = _moved(mgr, fields)
    if not moved:
        return ReplayResult(ReplayOutcome.NOTHING_TO_RESTORE)
    report: LiveApplyReport | None = None
    try:
        report = await lane.apply_preset(mgr, moved)
    except (ControlError, routing.LiveRouteError) as exc:
        log.warning("device rescan: restoring live settings failed: %s", exc)
    return _judge(mgr, moved, report)


def _judge(mgr: ConnectionManager, moved: dict[str, str], report: LiveApplyReport | None) -> ReplayResult:
    """Say what a replay put back, on the readback-verified report; no report means the write itself died."""
    if report is None:
        return ReplayResult(ReplayOutcome.WRITE_FAILED)
    restored = _restored(report.live, moved)
    lost = _lost(mgr, moved, restored, report.stored)
    if lost:
        log.warning("device rescan: live settings not put back: %s", ", ".join(sorted(lost)))
        return ReplayResult(ReplayOutcome.WRITE_FAILED, restored=restored)
    return ReplayResult(ReplayOutcome.RESTORED, restored=restored)
