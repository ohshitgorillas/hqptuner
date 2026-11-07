"""The live settings an Engine reading answers for, as config-form fields, for ``presets.realized``."""

from __future__ import annotations

from typing import TYPE_CHECKING

from hqptuner.engine.view import EngineView
from hqptuner.fields import query

if TYPE_CHECKING:
    from hqptuner.engine.view import EngineReading


def reading_overrides(reading: EngineReading) -> dict[str, str]:
    """Return the live settings this Engine reading answers for, as config-form fields.

    The engine answers for the loaded chain only: State reports one filter/shaper
    pair, and the two chains number their enum IDs differently. The chain not
    loaded has no Engine value, so nothing is reported for it.
    """
    view = EngineView.of(reading)
    found = ((row.name, view.read(row.name)) for row in query.realized())
    return {name: held.value for name, held in found if held is not None}
