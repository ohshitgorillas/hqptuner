"""The engine's current live settings, as a saveable record.

A live preset (``livepresets.py``) is a snapshot of what the engine is playing
right now, taken in the same domain ``livemap.resolve_live`` accepts back — so
applying a preset is the same batch the LIVE view would have sent. The display
name rides along because the enumerations are engine-built and can shift under a
preset; the value is what applies, the name is only what the card shows.

Split out of ``livemap`` on size alone: the routing there is about turning form
fields into setter args, and this is about reading the result back out.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .livemap import _LIVE_ONLY, DIRECT, ROUTABLE, EnumItems, LiveField, active_chain

if TYPE_CHECKING:
    from ..manager import ConnectionManager

# Which enumeration-item attribute carries the value the LIVE lane takes back.
# Filters and shapers translate ID<->index, so their stored value is the enum ID;
# `junk_filter` is index-domain on both sides, and `rate` is an actual rate in Hz.
_SNAPSHOT_VALUE = {"junk_filter": "index", "rate": "rate"}

# Mode is deliberately absent: `_mode_blocks_batch` refuses a mode change beside
# any other live field, so a preset carrying one could never apply as a batch.
# The chain tag the preset stores covers the same intent.
_SNAPSHOT_FIELDS = tuple(field for field in (*ROUTABLE, *_LIVE_ONLY) if field != "mode")


def _named(items: EnumItems, index: str, value_key: str) -> dict[str, str] | None:
    """The item at this list index as ``{value, name}``, or None when absent.

    ``RatesItem`` carries no ``name`` (protocol.md §6, ``<RatesItem index rate/>``),
    so the value doubles as its own label there."""
    for item in items:
        if str(item.get("index")) != str(index):
            continue
        value = item.get(value_key)
        return None if value is None else {"value": str(value), "name": str(item.get("name") or value)}
    return None


def _spec(field: str) -> LiveField:
    """A snapshot field's routing spec, from whichever of the two tables carries it."""
    return ROUTABLE.get(field) or _LIVE_ONLY[field]


def _snapshot_field(mgr: ConnectionManager, field: str, chain: str | None) -> dict[str, str] | None:
    """One field's current value+name, or None when it is off-chain or unreadable."""
    spec = _spec(field)
    if spec.chain is not None and spec.chain != chain:
        return None
    index = (mgr.state or {}).get(spec.state)
    if index is None:
        return None
    return _named((mgr.enums or {}).get(spec.enum) or [], index, _SNAPSHOT_VALUE.get(field, "value"))


def _direct_snapshot(mgr: ConnectionManager) -> dict[str, dict[str, str]]:
    """The DIRECT flags: 0/1 with no enumeration behind them, so each is its own label."""
    state = mgr.state or {}
    snapshot = {}
    for field, attr in DIRECT.items():
        value = state.get(attr)
        if value is not None:
            snapshot[field] = {"value": str(value), "name": str(value)}
    return snapshot


def live_snapshot(mgr: ConnectionManager) -> dict[str, dict[str, str]] | None:
    """Every live setting the engine can currently report, as ``{value, name}``.

    None when ``active_chain`` cannot say which chain is loaded: the chain fields
    would be missing and the record would claim a chain it never captured, so the
    snapshot is refused rather than half-taken.
    """
    chain = active_chain(mgr)
    if chain is None:
        return None
    chained = {f: item for f in _SNAPSHOT_FIELDS if (item := _snapshot_field(mgr, f, chain)) is not None}
    return {**chained, **_direct_snapshot(mgr)}
