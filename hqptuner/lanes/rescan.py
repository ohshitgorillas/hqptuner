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

The matrix profile is deliberately not here. Loading one needs live playback
(``matrixlane``), and the engine is stopped at the point this runs, so the
frontend says so beside the rescan control instead.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from hqptuner.engine.control import ControlError
from hqptuner.lanes import livelane, livemap, liveoverrides, settle

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)

READY_INTERVAL = 0.25


@dataclass(frozen=True)
class Snapshot:
    """What the engine was running before the rescan, in live-write terms.

    ``fields`` are config-form field names with the values ``livelane`` resolves
    against the enumerations. ``rates`` and ``chain`` are copies of what LIVE
    remembered for the family and chain the engine is NOT running
    (``livelane.LiveMemory``) — the manager drops that memory on the reconnect a
    rescan can cause, and it is what the rate-pin and dormant-chain re-asserts
    read.
    """

    fields: dict[str, str] = field(default_factory=dict)
    rates: dict[str, str] = field(default_factory=dict)
    chain: dict[str, dict[str, str]] = field(default_factory=dict)


def _live_writable(overrides: dict[str, str]) -> dict[str, str]:
    """Keep the overrides a live setter can actually write.

    ``live_overrides`` answers in config-file terms, which includes the per-family
    rate LIMITS (``defaults_samplerate`` / ``defaults_bitrate``). Those are a
    ceiling the config carries, not the target rate ``SetRate`` writes
    (``livemap``), so they cannot be replayed as live writes. The pin itself comes
    back through ``rates`` instead.
    """
    return {name: value for name, value in overrides.items() if name in livemap.ROUTABLE or name in livemap.DIRECT}


def snapshot(mgr: ConnectionManager) -> Snapshot | None:
    """Read the live settings a rescan is about to cost, or None when nothing will be put back.

    None when auto-save is off — the flag is the whole gate, and the auto-save
    toggle cannot be on without an active preset (``store/actions.js``).
    """
    if not mgr.presetops.store.autosave:
        return None
    return Snapshot(
        fields=_live_writable(liveoverrides.live_overrides(mgr)),
        rates=dict(mgr.live.rates),
        chain={name: dict(held) for name, held in mgr.live.chain.items()},
    )


def _setting_of(name: str) -> str:
    """Return the writer's setting key for a config-form field, which is what the apply report names."""
    return livemap.ROUTABLE[name].setting if name in livemap.ROUTABLE else name


def _restored(report: list[dict[str, Any]], fields: dict[str, str]) -> dict[str, str]:
    """Return the snapshot fields whose setter came back verified by readback.

    A field held for the chain the engine did not load is not in here: it was
    remembered, not written, and reporting it as restored would claim an engine
    change nobody can hear (``livelane.apply_now``).
    """
    landed = {entry["setting"] for entry in report if entry["ok"]}
    return {name: value for name, value in fields.items() if _setting_of(name) in landed}


async def _reachable(mgr: ConnectionManager) -> bool:
    """Whether the control lane is answering again."""
    return mgr.reachable and mgr.control is not None


async def replay(mgr: ConnectionManager, snap: Snapshot | None) -> dict[str, str]:
    """Put a snapshot back on the engine once it answers again, and report what landed.

    Empty when there was nothing to put back, when the daemon never came back
    inside the alarm window, or when the writes failed. Best-effort throughout:
    the rescan the caller asked for succeeded either way, and reporting it as a
    failure because the replay could not finish would be a lie about the rescan.

    The wait matters. A rescan can drop the control connection, and the
    manager's reconnect clears LIVE's memory (``livelane.LiveMemory.forget``) —
    so the memory is restored from the snapshot after that wait, not before it.
    """
    if snap is None or not snap.fields:
        return {}
    if not await settle.poll_until(mgr, lambda: _reachable(mgr), interval=READY_INTERVAL):
        log.warning("device rescan: daemon never came back, live settings not restored")
        return {}
    mgr.live.rates.update(snap.rates)
    for name, held in snap.chain.items():
        mgr.live.chain.setdefault(name, {}).update(held)
    try:
        report = await livelane.apply_preset(mgr, snap.fields)
    except (ControlError, livemap.LiveRouteError) as exc:
        log.warning("device rescan: restoring live settings failed: %s", exc)
        return {}
    return _restored(report["live"], snap.fields)
