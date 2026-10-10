"""Live-snapshot REST surface — the LIVE view's named setting combos.

A self-contained feature surface mounted alongside ``app``. Nothing here touches the
8088 lane or the pending store — a live snapshot is applied by the Phase-2 live
lane and so can never restart the daemon. ``store.presets`` is read for one fact
only: which station is loaded, its active preset or ``""`` when none is.

Snapshots belong to a station. The list answers the loaded station's beside the
whole book; a save writes to the stations its body names, the loaded one when it
names none; apply and delete take ``?station=``, the loaded one when absent.
"""

from collections.abc import Callable
from dataclasses import dataclass

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from hqptuner.api.deps import Mgr, WithAutosave, with_autosave
from hqptuner.api.errors import ApiError, ControlFailedError, ErrorBody, refuse
from hqptuner.api.routes.matrix.matrix import MatrixSwitchRefusedError
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.controlerrors import ControlError
from hqptuner.lanes import matrixlane
from hqptuner.lanes.live import lane, routing, snapshot
from hqptuner.lanes.live.chain import PCM, SDM
from hqptuner.lanes.live.lane import LiveApplyReport
from hqptuner.lanes.live.snapshot import DEFAULT_PROFILE_NAME, MATRIX_PROFILE, ChainUnknownError, LiveSnapshot
from hqptuner.presets.store.live import (
    DEFAULT_STATION,
    LiveFields,
    LivePresetSchemaError,
    LivePresetStore,
    LiveRecord,
    canonical_name,
)

router = APIRouter(prefix="/api")

# Chain-scoped fields index the enumerations of one chain, so a preset carrying
# any of them has to say which chain to be on — mode rides along unasked.
_CHAIN_SCOPED = frozenset(field for field, spec in routing.ROUTABLE.items() if spec.chain is not None)

_FLAGS = frozenset({"0", "1"})


class SaveBody(BaseModel):
    """Which settings ``PUT /api/livepresets/{name}`` stores, and under which stations.

    ``fields`` of None keeps everything the engine reports; ``stations`` of None writes to the loaded station alone.
    """

    fields: list[str] | None = None
    stations: list[str] | None = Field(default=None, min_length=1)
    values: dict[str, str] | None = None


class LivePresetApplyFailedError(ControlFailedError):
    """A Control API error that stopped or refused part of a live preset's apply."""

    template = "Applying the live preset failed: {error}"


class NotLiveSnapshotSettingsError(ErrorBody):
    """A save or snapshot named fields that are not live snapshot settings at all."""

    code = "fields_unknown"

    def __init__(self, *, unknown: list[str]) -> None:
        """Render the per-field reasons dict naming the ``unknown`` field names, in the order given."""
        super().__init__({"fields": f"not live snapshot settings: {', '.join(unknown)}"})


class ValuesUnknownError(ErrorBody):
    """A save gave values its record cannot hold: a setting it does not keep, or a value its chain does not offer."""

    code = "values_unknown"

    def __init__(self, *, reasons: dict[str, str]) -> None:
        """Render the per-field reasons dict, one reason per refused value, keyed by its field."""
        super().__init__(dict(reasons))


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


def _mode_name(manager: ConnectionManager, value: str) -> str | None:
    """Return the display name of a given output mode, or None when it is not pcm or sdm."""
    if value not in (PCM, SDM):
        return None
    want = routing.MODE_NAMES[value]
    items = (manager.readings.enums or {}).get("modes") or []
    return next((str(item["name"]) for item in items if str(item.get("name") or "").startswith(want)), want)


def _profile_name(manager: ConnectionManager, value: str) -> str | None:
    """Return DEFAULT_PROFILE_NAME for ``""``, the name itself when the engine lists it, else None."""
    if value == "":
        return DEFAULT_PROFILE_NAME
    return value if value in (manager.readings.matrix_profiles or []) else None


def _profile_unlisted(value: str) -> str:
    """Why a matrix profile cannot be stored or applied: the engine does not list it."""
    return f"{value!r} is not a matrix profile the engine lists"


_NAMERS: dict[str, Callable[[ConnectionManager, str], str | None]] = {"mode": _mode_name, MATRIX_PROFILE: _profile_name}


def _given_name(manager: ConnectionManager, loaded: str, field: str, value: str) -> str | None:
    """Return the display name a given value is stored under, or None when the record cannot hold it.

    A field of the chain the engine has not loaded has no enumeration to join through, so it is its own name.
    """
    if (namer := _NAMERS.get(field)) is not None:
        return namer(manager, value)
    if field in routing.DIRECT:
        return value if value in _FLAGS else None
    spec = routing.ROUTABLE[field]
    if spec.chain != loaded:
        return value
    items = (manager.readings.enums or {}).get(spec.enum) or []
    return next((str(item.get("name") or value) for item in items if str(item.get("value")) == value), None)


def _why_refused(field: str, value: str) -> str:
    """Why a given value of a kept field cannot be stored, in terms the save popover can show."""
    if field == "mode":
        return f"{value!r} is not pcm or sdm"
    if field in routing.DIRECT:
        return f"{value!r} is not a 0/1 flag"
    if field == MATRIX_PROFILE:
        return _profile_unlisted(value)
    return f"{value} is not in the engine's live {routing.ROUTABLE[field].enum} list"


