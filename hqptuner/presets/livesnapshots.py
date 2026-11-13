"""Live snapshots: recording what the engine plays into the stations' store, and applying a record back.

The store is the one the manager's preset collaborator holds, ``presetops.live_presets``, so a snapshot recorded here
is the one every other surface reads. A refusal is an ``HQPTunerError`` carrying its stable code, and the per-field
ones carry ``reasons`` beside it, for a caller to answer with.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from hqptuner.engine.controlerrors import ControlError
from hqptuner.engine.view import Cause, EngineView, Reading, Refusal, is_mode, says
from hqptuner.errors import HQPTunerError
from hqptuner.fields import query
from hqptuner.fields.chain import PCM, SDM
from hqptuner.fields.model import Enumeration
from hqptuner.lanes import matrixlane
from hqptuner.lanes.live import lane, routing, snapshot
from hqptuner.lanes.live.lane import LiveApplyReport
from hqptuner.lanes.live.snapshot import MATRIX_PROFILE
from hqptuner.presets.store.live import DEFAULT_STATION, LiveRecord, canonical_name

if TYPE_CHECKING:
    from hqptuner.lanes.live.snapshot import LiveSnapshot
    from hqptuner.presets import PresetManager


class NotLiveSnapshotSettingsError(HQPTunerError):
    """A save named fields that are not live snapshot settings at all; ``reasons`` keys the refusal by ``fields``."""

    code = "fields_unknown"

    def __init__(self, *, unknown: list[str]) -> None:
        """Name the ``unknown`` field names, in the order given."""
        message = f"not live snapshot settings: {', '.join(unknown)}"
        super().__init__(message)
        self.reasons = {"fields": message}


class ValuesUnknownError(HQPTunerError):
    """A save gave values its record cannot hold: a setting it does not keep, or a value its chain does not offer."""

    code = "values_unknown"

    def __init__(self, *, reasons: dict[str, str]) -> None:
        """Join the per-field reasons in field order, and keep the mapping on ``reasons``."""
        super().__init__("; ".join(f"{field}: {why}" for field, why in sorted(reasons.items())))
        self.reasons = dict(reasons)


class EngineStepFailedError(HQPTunerError):
    """A Control API error that stopped one step of an apply, under its own text, kept on ``error``."""

    def __init__(self, error: ControlError) -> None:
        """Carry ``error``'s own text unchanged."""
        super().__init__(str(error))
        self.error = error


class SnapshotApplyFailedError(EngineStepFailedError):
    """The live lane's apply of a snapshot's settings failed on the Control API."""


class ProfileSwitchFailedError(EngineStepFailedError):
    """The daemon refused the switch to a snapshot's matrix profile."""


def loaded(manager: PresetManager) -> str:
    """Return the loaded station: the active config preset, or the unnamed default when none is."""
    return manager.presetops.store.active or DEFAULT_STATION


def _selected(wanted: list[str] | None) -> set[str] | None:
    """Return the keys a save keeps, mode forced beside any chain-scoped one; None = everything.

    ``NotLiveSnapshotSettingsError`` naming every key that is not a snapshot field.
    """
    if wanted is None:
        return None
    known = set(query.snapshot_fields())
    unknown = [key for key in wanted if key not in known]
    if unknown:
        raise NotLiveSnapshotSettingsError(unknown=unknown)
    keys = set(wanted)
    if keys & query.chain_scoped():
        keys.update(field for field in known if is_mode(field))
    return keys


def _mode_name(view: EngineView, field: str, value: str) -> str | Refusal:
    """Return the display name of a given output mode, or the refusal when it is not pcm or sdm."""
    if value not in (PCM, SDM):
        return Refusal(field, value, Cause.NOT_MODE)
    index = view.index_of(field, value)
    name = None if index is None else view.name_at(Enumeration.MODES, index)
    return value.upper() if name is None else name


def _given_name(view: EngineView, field: str, value: str) -> str | Refusal:
    """Return the display name a given value is stored under, or its refusal."""
    if is_mode(field):
        return _mode_name(view, field, value)
    resolved = view.resolve(field, value)
    if isinstance(resolved, Refusal):
        return value if resolved.cause is Cause.OFF_CHAIN else resolved
    live = query.live(field)
    return value if live.enumeration is None else view.name_at(live.enumeration, resolved) or value


