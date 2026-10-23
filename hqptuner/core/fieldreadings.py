"""Typed settings readings composed from the separate source stores."""

from typing import Literal, TypedDict

from hqptuner.core.fieldvalues import Bounds, FileReading, bounds_of, current_engine_view, diverges, file_reading
from hqptuner.core.pending import PendingSnapshot, clean_pending, pending_fields
from hqptuner.core.readings import Readings, Source
from hqptuner.engine.view import EngineView
from hqptuner.fields import query
from hqptuner.fields.model import Field


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


class ConfigReading(TypedDict):
    """Registered settings at one lifecycle generation."""

    generation: int
    fields: dict[str, FieldReading]


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


def config_reading(readings: Readings, pending: PendingSnapshot, generation: int) -> ConfigReading:
    """Compose the registered settings from their independent stores."""
    view = current_engine_view(readings)
    staged = pending_fields(clean_pending(pending, readings), view)
    fields = {}
    for row in query.readable():
        field = _field(readings, view, row, staged.get(row.name))
        if field is not None:
            fields[row.name] = field
    return ConfigReading(generation=generation, fields=fields)
