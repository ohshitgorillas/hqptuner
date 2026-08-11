"""Putting the live settings back after a device rescan.

hqplayerd's ``GET /config/refresh`` stops the engine to re-scan its outputs, and
the engine comes back on the config file — which never learned a live-routed
setting, because a live setting is applied over 4321 and written nowhere
(``liveoverrides.LIVE_DOMAIN``). Every OTHER daemon reload survives that, since a
restore-shaped write folds the active preset's stored values into the XML it
pushes (``presetfields.stored_live_fields``); a rescan writes no config at all,
so nothing carries them and the user's filters, mode and rate pin are gone.

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
from hqptuner.lanes import livelane, livemap, liveoverrides, settle

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)

READY_INTERVAL = 0.25

NO_DAEMON = "The engine did not come back after the rescan — your live settings were not restored."
WRITE_FAILED = "The rescan finished, but restoring your live settings failed."


def _live_writable(overrides: dict[str, str]) -> dict[str, str]:
    """Keep the overrides a live setter can actually write.

    ``live_overrides`` answers in config-file terms, which includes the per-family
    rate LIMITS (``defaults_samplerate`` / ``defaults_bitrate``). Those are a
    ceiling the config carries, not the target rate ``SetRate`` writes
    (``livemap``), so they cannot be replayed as live writes.
    """
    return {name: value for name, value in overrides.items() if name in livemap.ROUTABLE or name in livemap.DIRECT}


def snapshot(mgr: ConnectionManager) -> dict[str, str]:
    """Read the live settings a rescan is about to cost, in live-write terms.

    Empty when auto-save is off — the flag is the whole gate, and the auto-save
    toggle cannot be on without an active preset (``store/actions.js``).
    """
    if not mgr.presetops.store.autosave:
        return {}
    return _live_writable(liveoverrides.live_overrides(mgr))


def _setting_of(name: str) -> str:
    """Return the writer's setting key for a config-form field, which is what the apply report names."""
    return livemap.ROUTABLE[name].setting if name in livemap.ROUTABLE else name


def _restored(report: list[dict[str, Any]], fields: dict[str, str]) -> dict[str, str]:
    """Return the snapshot fields whose setter came back verified by readback.

    A field held for the chain the engine did not load is not in here: it was
    remembered, not written, and reporting it as restored would claim an engine
    change nobody can hear (``livelane.apply_now``). A replay that dies partway
    reports what landed before it did, for the same reason.
    """
    landed = {entry["setting"] for entry in report if entry["ok"]}
    return {name: value for name, value in fields.items() if _setting_of(name) in landed}


async def _reachable(mgr: ConnectionManager) -> bool:
    """Whether the control lane is answering again."""
    return mgr.reachable and mgr.control is not None


async def replay(mgr: ConnectionManager, fields: dict[str, str]) -> dict[str, Any]:
    """Put a snapshot back on the engine once it answers again.

    Answers ``restored`` — the fields whose setter verified by readback — and a
    ``warning`` naming what the user lost when the replay could not run. The
    rescan itself succeeded either way, so neither outcome is an error: the
    caller reports the rescan as done and carries the warning.
    """
    if not fields:
        return {"restored": {}}
    if not await settle.poll_until(mgr, lambda: _reachable(mgr), interval=READY_INTERVAL):
        log.warning("device rescan: daemon never came back, live settings not restored")
        return {"restored": {}, "warning": NO_DAEMON}
    try:
        report = await livelane.apply_preset(mgr, fields)
    except (ControlError, livemap.LiveRouteError) as exc:
        log.warning("device rescan: restoring live settings failed: %s", exc)
        return {"restored": {}, "warning": WRITE_FAILED}
    return {"restored": _restored(report["live"], fields)}
