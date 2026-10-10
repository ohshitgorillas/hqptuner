"""Runtime playback-volume surface — read the live volume and its bounds, or set it immediately.

Separate from the staged-config surface: a volume write is never staged, never persistent, and never restarts.
"""

from dataclasses import dataclass

from fastapi import APIRouter

from hqptuner.api.deps import Mgr
from hqptuner.api.errors import ControlFailedError, refuse
from hqptuner.api.models import VolumeBody
from hqptuner.core.applyops import VolumeReport
from hqptuner.engine.controlerrors import ControlError

router = APIRouter(prefix="/api")


class VolumeFailedError(ControlFailedError):
    """A Control API error that stopped or refused a volume write."""

    template = "Changing the volume failed: {error}"


@dataclass(frozen=True)
class VolumeReading:
    """``GET /api/volume``: the live volume and its live bounds/enabled (VolumeRange)."""

    volume: str | None
    min: str | None
    max: str | None
    enabled: str | None
    adaptive: str | None


@router.get("/volume")
def volume_get(manager: Mgr) -> VolumeReading:
    """Live volume + its live bounds/enabled (VolumeRange).

    Separate from the staged-config surface — this is the runtime playback-volume lane.
    """
    vr = manager.readings.volume_range or {}
    return VolumeReading(
        volume=(manager.readings.state or {}).get("volume"),
        min=vr.get("min"),
        max=vr.get("max"),
        enabled=vr.get("enabled"),
        adaptive=vr.get("adaptive"),
    )


@router.post("/volume")
async def volume_set(body: VolumeBody, manager: Mgr) -> VolumeReport:
    """Immediate live-volume write — never staged, never restarts.

    503 when volume control is disabled (the slider grays on that state, so this is the race backstop).
    """
    try:
        return await manager.applyops.set_volume(body.level)
    except ControlError as exc:
        raise refuse(VolumeFailedError(error=exc)) from exc
