"""Auto-pilot REST surface — the high-frequency filter's one app-level switch.

One route and no engine write: switching auto-pilot on does not itself move the filter, it only tells auto-pilot's
own background task it may. What the filter does next is that task's (``core/autopilotops.py``), so a browser that
flips the switch sees the change land the way it sees any other background move, through ``GET /api/status``.

Switching on captures nothing about the engine. Auto-pilot's resting state is nothing engaged, so a filter that was
engaged when the switch was flipped is released on the next tick unless the playing track asks for it.
"""

from dataclasses import dataclass

from fastapi import APIRouter
from pydantic import BaseModel

from hqptuner.api.deps import Mgr
from hqptuner.presets import presetlane
from hqptuner.presets.store.autopilot import AutopilotStore

router = APIRouter(prefix="/api")


class AutopilotBody(BaseModel):
    """Auto-pilot's wanted state for ``POST /api/autopilot``."""

    enabled: bool


@dataclass(frozen=True)
class AutopilotReport:
    """``POST /api/autopilot``: auto-pilot's current switch state."""

    enabled: bool


def _reported(store: AutopilotStore) -> AutopilotReport:
    return AutopilotReport(enabled=store.enabled)


@router.post("/autopilot")
def set_autopilot(body: AutopilotBody, manager: Mgr) -> AutopilotReport:
    """Switch auto-pilot on or off, and answer with the state that was stored.

    Neither direction reads the engine: what is engaged when the switch is flipped has no bearing on what auto-pilot
    does next.
    """
    presetlane.switch_autopilot(manager, "switch", enabled=body.enabled)
    return _reported(manager.presetops.autopilot)
