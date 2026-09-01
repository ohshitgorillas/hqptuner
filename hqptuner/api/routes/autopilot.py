"""Auto-pilot REST surface — the high-frequency filter's one app-level switch.

Two routes and no engine write: switching auto-pilot on does not itself move the filter, it only tells auto-pilot's
own background task it may. What the filter does next is that task's (``core/autopilotops.py``), so a browser that
flips the switch sees the change land the way it sees any other background move, through ``GET /api/status``.

Switching on captures nothing about the engine. Auto-pilot's resting state is nothing engaged, so a filter that was
engaged when the switch was flipped is released on the next tick unless the playing track asks for it.
"""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from hqptuner.api.deps import Mgr
from hqptuner.api.errors import refuse
from hqptuner.presets import presetlane
from hqptuner.presets.store.autopilot import AutopilotSchemaError, AutopilotStore

router = APIRouter(prefix="/api")


class AutopilotBody(BaseModel):
    """Auto-pilot's wanted state for ``POST /api/autopilot``."""

    enabled: bool


def _reported(store: AutopilotStore) -> dict[str, Any]:
    return {"enabled": store.enabled}


@router.get("/autopilot")
def autopilot(manager: Mgr) -> dict[str, Any]:
    """Auto-pilot's state.

    409 when the store on disk is stamped newer than this HQPTuner reads — reporting "off" would be a lie about a file
    that is there and full.
    """
    try:
        return _reported(manager.presetops.autopilot)
    except AutopilotSchemaError as exc:
        raise refuse(exc) from exc


@router.post("/autopilot")
def set_autopilot(body: AutopilotBody, manager: Mgr) -> dict[str, Any]:
    """Switch auto-pilot on or off, and answer with the state that was stored.

    Neither direction reads the engine: what is engaged when the switch is flipped has no bearing on what auto-pilot
    does next.
    """
    try:
        presetlane.switch_autopilot(manager, "switch", enabled=body.enabled)
        # With auto-save armed, the active preset carries the switch too — otherwise loading that preset would
        # restore the copy as it stood before this flip and undo it (presetlane.stamp_autopilot_on_active).
        presetlane.stamp_autopilot_on_active(manager)
        return _reported(manager.presetops.autopilot)
    except AutopilotSchemaError as exc:
        raise refuse(exc) from exc
