"""Apply surface — the staged-buffer apply and the LIVE view's immediate write path.

``/config/apply`` drains the pending buffer through the persistent lane; ``/config/live`` never stages and never
restarts. Both fold a clean write into a preset when auto-save is armed.
"""

import contextlib

from fastapi import APIRouter, Request

from hqptuner.api.deps import Mgr, SavedPreset, WithAutosave, WithSaved, preset_refusals, with_autosave
from hqptuner.api.errors import ErrorBody, InvalidInputError, refuse
from hqptuner.api.models import ApplyBody, LiveBody
from hqptuner.api.routes.pending import apply_succeeded, pending_store
from hqptuner.conf.httpauth import HttpLaneDeclinedError
from hqptuner.conf.xmledit import GroundingError
from hqptuner.core.applyops import ApplyReport
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.controlerrors import ControlError
from hqptuner.lanes.http.restore import RestoreWriteFailedError
from hqptuner.lanes.live import lane, routing
from hqptuner.lanes.live.lane import LiveApplyReport
from hqptuner.presets import presetlane
from hqptuner.presets.store.autopilot import AutopilotError

router = APIRouter(prefix="/api")


class NothingStagedError(ErrorBody):
    """An apply was asked for with nothing staged and no preset switch requested."""

    code = "nothing_staged"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("nothing staged")


class NoLiveFieldsGivenError(ErrorBody):
    """A live-lane apply named no fields at all."""

    code = "fields_unknown"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("no live fields given")


class UnknownLiveFieldsError(ErrorBody):
    """A live-lane apply named fields that are not live-lane fields at all."""

    code = "fields_unknown"

    def __init__(self, *, unknown: list[str]) -> None:
        """Render the wording naming the ``unknown`` field names, sorted."""
        super().__init__(f"unknown live fields: {unknown}")


async def _persist_after_apply(
    manager: ConnectionManager, save: str | None, report: ApplyReport
) -> WithSaved[ApplyReport] | WithAutosave[ApplyReport]:
    """Fold a clean apply into a preset.

    The target is the named preset the request asked for, or whatever auto-save is armed for when it asked for none.
    Only called when the apply itself succeeded, so the running config already carries the edits; a save that fails
    refuses the request with its own code.
    """
    if save is None:
        return await with_autosave(report, manager)
    with preset_refusals():
        saved = await manager.presetops.save_preset(save)
    return WithSaved(report, SavedPreset.of(saved))


@router.post("/config/apply")
async def apply(
    request: Request, manager: Mgr, body: ApplyBody | None = None
) -> WithSaved[ApplyReport] | WithAutosave[ApplyReport]:
    """Write everything staged to the daemon, then persist and clear the buffer only if all of it took.

    400 when nothing is staged and no preset switch was asked for. A soft failure returns the report with the buffer
    intact so the user can retry; the persistent lane restarts the daemon and interrupts playback, never gated on.
    """
    store = pending_store(request)
    switch_to = body.switch_to if body else None
    if not store.live and not store.http and switch_to is None:
        raise refuse(NothingStagedError())
    # the staged set as it stands NOW — a clean apply clears the buffer below, so
    # nothing captured after this point can say what was applied
    staged_http, staged_live = dict(store.http), dict(store.live)
    save = body.save.name if body is not None and body.save is not None else None
    try:
        report = await manager.applyops.apply(store.live, store.http, switch_to)
    except (ControlError, HttpLaneDeclinedError, RestoreWriteFailedError) as exc:
        raise refuse(exc) from exc
    except GroundingError as exc:
        raise refuse(InvalidInputError(error=exc)) from exc
    ok = apply_succeeded(report)
    manager.audit.apply(staged_http, staged_live, switch_to, save, ok=ok)
    if not ok:
        return WithAutosave(report, None)  # soft failure — keep staging so the user can retry
    # cleared before the save: the edits are on the daemon now, so a save that fails leaves nothing to re-apply
    store.clear()
    return await _persist_after_apply(manager, save, report)


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


@router.post("/config/live", response_model_exclude_none=True)
async def config_live(body: LiveBody, manager: Mgr) -> WithAutosave[LiveApplyReport]:
    """Apply live-lane config-form fields immediately, readback-verified.

    This is the LIVE view's whole write path. Never staged and never persistent, so it cannot restart the daemon and
    cannot flush what the tabs view has staged.

    Routed through the lane rather than a manager method because the LIVE lane's
    only caller is this route, and `/state` already reads `routing`
    directly for the same reason.
    """
    if not body.fields:
        raise refuse(NoLiveFieldsGivenError())
    fields = dict(body.fields)
    unknown = sorted(set(fields) - set(routing.live_fields()))
    if unknown:
        raise refuse(UnknownLiveFieldsError(unknown=unknown))
    _stand_autopilot_down(manager, fields)
    try:
        report = await lane.apply_now(manager, fields)
    except routing.LiveRouteError as exc:
        # 409, not 422: every field is a real live control, and the lane declined
        # to send its value — refused by the engine's current chain or lists, or
        # outside a field's fixed 0/1 domain — so the reasons are per field and
        # the batch applied nothing.
        raise refuse(exc, exc.reasons) from exc
    except ControlError as exc:
        raise refuse(exc) from exc
    return await with_autosave(report, manager)
