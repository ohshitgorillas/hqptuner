"""Apply surface — the staged-buffer apply and the live lane's immediate write path.

``/config/apply`` drains the pending buffer through the persistent lane; ``/config/live`` never stages and never
restarts.
"""

import contextlib

from fastapi import APIRouter, Request

from hqptuner.api.deps import Mgr, Reported, SavedPreset, WithSaved, pending_of, preset_refusals
from hqptuner.api.errors import ControlFailedError, ErrorBody, InvalidInputError, refuse
from hqptuner.api.models import ApplyBody, LiveBody
from hqptuner.api.routes.pending import apply_succeeded
from hqptuner.conf.xmledit import GroundingError
from hqptuner.core.applyops import ApplyReport
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.controlerrors import ControlError
from hqptuner.lanes.live import lane, routing
from hqptuner.lanes.live.lane import LiveApplyReport
from hqptuner.presets import presetlane
from hqptuner.presets.store.autopilot import AutopilotError
from hqptuner.presets.store.presets import PresetStore, canonical_name

router = APIRouter(prefix="/api")


class NothingStagedError(ErrorBody):
    """An apply was asked for with nothing staged and no preset switch requested."""

    code = "nothing_staged"

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("nothing staged")


class ApplyFailedError(ControlFailedError):
    """A Control API error that stopped or refused part of a staged apply."""

    template = "Applying the settings failed: {error}"


class LiveFailedError(ControlFailedError):
    """A Control API error that stopped or refused part of a live-lane write."""

    template = "Changing the live settings failed: {error}"


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
) -> WithSaved[ApplyReport] | Reported[ApplyReport]:
    """Save a clean apply into the named preset the request asked for, or answer its report alone when it named none.

    Only called when the apply itself succeeded, so the running config already carries the edits; a save that fails
    refuses the request with its own code.
    """
    if save is None:
        return Reported(report)
    with preset_refusals():
        saved = await presetlane.save(manager, save)
    return WithSaved(report, SavedPreset.of(saved))


def _save_target(body: ApplyBody | None, store: PresetStore) -> str | None:
    """Return the preset name the apply is to be saved as, under the name ``store`` keys it, or None for no save.

    Checked before anything is written: a name the store would refuse, the first-save rule included, refuses the
    request with the save's own code, while the engine is still untouched and the staged edits still pending.
    """
    if body is None or body.save is None:
        return None
    with preset_refusals():
        return store.save_name(body.save.name)


def _switch_target(switch_to: str | None, store: PresetStore) -> str | None:
    """Return the preset switch the apply runs first: a preset name, ``""`` for "(no preset)", or None for no switch.

    Checked before anything is written, as the save target is: a name that is not a preset name, or one ``store`` does
    not hold, refuses the request with the load's own code while the engine is still untouched.
    """
    if switch_to:
        store.read(canonical_name(switch_to))
    return switch_to


async def _apply_staged(
    manager: ConnectionManager,
    live: dict[str, dict[str, str]],
    http: dict[str, str],
    switch_to: str | None,
    save: str | None,
) -> ApplyReport:
    """Run the staged apply, refusing on what stopped it; ``save`` is the preset the apply is being saved as."""
    try:
        return await manager.applyops.apply(live, http, switch_to, save)
    except ControlError as exc:
        raise refuse(ApplyFailedError(error=exc)) from exc
    except GroundingError as exc:
        raise refuse(InvalidInputError(error=exc)) from exc


@router.post("/config/apply")
async def apply(
    request: Request, manager: Mgr, body: ApplyBody | None = None
) -> WithSaved[ApplyReport] | Reported[ApplyReport]:
    """Write everything staged to the daemon, then persist and clear the buffer only if all of it took.

    400 when nothing is staged and no preset switch was asked for. A soft failure returns the report with the buffer
    intact so the user can retry; the persistent lane restarts the daemon and interrupts playback, never gated on.
    """
    store = pending_of(request)
    switch_to = body.switch_to if body else None
    if not store.live and not store.http and switch_to is None:
        raise refuse(NothingStagedError())
    # the staged set as it stands NOW — a clean apply clears the buffer below, so
    # nothing captured after this point can say what was applied
    staged_http, staged_live = dict(store.http), dict(store.live)
    save = _save_target(body, manager.presetops.store)
    switch_to = _switch_target(switch_to, manager.presetops.store)
    try:
        report = await _apply_staged(manager, store.live, store.http, switch_to, save)
    except BaseException:
        # every apply that reached the engine has its row; an abort records it not ok, then propagates
        manager.audit.apply(staged_http, staged_live, switch_to, save, ok=False)
        raise
    ok = apply_succeeded(report)
    manager.audit.apply(staged_http, staged_live, switch_to, save, ok=ok)
    if not ok:
        return Reported(report)  # soft failure — keep staging so the user can retry
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
async def config_live(body: LiveBody, manager: Mgr) -> Reported[LiveApplyReport]:
    """Apply live-lane config-form fields immediately, readback-verified.

    This is the whole write path of the controls that write on the spot. Never staged and never persistent, so it
    cannot restart the daemon and cannot flush the pending buffer.

    Routed through the lane rather than a manager method because ``lane.apply_now``'s
    only callers outside the lane are this route and auto-pilot (``core/autopilotops``),
    and `/state` already reads `routing` directly.
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
        # to send its value — refused by the engine's current chain, mode or lists,
        # outside a field's fixed 0/1 domain, or a pinned rate not sent alone — so
        # the reasons are per field and the batch applied nothing.
        raise refuse(exc, exc.reasons) from exc
    except ControlError as exc:
        raise refuse(LiveFailedError(error=exc)) from exc
    return Reported(report)
