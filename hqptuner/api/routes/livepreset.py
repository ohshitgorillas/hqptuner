"""Live-snapshot REST surface — the LIVE view's named setting combos.

A self-contained feature surface mounted alongside ``app``. Nothing here touches the
8088 lane, the pending store, or ``store.presets`` — a live snapshot is applied by
the Phase-2 live lane and so can never restart the daemon.
"""

from dataclasses import dataclass

from fastapi import APIRouter, Request
from pydantic import BaseModel

from hqptuner.api.deps import Mgr, WithAutosave, with_autosave
from hqptuner.api.errors import ApiError, ErrorBody, refuse
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.controlerrors import ControlError
from hqptuner.lanes.live import lane, routing, snapshot
from hqptuner.lanes.live.lane import LiveApplyReport
from hqptuner.lanes.live.snapshot import ChainUnknownError
from hqptuner.presets import presetlane
from hqptuner.presets.store.live import (
    LiveFields,
    LivePresetError,
    LivePresetSchemaError,
    LivePresetStore,
    LiveRecord,
    canonical_name,
)

router = APIRouter(prefix="/api")

# The one record key that is not a live-lane field: autopilot is HQPTuner's own
# switch, selectable like the rest.
AUTOPILOT = "autopilot"

# Chain-scoped fields index the enumerations of one chain, so a preset carrying
# any of them has to say which chain to be on — mode rides along unasked.
_CHAIN_SCOPED = frozenset(field for field, spec in routing.ROUTABLE.items() if spec.chain is not None)


class SaveBody(BaseModel):
    """Which settings ``PUT /api/livepresets/{name}`` stores; None keeps everything the engine reports."""

    fields: list[str] | None = None


class NotLiveSnapshotSettingsError(ErrorBody):
    """A save or snapshot named fields that are not live snapshot settings at all."""

    code = "fields_unknown"

    def __init__(self, *, unknown: list[str]) -> None:
        """Render the per-field reasons dict naming the ``unknown`` field names, in the order given."""
        super().__init__({"fields": f"not live snapshot settings: {', '.join(unknown)}"})


@dataclass(frozen=True)
class NamedLiveRecord:
    """One saved live snapshot as the routes answer with it: its name beside the record's own fields."""

    name: str
    chain: str
    fields: LiveFields
    names: dict[str, str]
    autopilot: bool | None

    @classmethod
    def of(cls, name: str, record: LiveRecord) -> "NamedLiveRecord":
        """Name ``record``, copying its fields."""
        return cls(name, record.chain, dict(record.fields), dict(record.names), record.autopilot)


@dataclass(frozen=True)
class LivePresetList:
    """``GET /api/livepresets``: every saved live snapshot."""

    presets: list[NamedLiveRecord]


@dataclass(frozen=True)
class LiveSnapshotView:
    """``GET /api/livepresets/snapshot``: what a save would store now, per setting ``{value, name}``, and auto-pilot."""

    chain: str
    fields: dict[str, dict[str, str]]
    autopilot: bool | None


@dataclass(frozen=True)
class LivePresetDeleted:
    """``DELETE /api/livepresets/{name}``: the key the store held."""

    deleted: str


def _store(request: Request) -> LivePresetStore:
    store: LivePresetStore = request.app.state.live_presets
    return store


def _unreadable(exc: LivePresetSchemaError) -> ApiError:
    return refuse(exc)


def _restore_autopilot(manager: ConnectionManager, record: LiveRecord) -> None:
    """Put auto-pilot back to what this record carries, or leave it alone when the record omits it (null).

    A record from before auto-pilot existed carries no such key and reads as off. A record that carries auto-pilot on
    and a junk filter of its own applies both, and auto-pilot then releases that filter on its next tick unless the
    playing track asks for it — which is what auto-pilot being on means.
    """
    if record.autopilot is None:
        return
    presetlane.switch_autopilot(manager, "livepreset.apply", enabled=record.autopilot is True)


def _selected(wanted: list[str] | None) -> set[str] | None:
    """Return the keys a save keeps, mode forced beside any chain-scoped one; None = everything. Unknown key -> 422."""
    if wanted is None:
        return None
    known = {*routing.live_fields(), AUTOPILOT}
    unknown = [key for key in wanted if key not in known]
    if unknown:
        raise refuse(NotLiveSnapshotSettingsError(unknown=unknown))
    keys = set(wanted)
    if keys & _CHAIN_SCOPED:
        keys.add("mode")
    return keys