def _given(
    manager: ConnectionManager, loaded: str, keys: set[str] | None, values: dict[str, str]
) -> dict[str, dict[str, str]]:
    """Return each given value as ``{value, name}``. 422 naming every value the record cannot hold."""
    allowed = set(snapshot.SNAPSHOT_FIELDS) if keys is None else keys
    given: dict[str, dict[str, str]] = {}
    reasons: dict[str, str] = {}
    for field, value in values.items():
        if field not in allowed:
            reasons[field] = "not a setting this save keeps"
        elif (name := _given_name(manager, loaded, field, value)) is None:
            reasons[field] = _why_refused(field, value)
        else:
            given[field] = {"value": value, "name": name}
    if reasons:
        raise refuse(ValuesUnknownError(reasons=reasons))
    return given


def _kept(taken: LiveSnapshot, keys: set[str] | None, chain: str) -> dict[str, dict[str, str]]:
    """Return the snapshot's fields among ``keys`` (None = all), less the old chain's when ``chain`` is another."""
    return {
        field: item
        for field, item in taken.fields.items()
        if (keys is None or field in keys) and (chain == taken.chain or field not in _CHAIN_SCOPED)
    }


def _record(manager: ConnectionManager, keys: set[str] | None, values: dict[str, str] | None) -> LiveRecord:
    """Return the record a save stores: the engine's snapshot cut down to ``keys`` (None = all), ``values`` over it.

    A given mode sets the record's chain; on a change the snapshot's fields of the old chain leave the record.
    409 chain unknown.
    """
    try:
        taken = snapshot.live_snapshot(manager)
    except ChainUnknownError as exc:
        raise refuse(exc, exc.reasons) from exc
    given = _given(manager, taken.chain, keys, values or {})
    chain = given["mode"]["value"] if "mode" in given else taken.chain
    kept = _kept(taken, keys, chain) | given
    return LiveRecord(
        chain=chain,
        fields={field: item["value"] for field, item in kept.items()},
        names={field: item["name"] for field, item in kept.items()},
    )


def _check_profile(manager: ConnectionManager, profile: str | None) -> None:
    """409 when a preset's matrix profile is one the engine does not list, before anything is applied."""
    if profile is not None and _profile_name(manager, profile) is None:
        exc = routing.LiveRouteError({MATRIX_PROFILE: _profile_unlisted(profile)})
        raise refuse(exc, exc.reasons)


async def _switch_profile(manager: ConnectionManager, profile: str | None) -> None:
    """Switch the engine to a preset's matrix profile when it is on another; a daemon refusal is translated."""
    if profile is None or (manager.readings.state or {}).get(MATRIX_PROFILE, "") == profile:
        return
    try:
        await matrixlane.switch_profile(manager, profile)
    except ControlError as exc:
        raise refuse(MatrixSwitchRefusedError(error=exc)) from exc


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
    where the engine has them. A body naming ``values`` stores each over the engine's own, a given mode setting the
    record's chain. A matrix profile is held as the engine names it, ``""`` for none. A body naming ``stations``
    writes the one record under each; none named writes it under the loaded station. 409 when the loaded chain is
    unknowable — the record would claim a chain it never captured. 422 when a named field is not a live snapshot
    setting, a given value is one the record cannot hold, or a named station is not one the preset store holds.
    """
    # Name first, engine second: a name the rule refuses is refused as one whatever
    # the engine is doing, rather than being answered by whatever the snapshot
    # refuses first.
    name = canonical_name(name)  # the response names the key the store holds
    record = _record(manager, _selected(None if body is None else body.fields), None if body is None else body.values)
    stations = body.stations if body is not None and body.stations is not None else [_loaded(manager)]
    try:
        _store(request).save(name, record, stations)
    except LivePresetSchemaError as exc:
        raise _unreadable(exc) from exc
    return NamedLiveRecord.of(name, record)


@router.post("/livepresets/{name:path}/apply", response_model_exclude_none=True)
async def apply_live_preset(
    name: str, request: Request, manager: Mgr, station: str | None = None
) -> WithAutosave[LiveApplyReport]:
    """Apply a preset saved under ``station``, the loaded one when absent, readback-verified.

    Its output mode goes first and the rest follows against the enumerations that switch produced (``apply_preset``),
    so a preset taken on the other chain applies by switching to it. Its matrix profile is checked against the engine's
    list before anything applies and switched to last, only when the engine is on another.

    The live lane's all-or-nothing 409 carries over unchanged: a stored ID the
    running enumerations no longer offer refuses the whole preset, naming the
    field.
    """
    try:
        record = _store(request).read(_loaded(manager) if station is None else station, name)
    except LivePresetSchemaError as exc:
        raise _unreadable(exc) from exc
    fields = dict(record.fields)
    # A preset record may carry a "rate" field. No snapshot holds a pinned rate
    # (`lanes/live/rate`), so it is dropped and the rest applies.
    fields.pop("rate", None)
    profile = fields.pop(MATRIX_PROFILE, None)
    _check_profile(manager, profile)
    try:
        report = await lane.apply_preset(manager, fields) if fields else LiveApplyReport()
    except routing.LiveRouteError as exc:
        raise refuse(exc, exc.reasons) from exc
    except ControlError as exc:
        raise refuse(LivePresetApplyFailedError(error=exc)) from exc
    await _switch_profile(manager, profile)
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
    return LivePresetDeleted(name)
