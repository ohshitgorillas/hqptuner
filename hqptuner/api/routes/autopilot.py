"""Auto-pilot REST surface — the high-frequency filter's one app-level switch.

Two routes and no engine write: switching auto-pilot on does not itself move the filter, it only tells auto-pilot's
own background task it may. What the filter does next is that task's (``core/autopilotops.py``), so a browser that
flips the switch sees the change land the way it sees any other background move, through ``GET /api/status``.

Switching on is where the baseline is captured — the filter the user was sitting on at that moment, which is what
auto-pilot returns the engine to whenever the playing track asks for nothing. Captured here rather than in the store
because this is the one point that can see the running engine.
"""

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from hqptuner.api.deps import Mgr
from hqptuner.engine.junkadvisor import NO_FILTER
from hqptuner.engine.metering import context_from
from hqptuner.presets.store.autopilot import AutopilotSchemaError, AutopilotStore

router = APIRouter(prefix="/api")


class AutopilotBody(BaseModel):
    """Auto-pilot's wanted state for ``POST /api/autopilot``."""

    enabled: bool


def _reported(store: AutopilotStore) -> dict[str, Any]:
    return {"enabled": store.enabled, "baseline": store.baseline}


@router.get("/autopilot")
def autopilot(manager: Mgr) -> dict[str, Any]:
    """Auto-pilot's state and the filter it falls back to.

    409 when the store on disk is stamped newer than this HQPTuner reads — reporting "off" would be a lie about a file
    that is there and full.
    """
    try:
        return _reported(manager.presetops.autopilot)
    except AutopilotSchemaError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/autopilot")
def set_autopilot(body: AutopilotBody, manager: Mgr) -> dict[str, Any]:
    """Switch auto-pilot on or off, and answer with the state that was stored.

    Switching on records the engine's currently engaged junk filter as the baseline; an engine that cannot say what is
    engaged leaves the baseline at nothing engaged, which is the honest reading of an answer we do not have.
    """
    try:
        if body.enabled:
            ctx = context_from(manager)
            manager.presetops.autopilot.enable(baseline=(ctx.junk_filter if ctx is not None else None) or NO_FILTER)
        else:
            manager.presetops.autopilot.disable()
        return _reported(manager.presetops.autopilot)
    except AutopilotSchemaError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
