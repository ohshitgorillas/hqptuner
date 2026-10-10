"""The engine's current live settings, as a saveable record.

A live snapshot (``presets/store/live.py``) is a snapshot of what the engine is playing
right now, taken in the same domain ``routing.resolve_live`` accepts back — so
applying a preset is the same batch the LIVE view would have sent. The display
name rides along because the enumerations are engine-built and can shift under a
preset; the value is what applies, the name is only what the card shows.

A snapshot holds the routable settings, the DIRECT flags and the matrix profile. The junk filter is
read only by ``live_state``, the post-rescan replay's reader: it follows the
material, so no saved snapshot holds it.

``routing`` turns form fields into setter args; this module reads the result
back out.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from hqptuner.errors import HQPTunerError
from hqptuner.lanes.live.chain import EnumItems, active_chain
from hqptuner.lanes.live.routing import DIRECT, LIVE_ONLY, ROUTABLE, LiveField, mode_form_value

if TYPE_CHECKING:
    from hqptuner.core.manager import ConnectionManager

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


def _named(items: EnumItems, index: str, value_key: str) -> dict[str, str] | None:
    """Return the item at this list index as ``{value, name}``, or None when absent.

    ``RatesItem`` carries no ``name`` (``<RatesItem index rate/>``),
    so the value doubles as its own label there.
    """
    for item in items:
        if str(item.get("index")) != str(index):
            continue
        value = item.get(value_key)
        return None if value is None else {"value": str(value), "name": str(item.get("name") or value)}
    return None


def _spec(field: str) -> LiveField:
    """Return a state field's routing spec, from whichever of the two tables carries it."""
    return ROUTABLE.get(field) or LIVE_ONLY[field]


def _mode_snapshot(mgr: ConnectionManager, index: str) -> dict[str, str] | None:
    """Return the running output mode as ``{value, name}``.

    Mode is the one field whose stored value is not an enum ID: the live lane
    takes the config-form strings auto/pcm/sdm and matches them to the running
    enumeration by NAME, because the modes list is device-dependent and its
    positions are not stable (``routing.MODE_NAMES``).
    """
    items = (mgr.readings.enums or {}).get("modes") or []
    form = mode_form_value(items, index)
    if form is None:
        return None
    name = next((str(item.get("name")) for item in items if str(item.get("index")) == str(index)), form)
    return {"value": form, "name": name}


def _snapshot_field(mgr: ConnectionManager, field: str, chain: str | None) -> dict[str, str] | None:
    """One field's current value+name, or None when it is off-chain or unreadable."""
    spec = _spec(field)
    if spec.chain is not None and spec.chain != chain:
        return None
    index = (mgr.readings.state or {}).get(spec.state)
    if index is None:
        return None
    if field == "mode":
        return _mode_snapshot(mgr, index)
    return _named((mgr.readings.enums or {}).get(spec.enum) or [], index, _STATE_VALUE.get(field, "value"))


def _direct_snapshot(mgr: ConnectionManager) -> dict[str, dict[str, str]]:
    """Return the DIRECT flags: 0/1 with no enumeration behind them, so each is its own label."""
    state = mgr.readings.state or {}
    snapshot = {}
    for field, attr in DIRECT.items():
        value = state.get(attr)
        if value is not None:
            snapshot[field] = {"value": str(value), "name": str(value)}
    return snapshot


@dataclass(frozen=True)
class LiveSnapshot:
    """The chain the engine has loaded, and every live setting it can report on it, as ``{value, name}``."""

    chain: str
    fields: dict[str, dict[str, str]]


def live_state(mgr: ConnectionManager) -> LiveSnapshot:
    """Read every live setting the engine reports, junk filter included, and the chain they were read on, in one pass.

    ``ChainUnknownError`` when ``active_chain`` cannot say which chain is loaded:
    the chain fields would be missing and the record would claim a chain it never
    captured, so the read is refused rather than half-taken.
    """
    chain = active_chain(mgr)
    if chain is None:
        raise ChainUnknownError
    chained = {f: item for f in _STATE_FIELDS if (item := _snapshot_field(mgr, f, chain)) is not None}
    return LiveSnapshot(chain, {**chained, **_direct_snapshot(mgr)})


def live_snapshot(mgr: ConnectionManager) -> LiveSnapshot:
    """Read the settings a saved snapshot holds (``SNAPSHOT_FIELDS``) and the chain they were read on.

    ``ChainUnknownError`` as ``live_state`` raises it.
    """
    state = live_state(mgr)
    fields = {f: item for f, item in state.fields.items() if f in SNAPSHOT_FIELDS}
    profile = (mgr.readings.state or {}).get(MATRIX_PROFILE)
    if profile is not None:
        fields[MATRIX_PROFILE] = {"value": profile, "name": DEFAULT_PROFILE_NAME if profile == "" else profile}
    return LiveSnapshot(state.chain, fields)