def _given(view: EngineView, keys: set[str] | None, values: dict[str, str]) -> dict[str, dict[str, str]]:
    """Return each given value as ``{value, name}``; ``ValuesUnknownError`` naming each value the record cannot hold."""
    allowed = set(query.snapshot_fields()) if keys is None else keys
    given: dict[str, dict[str, str]] = {}
    reasons: dict[str, str] = {}
    for field, value in values.items():
        if field not in allowed:
            reasons[field] = "not a setting this save keeps"
            continue
        name = _given_name(view, field, value)
        if isinstance(name, Refusal):
            reasons[field] = says(name)
        else:
            given[field] = snapshot.shown(field, Reading(value, name))
    if reasons:
        raise ValuesUnknownError(reasons=reasons)
    return given


def _kept(taken: LiveSnapshot, keys: set[str] | None, chain: str) -> dict[str, dict[str, str]]:
    """Return the snapshot's fields among ``keys`` (None = all), less the old chain's when ``chain`` is another."""
    return {
        field: item
        for field, item in taken.fields.items()
        if (keys is None or field in keys) and (chain == taken.chain or field not in query.chain_scoped())
    }


def _record(manager: PresetManager, keys: set[str] | None, values: dict[str, str] | None) -> LiveRecord:
    """Return the record a save stores: the engine's snapshot cut down to ``keys`` (None = all), ``values`` over it.

    A given mode sets the record's chain; on a change the snapshot's fields of the old chain leave the record.
    ``ChainUnknownError`` as the snapshot raises it.
    """
    taken = snapshot.live_snapshot(manager)
    given = _given(EngineView.of(manager.readings), keys, values or {})
    chain = next((item["value"] for field, item in given.items() if is_mode(field)), taken.chain)
    kept = _kept(taken, keys, chain) | given
    return LiveRecord(
        chain=chain,
        fields={field: item["value"] for field, item in kept.items()},
        names={field: item["name"] for field, item in kept.items()},
    )


async def record(
    manager: PresetManager,
    name: str,
    *,
    fields: list[str] | None = None,
    values: dict[str, str] | None = None,
    stations: list[str] | None = None,
) -> tuple[str, LiveRecord]:
    """Snapshot what the engine is playing under ``name`` and store it, answering the key it went under and the record.

    ``fields`` keeps only those settings (None = everything the engine reports); ``values`` stores each over the
    engine's own, a given mode setting the record's chain. ``stations`` of None writes to the loaded station alone.
    The name is judged first, whatever the engine is doing. The store's file is written off the event loop.
    """
    key = canonical_name(name)
    taken = _record(manager, _selected(fields), values)
    targets = [loaded(manager)] if stations is None else stations
    await asyncio.to_thread(manager.presetops.live_presets.save, key, taken, targets)
    return key, taken


def _check_profile(manager: PresetManager, profile: str | None) -> None:
    """``LiveRouteError`` when a preset's matrix profile is one the engine does not list, before anything applies."""
    if profile is None:
        return
    resolved = EngineView.of(manager.readings).resolve(MATRIX_PROFILE, profile)
    if isinstance(resolved, Refusal):
        raise routing.LiveRouteError({MATRIX_PROFILE: says(resolved)})


async def _switch_profile(manager: PresetManager, profile: str | None) -> None:
    """Switch the engine to a preset's matrix profile when it is on another; a daemon refusal is wrapped."""
    current = EngineView.of(manager.readings).read(MATRIX_PROFILE)
    if profile is None or ("" if current is None else current.value) == profile:
        return
    try:
        await matrixlane.switch_profile(manager, profile)
    except ControlError as exc:
        raise ProfileSwitchFailedError(exc) from exc


async def apply(manager: PresetManager, name: str, *, station: str | None = None) -> LiveApplyReport:
    """Apply the snapshot saved under ``station``, the loaded one when absent, readback-verified.

    Its output mode goes first and the rest follows against the enumerations that switch produced, so a snapshot
    taken on the other chain applies by switching to it. Its matrix profile is checked against the engine's list
    before anything applies and switched to last, only when the engine is on another. ``LiveRouteError`` for a
    profile or a stored ID the engine no longer offers, ``SnapshotApplyFailedError`` and ``ProfileSwitchFailedError``
    for a Control API failure in either step.
    """
    stored = manager.presetops.live_presets.read(loaded(manager) if station is None else station, name)
    fields = dict(stored.fields)
    # A preset record may carry a "rate" field. No snapshot holds a pinned rate
    # (`lanes/live/rate`), so it is dropped and the rest applies.
    fields.pop("rate", None)
    profile = fields.pop(MATRIX_PROFILE, None)
    _check_profile(manager, profile)
    try:
        report = await lane.apply_preset(manager, fields) if fields else LiveApplyReport()
    except ControlError as exc:
        raise SnapshotApplyFailedError(exc) from exc
    await _switch_profile(manager, profile)
    return report
