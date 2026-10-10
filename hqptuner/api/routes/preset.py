"""Preset store surface — the load/save/delete dispatcher and the picker's delete button.

Preset reads live in ``configapi``; this module holds only the routes that mutate the store.
"""

import httpx
from fastapi import APIRouter

from hqptuner.api.deps import HttpMgr, Mgr, SavedPreset, preset_refusals
from hqptuner.api.errors import ErrorBody, refuse
from hqptuner.api.models import ProfileBody
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.controlerrors import ControlError
from hqptuner.presets.presetlane import PresetActivation, PresetDeleted

router = APIRouter(prefix="/api")


class UnknownProfileActionError(ErrorBody):
    """``POST /api/profile/{action}`` named a verb outside load, save or delete."""

    code = "not_found"

    def __init__(self, *, action: str) -> None:
        """Render the wording naming the unrecognized ``action``."""
        super().__init__(f"unknown profile action: {action}")


class DeletePresetFailedError(ErrorBody):
    """A preset delete failed on the wire, naming the underlying error."""

    code = "daemon_write_failed"

    def __init__(self, *, error: Exception) -> None:
        """Render the wording naming the ``error`` that stopped the delete."""
        super().__init__(f"Deleting the preset failed: {error}")


async def _load(manager: ConnectionManager, name: str) -> PresetActivation:
    with preset_refusals():
        return await manager.presetops.load_preset(name)


async def _mutate(manager: ConnectionManager, action: str, name: str) -> SavedPreset | PresetDeleted:
    with preset_refusals():
        if action == "save":
            return SavedPreset.of(await manager.presetops.save_preset(name))
        return await manager.presetops.delete_preset(name)


@router.post("/profile/{action}", response_model_exclude_none=True)
async def profile(action: str, body: ProfileBody, manager: Mgr) -> PresetActivation | SavedPreset | PresetDeleted:
    """Load, save, or delete a named preset, dispatching on the path segment.

    404 on an action outside those three or a name the store does not hold, 422 on an empty name.
    """
    if action not in ("load", "save", "delete"):
        raise refuse(UnknownProfileActionError(action=action))
    if action == "load":
        return await _load(manager, body.name)
    return await _mutate(manager, action, body.name)


@router.delete("/preset/{name:path}")
async def delete_preset(name: str, manager: HttpMgr) -> PresetDeleted:
    """Delete a preset from the store and remove its daemon mirror.

    Backs the Delete button on the preset picker.
    """
    try:
        return await manager.presetops.delete_preset(name)
    except (ControlError, httpx.HTTPError) as exc:
        raise refuse(DeletePresetFailedError(error=exc)) from exc
