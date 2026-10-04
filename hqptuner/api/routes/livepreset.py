"""Live-snapshot REST surface — the LIVE view's named setting combos.

A self-contained feature surface mounted alongside ``app``. Nothing here touches the
8088 lane or the pending store — a live snapshot is applied by the Phase-2 live
lane and so can never restart the daemon. ``store.presets`` is read for one fact
only: which station is loaded, its active preset or ``""`` when none is.

Snapshots belong to a station. The list answers the loaded station's beside the
whole book; a save writes to the stations its body names, the loaded one when it
names none; apply and delete take ``?station=``, the loaded one when absent.
"""

from dataclasses import dataclass

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from hqptuner.api.deps import Mgr, WithAutosave, with_autosave
from hqptuner.api.errors import ApiError, ErrorBody, refuse
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.controlerrors import ControlError
from hqptuner.lanes.live import lane, routing, snapshot
from hqptuner.lanes.live.lane import LiveApplyReport
from hqptuner.lanes.live.snapshot import ChainUnknownError
from hqptuner.presets.store.live import (
    DEFAULT_STATION,
    LiveFields,
    LivePresetError,
    LivePresetSchemaError,
    LivePresetStore,
    LiveRecord,
    canonical_name,
)

router = APIRouter(prefix="/api")

# Chain-scoped fields index the enumerations of one chain, so a preset carrying
# any of them has to say which chain to be on — mode rides along unasked.
_CHAIN_SCOPED = frozenset(field for field, spec in routing.ROUTABLE.items() if spec.chain is not None)


class SaveBody(BaseModel):
    """Which settings ``PUT /api/livepresets/{name}`` stores, and under which stations.

    ``fields`` of None keeps everything the engine reports; ``stations`` of None writes to the loaded station alone.
    """

    fields: list[str] | None = None
    stations: list[str] | None = Field(default=None, min_length=1)


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

    @classmethod
    def of(cls, name: str, record: LiveRecord) -> "NamedLiveRecord":
        """Name ``record``, copying its fields."""
        return cls(name, record.chain, dict(record.fields), dict(record.names))


@dataclass(frozen=True)
class LivePresetList:
    """``GET /api/livepresets``: the loaded station, its saved live snapshots, and every station's, by name."""

    station: str
    presets: list[NamedLiveRecord]
    stations: dict[str, dict[str, LiveRecord]]


@dataclass(frozen=True)
class LiveSnapshotView:
    """``GET /api/livepresets/snapshot``: what a save would store now, per setting ``{value, name}``."""

    chain: str
    fields: dict[str, dict[str, str]]


@dataclass(frozen=True)
class LivePresetDeleted:
    """``DELETE /api/livepresets/{name}``: the key the store held."""

    deleted: str


def _store(request: Request) -> LivePresetStore:
    store: LivePresetStore = request.app.state.live_presets
    return store


def _unreadable(exc: LivePresetSchemaError) -> ApiError:
    return refuse(exc)


def _loaded(manager: ConnectionManager) -> str:
    """Return the loaded station: the active config preset, or the unnamed default when none is."""
    return manager.presetops.store.active or DEFAULT_STATION


def _selected(wanted: list[str] | None) -> set[str] | None:
    """Return the keys a save keeps, mode forced beside any chain-scoped one; None = everything. Unknown key -> 422."""
    if wanted is None:
        return None
    known = set(snapshot.SNAPSHOT_FIELDS)
    unknown = [key for key in wanted if key not in known]
    if unknown:
        raise refuse(NotLiveSnapshotSettingsError(unknown=unknown))
    keys = set(wanted)
    if keys & _CHAIN_SCOPED:
        keys.add("mode")
    return keys


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
    return LiveSnapshotView(taken.chain, taken.fields)


