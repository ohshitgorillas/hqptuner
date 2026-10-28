"""The track context names a junk filter only where State's index and the enumeration agree on one.

Each case reads two otherwise identical daemon snapshots off a bare manager: one where the
junk filter is named, and one where State's junk index is missing or points past the
enumeration. Values come from the wire protocol's State shape and the fakes.
"""

from __future__ import annotations

from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.trackcontext import context_from

JUNK_20K = "20k"
JUNK_FILTERS = [
    {"index": "0", "name": "none"},
    {"index": "1", "name": JUNK_20K},
    {"index": "2", "name": "30k"},
]
#: State's junk index for `JUNK_20K`.
LISTED = "1"
#: An index the three-item enumeration does not carry.
UNLISTED = "7"
STATE = {"state": "2", "mode": "1", "filter1x": "1", "filterNx": "1", "shaper": "0", "rate": "0"}
STATUS = {"state": "2", "active_mode": "PCM", "active_filter": "poly-sinc-gauss-long"}
#: The generation the Engine reading is taken in.
GENERATION = 1


def _junk_filter(junk_index: str | None) -> str | None:
    """Read the context's junk filter off a bare manager whose State carries ``junk_index`` (none when None)."""
    mgr = ConnectionManager(Config(), clock=VirtualClock())
    state = STATE if junk_index is None else {**STATE, "filter_junk": junk_index}
    mgr.readings.take_engine(GENERATION, state=state, status=STATUS, enums={"junk_filters": JUNK_FILTERS})
    context = context_from(mgr)
    return None if context is None else context.junk_filter


def test_junk_filter_is_unnamed_when_state_reports_no_junk_index() -> None:
    assert [_junk_filter(None), _junk_filter(LISTED)] == [None, JUNK_20K]


def test_junk_filter_is_unnamed_at_an_index_the_enumeration_does_not_list() -> None:
    assert [_junk_filter(UNLISTED), _junk_filter(LISTED)] == [None, JUNK_20K]
