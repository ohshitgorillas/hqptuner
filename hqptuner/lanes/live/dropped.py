"""What the Engine ran before an outcome and does not run after it.

hqplayerd keeps a setting changed over its control API in memory only, so a restart
or a chain switch ends what the Engine held. The report is a comparison of two stamped
Engine readings, the last verified one before the outcome and the first verified one
after it. It holds no record of its own and replays nothing into the Engine.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from hqptuner.engine.chainfamily import chain_name, status_chain
from hqptuner.lanes.live.routing import live_fields
from hqptuner.lanes.live.snapshot import read_field

if TYPE_CHECKING:
    from hqptuner.lanes.live.snapshot import Reading


class EngineReading(Protocol):
    """One stamped Engine reading, as ``core.readings.EngineSnapshot`` carries it."""

    @property
    def state(self) -> dict[str, str] | None:  # engine, list index
        """The ``State`` frame, None when not read yet."""

    @property
    def status(self) -> dict[str, str] | None:  # engine, text
        """The ``Status`` frame, None when not read yet."""

    @property
    def enums(self) -> dict[str, list[dict[str, str]]] | None:  # engine, list index to name and enum ID
        """The enumerations, None when not read yet."""


@dataclass(frozen=True)
class Dropped:
    """A field the Engine ran before an outcome and does not run after it, and the value it held.

    ``field`` is the config-form name, ``value`` the config-form value the Engine ran (an enum ID
    for a filter or shaper), ``name`` the enumeration's name for it, None where none names it.
    """

    field: str
    value: str
    name: str | None


def _loaded_chain(state: dict[str, str], reading: EngineReading) -> str | None:
    """Return the chain this reading has loaded: its configured mode's, else the one Status reports running."""
    index = state.get("mode")
    modes = (reading.enums or {}).get("modes") or []
    mode = next((item for item in modes if index is not None and str(item.get("index")) == str(index)), None)
    configured = chain_name(mode.get("name") or "") if mode is not None else None
    return configured if configured is not None else status_chain(reading.status or {})


def _held(reading: EngineReading) -> dict[str, Reading]:
    """Return every live field this reading answers for, empty when it has no State."""
    state = reading.state
    if state is None:
        return {}
    enums = reading.enums or {}
    chain = _loaded_chain(state, reading)
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
