"""Preset store surface — the load/save/delete dispatcher and the picker's delete button.

Preset reads live in ``configapi``; this module holds only the routes that mutate the store.
"""

from typing import Any

import httpx
from fastapi import APIRouter, HTTPException

from hqptuner.api.deps import HttpMgr, Mgr
from hqptuner.api.models import ProfileBody
from hqptuner.engine.control import ControlError
from hqptuner.presets.store.presets import PresetError

router = APIRouter(prefix="/api")


@router.post("/profile/{action}")
async def profile(action: str, body: ProfileBody, manager: Mgr) -> dict[str, Any]:
    """Load, save, or delete a named preset, dispatching on the path segment.

    404 on an action outside those three or a name the store does not hold, 422 on an empty name.
    """
    methods = {
        "load": manager.presetops.load_preset,
        "save": manager.presetops.save_preset,
        "delete": manager.presetops.delete_preset,
    }
    if action not in methods:
        raise HTTPException(status_code=404, detail=f"unknown profile action: {action}")
    if not body.name:
        raise HTTPException(status_code=422, detail="profile name required")
    try:
        return await methods[action](body.name)
    except PresetError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.delete("/preset/{name}")
async def delete_preset(name: str, manager: HttpMgr) -> dict[str, Any]:
    """Delete a preset from the store and remove its daemon mirror.

    Backs the Delete button on the preset picker.
    """
    try:
        return await manager.presetops.delete_preset(name)
    except PresetError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ControlError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=f"delete preset failed: {exc}") from exc