@router.get("/livepresets")
def live_presets(request: Request, manager: Mgr) -> LivePresetList:
    """Return the loaded station, its saved live snapshots as ``presets``, and the whole book as ``stations``.

    Not judged against the engine: a preset carries its own output mode, so applying one taken on the other chain
    switches the engine to it rather than conflicting with what is loaded — there is nothing here to gate on.
    """
    station = _loaded(manager)
    try:
        book = _store(request).book()
    except LivePresetSchemaError as exc:
        raise _unreadable(exc) from exc
    presets = [NamedLiveRecord.of(name, record) for name, record in book.get(station, {}).items()]
    return LivePresetList(station, presets, book)


@router.put("/livepresets/{name:path}")
def save_live_preset(name: str, request: Request, manager: Mgr, body: SaveBody | None = None) -> NamedLiveRecord:
    """Snapshot what the engine is playing right now under this name, overwriting any preset already saved under it.

    A body naming ``fields`` keeps only those settings; the rest are absent from the record and an apply leaves them
    where the engine has them. A body naming ``stations`` writes the one record under each; none named writes it
    under the loaded station. 409 when the loaded chain is unknowable — the record would claim a chain it never
    captured. 422 when a named field is not a live snapshot setting, or a named station is not one the preset store
    holds.
    """
    # Name first, engine second: a name the rule refuses is refused as one whatever
    # the engine is doing, rather than being answered by whatever the snapshot
    # refuses first.
    try:
        name = canonical_name(name)  # the response names the key the store holds
    except LivePresetError as exc:
        raise refuse(exc) from exc
    record = _record(manager, _selected(None if body is None else body.fields))
    stations = body.stations if body is not None and body.stations is not None else [_loaded(manager)]
    try:
        _store(request).save(name, record, stations)
    except LivePresetSchemaError as exc:
        raise _unreadable(exc) from exc
    except LivePresetError as exc:
        raise refuse(exc) from exc
    return NamedLiveRecord.of(name, record)


@router.post("/livepresets/{name:path}/apply", response_model_exclude_none=True)
async def apply_live_preset(
    name: str, request: Request, manager: Mgr, station: str | None = None
) -> WithAutosave[LiveApplyReport]:
    """Apply a preset saved under ``station``, the loaded one when absent, readback-verified.

    Its output mode goes first and the rest follows against the enumerations that switch produced (``apply_preset``),
    so a preset taken on the other chain applies by switching to it.

    The live lane's all-or-nothing 409 carries over unchanged: a stored ID the
    running enumerations no longer offer refuses the whole preset, naming the
    field.
    """
    try:
        record = _store(request).read(_loaded(manager) if station is None else station, name)
    except LivePresetSchemaError as exc:
        raise _unreadable(exc) from exc
    except LivePresetError as exc:
        raise refuse(exc) from exc
    fields = dict(record.fields)
    # A preset record may carry a "rate" field. No snapshot holds a pinned rate
    # (`lanes/live/rate`), so it is dropped and the rest applies.
    fields.pop("rate", None)
    try:
        report = await lane.apply_preset(manager, fields) if fields else LiveApplyReport()
    except routing.LiveRouteError as exc:
        raise refuse(exc, exc.reasons) from exc
    except ControlError as exc:
        raise refuse(exc) from exc
    return await with_autosave(report, manager)


@router.delete("/livepresets/{name:path}")
def delete_live_preset(name: str, request: Request, manager: Mgr, station: str | None = None) -> LivePresetDeleted:
    """Remove a live snapshot from ``station``, the loaded one when absent, leaving the running engine untouched.

    Another station's snapshot under the same name stays. 404 when ``station`` holds no preset under the name.
    """
    try:
        name = canonical_name(name)  # the response names the key the store held
        _store(request).delete(_loaded(manager) if station is None else station, name)
    except LivePresetSchemaError as exc:
        raise _unreadable(exc) from exc
    except LivePresetError as exc:
        raise refuse(exc) from exc
    return LivePresetDeleted(name)
