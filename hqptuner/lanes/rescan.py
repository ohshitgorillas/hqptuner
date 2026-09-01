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
from typing import TYPE_CHECKING, Any

from hqptuner.engine.control import ControlError
from hqptuner.lanes import settle
from hqptuner.lanes.live import lane, routing
from hqptuner.lanes.live.snapshot import live_snapshot

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)

READY_INTERVAL = 0.25

NO_DAEMON = "The engine did not come back after the rescan — your live settings were not restored."
WRITE_FAILED = "The rescan finished, but restoring your live settings failed."


def snapshot(mgr: ConnectionManager) -> dict[str, str]:
    """Read the live settings a rescan is about to cost, in live-write terms.

    ``live_snapshot`` is the reader, the same one a live preset is taken with —
    the chains' filters and shapers, output mode, adaptive volume, and the junk
    filter, which exists ONLY on the engine and so is readable no other way.

    Narrowed to what the live lane accepts (``routing.live_fields``), which drops
    the rate: it goes to the config LIMIT slot (``live.chain.RATE_LIMIT_FIELD``),
    persistent config that survives a rescan on its own. Filtering on the lane's
    own field set rather than naming the rate keeps the two from drifting apart.

    Empty when auto-save is off — the flag is the whole gate, and the auto-save
    toggle cannot be on without an active preset (``store/actions.js``) — and
    empty when the engine cannot say which chain it has loaded, which is
    ``live_snapshot`` refusing to report a half-taken record rather than an error.
    """
    if not mgr.presetops.store.autosave:
        return {}
    taken = live_snapshot(mgr)
    if taken is None:
        return {}
    accepted = routing.live_fields()
    return {field: item["value"] for field, item in taken.items() if field in accepted}


def _setting_of(name: str) -> str:
    """Return the writer's setting key for a config-form field, which is what the apply report names."""
    return routing.ROUTABLE[name].setting if name in routing.ROUTABLE else name


def _restored(report: list[dict[str, Any]], fields: dict[str, str]) -> dict[str, str]:
    """Return the snapshot fields whose setter came back verified by readback.

    A field held for the chain the engine did not load is not in here: it was
    remembered, not written, and reporting it as restored would claim an engine
    change nobody can hear (``lane.apply_now``). A replay that dies partway
    reports what landed before it did, for the same reason.
    """
    landed = {entry["setting"] for entry in report if entry["ok"]}
    return {name: value for name, value in fields.items() if _setting_of(name) in landed}


async def _reachable(mgr: ConnectionManager) -> bool:
    """Whether the control lane is answering again."""
    return mgr.reachable and mgr.control is not None


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
    client = mgr.control
    if client is None:
        raise ControlError("daemon not connected")
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
    after = live_snapshot(mgr) or {}
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


async def replay(mgr: ConnectionManager, fields: dict[str, str]) -> dict[str, Any]:
    """Put a snapshot back on the engine once it answers again.

    Answers ``restored`` — the fields whose setter verified by readback — and a
    ``warning`` when the engine is not running what it was running before. The
    rescan itself succeeded either way, so neither outcome is an error: the
    caller reports the rescan as done and carries the warning.

    Silence here is the original bug wearing a different hat. A rescan that
    reports nothing but success while the engine sits on the config file's values
    is exactly what this module exists to stop, so the check is on the outcome
    and not on whether anything raised.
    """
    if not fields:
        return {"restored": {}}
    if not await settle.poll_until(mgr, lambda: _reachable(mgr), interval=READY_INTERVAL):
        log.warning("device rescan: daemon never came back, live settings not restored")
        return {"restored": {}, "warning": NO_DAEMON}
    try:
        await _reread_engine(mgr)
        moved = _moved(mgr, fields)
        if not moved:
            return {"restored": {}}
        report = await lane.apply_preset(mgr, moved)
    except (ControlError, routing.LiveRouteError) as exc:
        log.warning("device rescan: restoring live settings failed: %s", exc)
        return {"restored": {}, "warning": WRITE_FAILED}
    restored = _restored(report["live"], moved)
    result: dict[str, Any] = {"restored": restored}
    lost = _lost(mgr, moved, restored, report["stored"])
    if lost:
        log.warning("device rescan: live settings not put back: %s", ", ".join(sorted(lost)))
        result["warning"] = WRITE_FAILED
    return result
