"""Apply surface — the staged-buffer apply and the LIVE view's immediate write path.

``/config/apply`` drains the pending buffer through the persistent lane; ``/config/live`` never stages and never
restarts. Both fold a clean write into a preset when auto-save is armed.
"""

import contextlib
from typing import Any

from fastapi import APIRouter, Request

from hqptuner.api.deps import Mgr
from hqptuner.api.errors import refuse
from hqptuner.api.models import ApplyBody, LiveBody
from hqptuner.api.routes.pending import _apply_succeeded, _pending
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.control import ControlError
from hqptuner.lanes.live import lane, routing
from hqptuner.presets import presetlane
from hqptuner.presets.store.autopilot import AutopilotError

router = APIRouter(prefix="/api")


async def _save_after_apply(manager: ConnectionManager, name: str) -> dict[str, Any]:
    """Persist a clean, successful apply into the named preset (store + daemon mirror).

    Only called when the apply itself succeeded, so the running config already carries the edits. ``save_preset``
    reports its own failure.
    """
    return await manager.presetops.save_preset(name)


async def _persist_after_apply(manager: ConnectionManager, save: str | None, report: dict[str, Any]) -> None:
    """Fold a clean apply into a preset.

    The target is the named preset the request asked for, or whatever auto-save is armed for when it asked for none.
    """
    if save is not None:
        report["saved"] = await _save_after_apply(manager, save)
        return
    autosaved = await presetlane.autosave(manager)
    if autosaved is not None:
        report["autosaved"] = autosaved


@router.post("/config/apply")
async def apply(request: Request, manager: Mgr, body: ApplyBody | None = None) -> dict[str, Any]:
    """Write everything staged to the daemon, then persist and clear the buffer only if all of it took.

    400 when nothing is staged and no preset switch was asked for. A soft failure returns the report with the buffer
    intact so the user can retry; the persistent lane restarts the daemon and interrupts playback, never gated on.
    """
    store = _pending(request)
    switch_to = body.switch_to if body else None
    if not store.live and not store.http and switch_to is None:
        raise refuse("nothing_staged", "nothing staged")
    # the staged set as it stands NOW — a clean apply clears the buffer below, so
    # nothing captured after this point can say what was applied
    staged_http, staged_live = dict(store.http), dict(store.live)
    save = body.save.name if body is not None and body.save is not None else None
    try:
        report = await manager.applyops.apply(store.live, store.http, switch_to)
    except ControlError as exc:
        raise refuse(exc) from exc
    ok = _apply_succeeded(report)
    manager.audit.apply(staged_http, staged_live, switch_to, save, ok=ok)
    if not ok:
        return report  # soft failure — keep staging so the user can retry
    await _persist_after_apply(manager, save, report)
    store.clear()
    return report


def _stand_autopilot_down(manager: ConnectionManager, fields: dict[str, str]) -> None:
    """Switch auto-pilot off when this batch sets the high-frequency filter by hand.

    It is the user taking the control back, and leaving it on would have the poll loop
    undo the choice they just made. Before the write, not after, so there is no window
    in which a poll can revert it.
    """
    if "junk_filter" not in fields:
        return
    with contextlib.suppress(AutopilotError):
        presetlane.switch_autopilot(manager, "live.write", enabled=False)


@router.post("/config/live")
async def config_live(body: LiveBody, manager: Mgr) -> dict[str, Any]:
    """Apply live-lane config-form fields immediately, readback-verified.

    This is the LIVE view's whole write path. Never staged and never persistent, so it cannot restart the daemon and
    cannot flush what the tabs view has staged.

    Routed through the lane rather than a manager method because the LIVE lane's
    only caller is this route, and `/state` already reads `routing`
    directly for the same reason.
    """
    if not body.fields:
        raise refuse("fields_unknown", "no live fields given")
    fields = dict(body.fields)
    unknown = sorted(set(fields) - set(routing.live_fields()))
    if unknown:
        raise refuse("fields_unknown", f"unknown live fields: {unknown}")
    _stand_autopilot_down(manager, fields)
    try:
        report = await lane.apply_now(manager, fields)
        autosaved = await presetlane.autosave(manager)
        if autosaved is not None:
            report["autosaved"] = autosaved
        return report
    except routing.LiveRouteError as exc:
        # 409, not 422: every field is a real live control and its value was a
        # real option — the engine's current chain or lists are what refuse it,
        # so the reasons are per field and the batch applied nothing.
        raise refuse(exc, exc.reasons) from exc
    except ControlError as exc:
        raise refuse(exc) from exc
