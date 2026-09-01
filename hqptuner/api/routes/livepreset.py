"""Live-preset REST surface — the LIVE view's named setting combos.

A self-contained feature surface mounted alongside ``app``. Nothing here touches the
8088 lane, the pending store, or ``store.presets`` — a live preset is applied by
the Phase-2 live lane and so can never restart the daemon.
"""

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel

from hqptuner.api.deps import Mgr
from hqptuner.api.errors import ApiError, refuse
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.control import ControlError
from hqptuner.lanes.live import chain, lane, routing, snapshot
from hqptuner.presets import presetlane
from hqptuner.presets.store.live import LivePresetError, LivePresetSchemaError, LivePresetStore

router = APIRouter(prefix="/api")

# The one record key that is not a live-lane field: auto-pilot is HQPTuner's own
# switch (presets/store/live.py), selectable like the rest.
AUTOPILOT = "autopilot"

# Chain-scoped fields index the enumerations of one chain, so a preset carrying
# any of them has to say which chain to be on — mode rides along unasked.
_CHAIN_SCOPED = frozenset(field for field, spec in routing.ROUTABLE.items() if spec.chain is not None)


class SaveBody(BaseModel):
    """Which settings ``PUT /api/livepresets/{name}`` stores; None keeps everything the engine reports."""

    fields: list[str] | None = None


_UNKNOWN_CHAIN = {"chain": "the engine's active chain is unknown, so there is no live state to snapshot"}


def _store(request: Request) -> LivePresetStore:
    store: LivePresetStore = request.app.state.live_presets
    return store


def _unreadable(exc: LivePresetSchemaError) -> ApiError:
    return refuse(exc)


def _restore_autopilot(manager: ConnectionManager, record: dict[str, Any]) -> None:
    """Put auto-pilot back to what this record carries, or leave it alone when the record omits it (null).

    A record from before auto-pilot existed carries no such key and reads as off. A record that carries auto-pilot on
    and a junk filter of its own applies both, and auto-pilot then releases that filter on its next tick unless the
    playing track asks for it — which is what auto-pilot being on means.
    """
    if record.get(AUTOPILOT, False) is None:
        return
    presetlane.switch_autopilot(manager, "livepreset.apply", enabled=record.get(AUTOPILOT) is True)


def _selected(wanted: list[str] | None) -> set[str] | None:
    """Return the keys a save keeps, mode forced beside any chain-scoped one; None = everything. Unknown key -> 422."""
    if wanted is None:
        return None
    known = {*routing.live_fields(), AUTOPILOT}
    unknown = [key for key in wanted if key not in known]
    if unknown:
        raise refuse("fields_unknown", {"fields": f"not live preset settings: {', '.join(unknown)}"})
    keys = set(wanted)
    if keys & _CHAIN_SCOPED:
        keys.add("mode")
    return keys


def _record(manager: ConnectionManager, keys: set[str] | None) -> dict[str, Any]:
    """Return the record a save stores: the engine's snapshot cut down to ``keys`` (None = all). 409 chain unknown."""
    taken = snapshot.live_snapshot(manager)
    if taken is None:
        raise refuse("chain_unknown", _UNKNOWN_CHAIN)
    kept = {field: item for field, item in taken.items() if keys is None or field in keys}
    return {
        "chain": chain.active_chain(manager),
        "fields": {field: item["value"] for field, item in kept.items()},
        "names": {field: item["name"] for field, item in kept.items()},
        AUTOPILOT: manager.presetops.autopilot.enabled if keys is None or AUTOPILOT in keys else None,
    }


@router.get("/livepresets/snapshot")
def live_snapshot(manager: Mgr) -> dict[str, Any]:
    """Return what a save would store right now, per setting with its display name — what the save popover lists.

    409 when the loaded chain is unknowable, the same refusal a save gives.
    """
    taken = snapshot.live_snapshot(manager)
    if taken is None:
        raise refuse("chain_unknown", _UNKNOWN_CHAIN)
    return {"chain": chain.active_chain(manager), "fields": taken, AUTOPILOT: manager.presetops.autopilot.enabled}


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
def save_live_preset(name: str, request: Request, manager: Mgr, body: SaveBody | None = None) -> dict[str, Any]:
    """Snapshot what the engine is playing right now under this name, overwriting any preset already saved under it.

    A body naming ``fields`` keeps only those settings; the rest are absent from the record and an apply leaves them
    where the engine has them. 409 when the loaded chain is unknowable — the record would claim a chain it never
    captured. 422 when a named field is not a live preset setting.
    """
    record = _record(manager, _selected(None if body is None else body.fields))
    try:
        _store(request).save(name, record)
    except LivePresetSchemaError as exc:
        raise _unreadable(exc) from exc
    except LivePresetError as exc:
        raise refuse(exc) from exc
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
        raise refuse(exc) from exc
    fields = dict(record.get("fields") or {})
    # A preset saved before the LIVE rate control was removed can still carry a
    # "rate" field. It has no live route, so it is dropped and the rest applies.
    fields.pop("rate", None)
    try:
        report = await lane.apply_preset(manager, fields) if fields else {"live": [], "stored": {}}
        _restore_autopilot(manager, record)
        autosaved = await presetlane.autosave(manager)
        if autosaved is not None:
            report["autosaved"] = autosaved
        return report
    except routing.LiveRouteError as exc:
        raise refuse(exc, exc.reasons) from exc
    except ControlError as exc:
        raise refuse(exc) from exc


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
        raise refuse(exc) from exc
    return {"deleted": name}
