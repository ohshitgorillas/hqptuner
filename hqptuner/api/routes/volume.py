"""Runtime playback-volume surface — read the live volume and its bounds, or set it immediately.

Separate from the staged-config surface: a volume write is never staged, never persistent, and never restarts.
"""

from typing import Any

from fastapi import APIRouter, HTTPException

from hqptuner.api.deps import Mgr
from hqptuner.api.models import VolumeBody
from hqptuner.engine.control import ControlError

router = APIRouter(prefix="/api")


@router.get("/volume")
def volume_get(manager: Mgr) -> dict[str, Any]:
    """Live volume + its live bounds/enabled (VolumeRange).

    Separate from the staged-config surface — this is the runtime playback-volume lane.
    """
    vr = manager.readings.volume_range or {}
    return {
        "volume": (manager.readings.state or {}).get("volume"),
        "min": vr.get("min"),
        "max": vr.get("max"),
        "enabled": vr.get("enabled"),
        "adaptive": vr.get("adaptive"),
    }


@router.post("/volume")
async def volume_set(body: VolumeBody, manager: Mgr) -> dict[str, Any]:
    """Immediate live-volume write — never staged, never restarts.

    503 when volume control is disabled (the slider grays on that state, so this is the race backstop).
    """
    try:
        return await manager.applyops.set_volume(body.level)
    except ControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
