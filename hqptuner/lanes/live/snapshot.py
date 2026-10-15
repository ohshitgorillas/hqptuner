"""The engine's current live settings, as a saveable record.

A live snapshot (``presets/store/live.py``) is a snapshot of what the engine is playing
right now, taken in the same domain ``routing.resolve_live`` accepts back — so
applying a preset is the same batch the live controls would have sent. The display
name rides along because the enumerations are engine-built and can shift under a
preset; the value is what applies, the name is only what the card shows.

A snapshot holds the routable settings, the DIRECT flags and the matrix profile. The junk filter
follows the material, so no saved snapshot holds it.

``routing`` turns form fields into setter args; this module reads the result
back out.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, NamedTuple

from hqptuner.errors import HQPTunerError
from hqptuner.lanes.live import rate
from hqptuner.lanes.live.chain import EnumItems, active_chain
from hqptuner.lanes.live.routing import DIRECT, LIVE_ONLY, ROUTABLE, LiveField, mode_form_value
from hqptuner.lanes.writer import SETTINGS, LiveSetting

if TYPE_CHECKING:
    from hqptuner.lanes import LaneManager

MATRIX_PROFILE = "matrix_profile"
DEFAULT_PROFILE_NAME = "[Default]"

_UNKNOWN_CHAIN = {"chain": "the engine's active chain is unknown, so there is no live state to snapshot"}


class ChainUnknownError(HQPTunerError):
    """The engine's active chain cannot be determined, so there is no live state to snapshot.

    ``reasons`` is the per-field detail the API answers with, keyed by the one field it could not fill.
    """

    code = "chain_unknown"

    def __init__(self) -> None:
        """Carry the fixed per-field reasons dict; this template carries no interpolated fact."""
        super().__init__(_UNKNOWN_CHAIN["chain"])
        self.reasons = dict(_UNKNOWN_CHAIN)


# Which enumeration-item attribute carries the value the LIVE lane takes back.
# Filters and shapers translate ID<->index, so their stored value is the enum ID;
# `junk_filter` is index-domain on both sides.
_STATE_VALUE = {"junk_filter": "index"}

# Mode included. A single batch cannot carry it — `_mode_blocks_batch` refuses a
# mode change beside anything else, because `SetMode` swaps the enumerations the
# rest was resolved against — but a preset is not obliged to be one batch:
# `lane.apply_preset` writes the mode, re-enumerates, then applies the rest
# against the lists the switch produced. Leaving mode out made a preset unable to
# say "run SDM like this", which is most of what a preset is for.
#: Every setting a saved snapshot can hold: the routable settings, the DIRECT flags and the matrix profile.
SNAPSHOT_FIELDS = (*ROUTABLE, *DIRECT, MATRIX_PROFILE)

# The enumerated settings ``live_state`` reads: the routable ones and the junk filter.
_STATE_FIELDS = (*ROUTABLE, *LIVE_ONLY)


class Reading(NamedTuple):
    """One live setting as State reports it: the config-form value, and the engine's own name for it if it has one."""

    value: str
    name: str | None


def _named(items: EnumItems, index: str | None, value_key: str) -> Reading | None:
    """Return the item at this list index as a reading, or None when absent.

    ``RatesItem`` carries no ``name`` (``<RatesItem index rate/>``), so a rate's reading has none.
    """
    for item in items:
        if str(item.get("index")) != str(index):
            continue
        value = item.get(value_key)
        return None if value is None else Reading(str(value), item.get("name"))
    return None


def reported_as(setting: str) -> str:
    """Return the State attribute a uniform setter's value comes back in (``writer.SETTINGS``).

    ``TypeError`` for a setter with a handler of its own, which has no single attribute to name.
    """
    spec = SETTINGS[setting]
    if not isinstance(spec, LiveSetting):
        raise TypeError(setting)
    return spec.state


_RATE_STATE = reported_as(rate.SETTING)


def _spec(field: str) -> LiveField:
    """Return a state field's routing spec, from whichever of the two tables carries it."""
    return ROUTABLE.get(field) or LIVE_ONLY[field]


def _mode_reading(items: EnumItems, index: str) -> Reading | None:
    """Return the running output mode as a reading.

    Mode is the one field whose stored value is not an enum ID: the live lane
    takes the config-form strings auto/pcm/sdm and matches them to the running
    enumeration by NAME, because the modes list is device-dependent and its
    positions are not stable (``routing.MODE_NAMES``).
    """
    form = mode_form_value(items, index)
    if form is None:
        return None
    return Reading(form, next((item.get("name") for item in items if str(item.get("index")) == str(index)), None))


def read_field(field: str, state: dict[str, str], enums: dict[str, EnumItems], chain: str | None) -> Reading | None:
    """Return one live field's reading from ``state``, or None when it is off-chain or unreadable.

    ``chain`` is the filter/shaper chain loaded. The DIRECT flags are 0/1 with no enumeration
    behind them, and the pinned rate's list names none of its items, so neither reading has a name.
    """
    if field in DIRECT:
        flag = state.get(DIRECT[field])
        return None if flag is None else Reading(str(flag), None)
    if field == rate.RATE:
        return _named(enums.get("rates") or [], state.get(_RATE_STATE), "rate")
    spec = _spec(field)
    index = state.get(spec.state)
    if index is None or spec.chain not in {None, chain}:
        return None
    if field == "mode":
        return _mode_reading(enums.get("modes") or [], index)
    return _named(enums.get(spec.enum) or [], index, _STATE_VALUE.get(field, "value"))


def _shown(reading: Reading) -> dict[str, str]:
    """Return a reading as the ``{value, name}`` a snapshot holds, the value labeling itself where it has no name."""
    return {"value": reading.value, "name": reading.name or reading.value}


@dataclass(frozen=True)
class LiveSnapshot:
    """The chain the engine has loaded, and every live setting it can report on it, as ``{value, name}``."""

    chain: str
    fields: dict[str, dict[str, str]]


def live_state(mgr: LaneManager) -> LiveSnapshot:
    """Read every live setting the engine reports, junk filter included, and the chain they were read on, in one pass.

    ``ChainUnknownError`` when ``active_chain`` cannot say which chain is loaded:
    the chain fields would be missing and the record would claim a chain it never
    captured, so the read is refused rather than half-taken.
    """
    chain = active_chain(mgr)
    if chain is None:
        raise ChainUnknownError
    state, enums = mgr.readings.state or {}, mgr.readings.enums or {}
    readings = ((f, read_field(f, state, enums, chain)) for f in (*_STATE_FIELDS, *DIRECT))
    return LiveSnapshot(chain, {f: _shown(reading) for f, reading in readings if reading is not None})


def live_snapshot(mgr: LaneManager) -> LiveSnapshot:
    """Read the settings a saved snapshot holds (``SNAPSHOT_FIELDS``) and the chain they were read on.

    ``ChainUnknownError`` as ``live_state`` raises it.
    """
    state = live_state(mgr)
    fields = {f: item for f, item in state.fields.items() if f in SNAPSHOT_FIELDS}
    profile = (mgr.readings.state or {}).get(MATRIX_PROFILE)
    if profile is not None:
        fields[MATRIX_PROFILE] = {"value": profile, "name": DEFAULT_PROFILE_NAME if profile == "" else profile}
    return LiveSnapshot(state.chain, fields)