def _autopilot_now(manager: ConnectionManager) -> bool | None:
    """Return auto-pilot's switch as a save would record it, or None while the advisor is off and it has no meaning."""
    return manager.presetops.autopilot.enabled if manager.cfg.advisor_enabled else None


def _record(manager: ConnectionManager, keys: set[str] | None) -> LiveRecord:
    """Return the record a save stores: the engine's snapshot cut down to ``keys`` (None = all). 409 chain unknown."""
    try:
        taken = snapshot.live_snapshot(manager)
    except ChainUnknownError as exc:
        raise refuse(exc, exc.reasons) from exc
    kept = {field: item for field, item in taken.fields.items() if keys is None or field in keys}
    return LiveRecord(
        chain=taken.chain,
        fields={field: item["value"] for field, item in kept.items()},
        names={field: item["name"] for field, item in kept.items()},
        autopilot=_autopilot_now(manager) if keys is None or AUTOPILOT in keys else None,
    )


@router.get("/livepresets/snapshot")
def live_snapshot(manager: Mgr) -> LiveSnapshotView:
    """Return what a save would store right now, per setting with its display name — what the save popover lists.

    409 when the loaded chain is unknowable, the same refusal a save gives.
    """
    try:
        taken = snapshot.live_snapshot(manager)
    except ChainUnknownError as exc:
        raise refuse(exc, exc.reasons) from exc
    return LiveSnapshotView(taken.chain, taken.fields, _autopilot_now(manager))


@router.get("/livepresets")
def live_presets(request: Request) -> LivePresetList:
    """Every saved live snapshot.

    Flat: a preset carries its own output mode, so applying one taken on the other chain switches the engine to it
    rather than conflicting with what is loaded — there is nothing here to gate on.
    """
    try:
        presets = _store(request).all()
    except LivePresetSchemaError as exc:
        raise _unreadable(exc) from exc
    return LivePresetList([NamedLiveRecord.of(name, record) for name, record in presets.items()])


@router.put("/livepresets/{name:path}")
def save_live_preset(name: str, request: Request, manager: Mgr, body: SaveBody | None = None) -> NamedLiveRecord:
    """Snapshot what the engine is playing right now under this name, overwriting any preset already saved under it.

    A body naming ``fields`` keeps only those settings; the rest are absent from the record and an apply leaves them
    where the engine has them. 409 when the loaded chain is unknowable — the record would claim a chain it never
    captured. 422 when a named field is not a live snapshot setting.
    """
    # Name first, engine second: a name the rule refuses is refused as one whatever
    # the engine is doing, rather than being answered by whatever the snapshot
    # refuses first.
    try:
        name = canonical_name(name)  # the response names the key the store holds
    except LivePresetError as exc:
        raise refuse(exc) from exc
    record = _record(manager, _selected(None if body is None else body.fields))
    try:
        _store(request).save(name, record)
    except LivePresetSchemaError as exc:
        raise _unreadable(exc) from exc
    except LivePresetError as exc:
        raise refuse(exc) from exc
    return NamedLiveRecord.of(name, record)


@router.post("/livepresets/{name:path}/apply", response_model_exclude_none=True)
async def apply_live_preset(name: str, request: Request, manager: Mgr) -> WithAutosave[LiveApplyReport]:
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
    fields = dict(record.fields)
    # A preset record may carry a "rate" field. It has no live route, so it is
    # dropped and the rest applies.
    fields.pop("rate", None)
    try:
        report = await lane.apply_preset(manager, fields) if fields else LiveApplyReport()
    except routing.LiveRouteError as exc:
        raise refuse(exc, exc.reasons) from exc
    except ControlError as exc:
        raise refuse(exc) from exc
    _restore_autopilot(manager, record)
    return await with_autosave(report, manager)


@router.delete("/livepresets/{name:path}")
def delete_live_preset(name: str, request: Request) -> LivePresetDeleted:
    """Remove a saved live snapshot from the store, leaving the running engine untouched.

    404 when no preset is saved under the name.
    """
    try:
        name = canonical_name(name)  # the response names the key the store held
        _store(request).delete(name)
    except LivePresetSchemaError as exc:
        raise _unreadable(exc) from exc
    except LivePresetError as exc:
        raise refuse(exc) from exc
    return LivePresetDeleted(name)
