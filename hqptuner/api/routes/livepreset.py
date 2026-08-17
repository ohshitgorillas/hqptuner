"""Live-preset REST surface — the LIVE view's named setting combos.

A self-contained feature surface mounted alongside ``app``. Nothing here touches the
8088 lane, the pending store, or ``store.presets`` — a live preset is applied by
the Phase-2 live lane and so can never restart the daemon.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from hqptuner.api.deps import Mgr
from hqptuner.engine.control import ControlError
from hqptuner.lanes.live import chain, lane, routing, snapshot
from hqptuner.presets import presetlane
from hqptuner.presets.store.live import LivePresetError, LivePresetSchemaError, LivePresetStore

router = APIRouter(prefix="/api")


def _store(request: Request) -> LivePresetStore:
    store: LivePresetStore = request.app.state.live_presets
    return store


def _unreadable(exc: LivePresetSchemaError) -> HTTPException:
    return HTTPException(status_code=409, detail=str(exc))


@router.get("/livepresets")
def live_presets(request: Request) -> dict[str, Any]:
    """Every saved live preset.

    Flat: a preset carries its own output mode, so applying one taken on the other chain switches the engine to it
    rather than conflicting with what is loaded — there is nothing here to gate on.
    """
    try:
        presets = _store(request).all()
    except LivePresetSchemaError as exc:
        raise _unreadable(exc) from exc
    return {"presets": [{"name": name, **record} for name, record in presets.items()]}


@router.put("/livepresets/{name}")
def save_live_preset(name: str, request: Request, manager: Mgr) -> dict[str, Any]:
    """Snapshot what the engine is playing right now under this name, overwriting any preset already saved under it.

    409 when the loaded chain is unknowable — the record would claim a chain it never captured.
    """
    taken = snapshot.live_snapshot(manager)
    if taken is None:
        raise HTTPException(
            status_code=409,
            detail={"chain": "the engine's active chain is unknown, so there is no live state to snapshot"},
        )
    record = {
        "chain": chain.active_chain(manager),
        "fields": {field: item["value"] for field, item in taken.items()},
        "names": {field: item["name"] for field, item in taken.items()},
    }
    try:
        _store(request).save(name, record)
    except LivePresetSchemaError as exc:
        raise _unreadable(exc) from exc
    except LivePresetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"name": name, **record}


@router.post("/livepresets/{name}/apply")
async def apply_live_preset(name: str, request: Request, manager: Mgr) -> dict[str, Any]:
    """Apply a saved preset, readback-verified.

    Its output mode goes first and the rest follows against the enumerations that switch produced (``apply_preset``),
    so a preset taken on the other chain applies by switching to it.

    The live lane's all-or-nothing 409 carries over unchanged: a stored ID the
    running enumerations no longer offer refuses the whole preset, naming the
    field.
    """
    try:
        record = _store(request).read(name)
    except LivePresetSchemaError as exc:
        raise _unreadable(exc) from exc
    except LivePresetError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    try:
        report = await lane.apply_preset(manager, record.get("fields") or {})
        autosaved = await presetlane.autosave(manager)
        if autosaved is not None:
            report["autosaved"] = autosaved
        return report
    except routing.LiveRouteError as exc:
        raise HTTPException(status_code=409, detail=exc.reasons) from exc
    except ControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.delete("/livepresets/{name}")
def delete_live_preset(name: str, request: Request) -> dict[str, Any]:
    """Remove a saved live preset from the store, leaving the running engine untouched.

    404 when no preset is saved under the name.
    """
    try:
        _store(request).delete(name)
    except LivePresetSchemaError as exc:
        raise _unreadable(exc) from exc
    except LivePresetError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"deleted": name}
