"""Typed settings readings composed from the separate source stores."""

from dataclasses import dataclass
from typing import Literal, TypedDict, overload

from hqptuner.core.fieldvalues import Bounds, FileReading, bounds_of, current_engine_view, diverges, file_reading
from hqptuner.core.pending import PendingSnapshot, clean_pending, pending_fields
from hqptuner.core.readings import Readings, Source
from hqptuner.engine.devicecaps import DeviceCaps
from hqptuner.engine.view import EngineView
from hqptuner.fields import query
from hqptuner.fields.model import Field, MetadataSelector
from hqptuner.presets.presetlane import PresetListing, PresetOption


class EngineReading(TypedDict):
    """A State-domain value with its acquisition generation."""

    value: str
    name: str
    generation: int


class FieldReading(TypedDict):
    """The independent readings and registered policy of one field."""

    engine: EngineReading | None
    file: FileReading | None
    staged: str | None
    lane: Literal["live", "restore", "form", "matrix", "volume"]
    show: Literal["engine", "file"]
    restarts: bool
    diverges: bool
    bounds: Bounds | None


type MetadataValue = str | dict[str, str | list[PresetOption]] | DeviceCaps | None


@dataclass(frozen=True)
class MetadataSources:
    """The source objects available to registered metadata selectors."""

    readings: Readings
    presets: PresetListing
    app_version: str


class MetadataReading(TypedDict):
    """A registered read-only metadata payload."""

    value: MetadataValue
    readonly: Literal[True]


class Reading[T](TypedDict):
    """Registered settings at one lifecycle generation."""

    generation: int
    fields: dict[str, T]


type ConfigReading = Reading[FieldReading | MetadataReading]


def _engine(readings: Readings, view: EngineView, row: Field) -> EngineReading | None:
    value = view.raw_read(row.name)
    stamp = readings.source_stamp(Source.ENGINE, "state")
    if value is None or stamp is None:
        return None
    return EngineReading(value=value.value, name=value.name, generation=stamp.generation)


def _field(readings: Readings, view: EngineView, row: Field, staged: str | None) -> FieldReading | None:
    descriptor = row.read
    bounds = bounds_of(readings, row)
    if descriptor is None or (descriptor.bounds is not None and bounds is None):
        return None
    file = file_reading(readings, row)
    comparable = view.read(row.name)
    return FieldReading(
        engine=_engine(readings, view, row),
        file=file,
        staged=staged,
        lane=descriptor.lane,
        show=descriptor.show,
        restarts=descriptor.restarts,
        diverges=diverges(
            row, None if comparable is None else comparable.value, None if file is None else file["value"]
        ),
        bounds=bounds,
    )


def _metadata(sources: MetadataSources, selector: MetadataSelector) -> MetadataReading:
    value = getattr(sources, selector.source)
    if selector.attribute is not None:
        value = getattr(value, selector.attribute, None)
    if selector.members:
        value = {member: getattr(value, member, None) for member in selector.members}
    return MetadataReading(value=value, readonly=selector.readonly)


@overload
def config_reading(
    readings: Readings, pending: PendingSnapshot, generation: int, metadata: None = None
) -> Reading[FieldReading]: ...


@overload
def config_reading(
    readings: Readings, pending: PendingSnapshot, generation: int, metadata: MetadataSources
) -> ConfigReading: ...


def config_reading(
    readings: Readings,
    pending: PendingSnapshot,
    generation: int,
    metadata: MetadataSources | None = None,
) -> Reading[FieldReading] | ConfigReading:
    """Compose the registered settings from their independent stores."""
    view = current_engine_view(readings)
    staged = pending_fields(clean_pending(pending, readings), view)
    fields: dict[str, FieldReading] = {}
    for row in query.readable():
        field = _field(readings, view, row, staged.get(row.name))
        if field is not None:
            fields[row.name] = field
    if metadata is None:
        return Reading(generation=generation, fields=fields)
    combined: dict[str, FieldReading | MetadataReading] = dict(fields)
    for row in query.metadata():
        if row.metadata is not None:
            combined[row.name] = _metadata(metadata, row.metadata)
    return Reading(generation=generation, fields=combined)
