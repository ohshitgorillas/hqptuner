"""What the Engine ran before an outcome and does not run after it.

hqplayerd keeps a setting changed over its control API in memory only, so a restart
or a chain switch ends what the Engine held. The report is a comparison of two stamped
Engine readings, the last verified one before the outcome and the first verified one
after it. It holds no record of its own and replays nothing into the Engine.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from hqptuner.lanes.live.chain import EngineReading, loaded_chain
from hqptuner.lanes.live.routing import live_fields
from hqptuner.lanes.live.snapshot import read_field

if TYPE_CHECKING:
    from hqptuner.lanes.live.snapshot import Reading


@dataclass(frozen=True)
class Dropped:
    """A field the Engine ran before an outcome and does not run after it, and the value it held.

    ``field`` is the config-form name, ``value`` the config-form value the Engine ran (an enum ID
    for a filter or shaper), ``name`` the enumeration's name for it, None where none names it.
    """

    field: str
    value: str
    name: str | None


def _held(reading: EngineReading) -> dict[str, Reading]:
    """Return every live field this reading answers for, empty when it has no State."""
    state = reading.state
    if state is None:
        return {}
    enums = reading.enums or {}
    chain = loaded_chain(reading)
    found = ((field, read_field(field, state, enums, chain)) for field in live_fields())
    return {field: value for field, value in found if value is not None}


def report(before: EngineReading, after: EngineReading) -> tuple[Dropped, ...]:
    """Return what ``before`` ran that ``after`` does not.

    A field ``after`` does not answer for, such as one of a chain it has not loaded, is not reported.
    """
    now = _held(after)
    return tuple(
        Dropped(field, held.value, held.name)
        for field, held in _held(before).items()
        if field in now and now[field].value != held.value
    )
