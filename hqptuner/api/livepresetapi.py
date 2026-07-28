"""Live-preset REST surface — the LIVE view's named setting combos.

Split out of ``app`` by the file-length gate, the same way ``matrixapi`` is: a
self-contained feature surface mounted alongside it. Nothing here touches the
8088 lane, the pending store, or ``presetstore`` — a live preset is applied by
the Phase-2 live lane and so can never restart the daemon.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from ..control import ControlError
from ..lanes import livelane, livemap
from ..livepresets import LivePresetError, LivePresetSchemaError, LivePresetStore
from .deps import Mgr

router = APIRouter(prefix="/api")


def _store(request: Request) -> LivePresetStore:
    store: LivePresetStore = request.app.state.live_presets
    return store


def _unreadable(exc: LivePresetSchemaError) -> HTTPException:
    return HTTPException(status_code=409, detail=str(exc))


@router.get("/livepresets")
def live_presets(request: Request, manager: Mgr) -> dict[str, Any]:
    """Every saved live preset, each flagged against the chain the engine has
    loaded right now. An off-chain preset is still listed — its filter and shaper
    IDs belong to the other chain's enumeration and would not resolve, so the card
    shows it as incompatible rather than hiding it and losing the user's work."""
    try:
        presets = _store(request).all()
    except LivePresetSchemaError as exc:
        raise _unreadable(exc) from exc
    chain = livemap.active_chain(manager)
    listed = [{"name": name, **record, "compatible": record.get("chain") == chain} for name, record in presets.items()]
    return {"chain": chain, "presets": listed}


@router.put("/livepresets/{name}")
def save_live_preset(name: str, request: Request, manager: Mgr) -> dict[str, Any]:
    """Snapshot what the engine is playing right now under this name, overwriting
    any preset already saved under it. 409 when the loaded chain is unknowable —
    the record would claim a chain it never captured."""
    snapshot = livemap.live_snapshot(manager)
    if snapshot is None:
        raise HTTPException(
            status_code=409,
            detail={"chain": "the engine's active chain is unknown, so there is no live state to snapshot"},
        )
    record = {
        "chain": livemap.active_chain(manager),
        "fields": {field: item["value"] for field, item in snapshot.items()},
        "names": {field: item["name"] for field, item in snapshot.items()},
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
    """Apply a saved preset as one live batch, readback-verified. The live lane's
    all-or-nothing 409 carries over unchanged: a stored ID the running
    enumerations no longer offer refuses the whole preset, naming the field."""
    try:
        record = _store(request).read(name)
    except LivePresetSchemaError as exc:
        raise _unreadable(exc) from exc
    except LivePresetError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    chain = livemap.active_chain(manager)
    if record.get("chain") != chain:
        raise HTTPException(
            status_code=409,
            detail={"chain": f"this preset holds {record.get('chain')} settings (engine chain: {chain or 'unknown'})"},
        )
    try:
        return await livelane.apply_now(manager, record.get("fields") or {})
    except livemap.LiveRouteError as exc:
        raise HTTPException(status_code=409, detail=exc.reasons) from exc
    except ControlError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.delete("/livepresets/{name}")
def delete_live_preset(name: str, request: Request) -> dict[str, Any]:
    try:
        _store(request).delete(name)
    except LivePresetSchemaError as exc:
        raise _unreadable(exc) from exc
    except LivePresetError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"deleted": name}
