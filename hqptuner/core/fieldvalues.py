"""Numeric limits selected from current daemon evidence."""

import math
from typing import TypedDict

from hqptuner.conf.httpforms import FormField
from hqptuner.core.readings import Readings, Source
from hqptuner.fields.model import BoundsSelector, Decimal, Field


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
