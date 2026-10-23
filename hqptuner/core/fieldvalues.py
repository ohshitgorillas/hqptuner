"""Numeric limits selected from current daemon evidence."""

import math
from decimal import Decimal as DecimalValue
from typing import TypedDict

from hqptuner.conf.httpforms import FormField
from hqptuner.core.readings import Readings, Source
from hqptuner.engine.view import EngineView
from hqptuner.fields.model import BoundsSelector, Decimal, Field, FileSelector, Integer


class FileReading(TypedDict):
    """A File-domain value with its acquisition generation."""

    value: str
    generation: int


def _engine_current(readings: Readings, payload: str) -> bool:
    return readings.engine_stamp is not None and readings.source_stamp(Source.ENGINE, payload) == readings.engine_stamp


def current_engine_view(readings: Readings) -> EngineView:
    """Use only Engine inputs acquired in the current Engine generation."""
    return EngineView(
        state=readings.state if _engine_current(readings, "state") else None,
        status=readings.status if _engine_current(readings, "status") else None,
        enums=readings.enums if _engine_current(readings, "enums") else None,
        matrix_profiles=readings.matrix_profiles if _engine_current(readings, "matrix_profiles") else None,
    )


def diverges(row: Field, engine_value: str | None, file_value: str | None) -> bool:
    """Compare the two source values in their shared File domain."""
    if engine_value is None or file_value is None:
        return False
    if not row.domain.accepts(engine_value) or not row.domain.accepts(file_value):
        return False
    if isinstance(row.domain, (Integer, Decimal)):
        return DecimalValue(engine_value) != DecimalValue(file_value)
    return engine_value != file_value


def _file_value(readings: Readings, selector: FileSelector) -> str | None:
    sources = {"file_config": readings.file_config, "engine": readings.engine}
    if selector.source in sources:
        return (sources[selector.source] or {}).get(selector.key)
    forms = {"config_form": readings.config_form, "matrix_form": readings.matrix_form}
    form = forms.get(selector.source)
    if form is None:
        return None
    value = next((item.get("value") for item in form["fields"] if item.get("name") == selector.key), None)
    if isinstance(value, bool):
        return str(int(value))
    return None if value is None else str(value)


def file_value(readings: Readings, row: Field) -> str | None:
    """Select the field's File-domain value independently of acquisition stamps."""
    selector = row.read.file if row.read is not None else None
    return None if selector is None else _file_value(readings, selector)


def file_reading(readings: Readings, row: Field) -> FileReading | None:
    """Select the retained File value and its own acquisition stamp."""
    selector = row.read.file if row.read is not None else None
    if selector is None:
        return None
    stamp = readings.source_stamp(Source.FILE, selector.source)
    value = file_value(readings, row)
    if stamp is None or value is None:
        return None
    return FileReading(value=value, generation=stamp.generation)


class Bounds(TypedDict):
    """A complete numeric range reported by the daemon."""

    min: int | float
    max: int | float
    step: int | float


def _number(value: object) -> int | float | None:
    if isinstance(value, str) and Decimal().accepts(value):
        value = float(value)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(value) else None


def _bounds(evidence: FormField) -> Bounds | None:
    minimum = _number(evidence.get("min"))
    maximum = _number(evidence.get("max"))
    step = _number(evidence.get("step"))
    if minimum is None or maximum is None or step is None:
        return None
    return Bounds(min=minimum, max=maximum, step=step)


def _current(readings: Readings, source: Source, payload: str) -> bool:
    stamp = readings.source_stamp(source, payload)
    if stamp is None:
        return False
    engine = readings.engine_stamp
    if engine is not None and stamp.generation != engine.generation:
        return False
    return source is Source.ENGINE or readings.file_read_current(payload)


def _evidence(readings: Readings, selector: BoundsSelector) -> FormField:
    if selector.source == "volume_range":
        limits = readings.volume_range or {}
        return FormField(min=limits.get("min"), max=limits.get("max"), step=limits.get("step"))
    forms = {"config_form": readings.config_form, "matrix_form": readings.matrix_form}
    form = forms.get(selector.source or "")
    if form is None:
        return {}
    return next((item for item in form["fields"] if item.get("name") == selector.key), FormField())


def bounds_of(readings: Readings, row: Field) -> Bounds | None:
    """Read complete limits from the row's current, acquired bounds source."""
    selector = row.read.bounds if row.read is not None else None
    if selector is None or selector.source is None:
        return None
    source = Source.ENGINE if selector.source == "volume_range" else Source.FILE
    if not _current(readings, source, selector.source):
        return None
    return _bounds(_evidence(readings, selector))
