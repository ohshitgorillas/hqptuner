"""The track context is read off the manager's 4321 readings: what the daemon last reported.

Each fixture is one consistent daemon snapshot: ``State`` carries settings as list indices,
``Status`` carries the running filter and rate, and the enumerations map index to name
(``docs/spec/protocol.md``, State and Status). Values come from that document and the fakes.
"""

from __future__ import annotations

import pytest
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.trackcontext import TrackContext, context_from

STOPPED = "0"
PAUSED = "1"
PLAYING_STATE = "2"
STOP_REQUESTED = "3"

GAUSS_LONG = "poly-sinc-gauss-long"
SINC_LH = "sinc-Lh"
FILTERS = [
    {"index": "0", "name": "none", "value": "0"},
    {"index": "1", "name": GAUSS_LONG, "value": "40"},
    {"index": "2", "name": SINC_LH, "value": "72"},
]
JUNK_20K = "20k"
JUNK_30K = "30k"
JUNK_FILTERS = [
    {"index": "0", "name": "none"},
    {"index": "1", "name": JUNK_20K},
    {"index": "2", "name": JUNK_30K},
]
RATE_705K = 705600
RATE_352K = 352800
RATES = [
    {"index": "0", "rate": "0"},
    {"index": "1", "rate": str(RATE_352K)},
    {"index": "2", "rate": str(RATE_705K)},
]


def _context(
    *,
    state: str = PLAYING_STATE,
    filter_index: str = "1",
    junk_index: str = "1",
    rate: int = RATE_705K,
) -> TrackContext | None:
    """Fill a bare manager's readings with one consistent snapshot and read its context."""
    filter_name = FILTERS[int(filter_index)]["name"]
    mgr = ConnectionManager(Config(), clock=VirtualClock())
    mgr.readings.enums = {"filters": FILTERS, "junk_filters": JUNK_FILTERS, "rates": RATES}
    mgr.readings.state = {
        "state": state,
        "mode": "1",
        "filter": filter_index,
        "filter1x": filter_index,
        "filterNx": filter_index,
        "shaper": "0",
        "rate": "0",
        "active_rate": str(rate),
        "filter_junk": junk_index,
    }
    mgr.readings.status = {
        "state": state,
        "active_mode": "PCM",
        "active_filter": filter_name,
        "active_shaper": "none",
        "active_rate": str(rate),
        "filter_junk": junk_index,
    }
    return context_from(mgr)


@pytest.mark.parametrize(("index", "name"), [("1", GAUSS_LONG), ("2", SINC_LH)])
def test_filter_is_the_name_of_the_running_filter(index: str, name: str) -> None:
    context = _context(filter_index=index)
    assert context is not None
    assert context.filter == name


@pytest.mark.parametrize(("index", "name"), [("1", JUNK_20K), ("2", JUNK_30K)])
def test_junk_filter_is_the_name_of_the_engaged_junk_filter(index: str, name: str) -> None:
    context = _context(junk_index=index)
    assert context is not None
    assert context.junk_filter == name


@pytest.mark.parametrize("rate", [RATE_705K, RATE_352K])
def test_samplerate_is_the_output_rate_in_hz_as_an_int(rate: int) -> None:
    context = _context(rate=rate)
    assert context is not None
    assert context.samplerate == rate


def test_state_two_reads_as_playing() -> None:
    context = _context(state=PLAYING_STATE)
    assert context is not None
    assert context.playing is True


@pytest.mark.parametrize("state", [STOPPED, PAUSED, STOP_REQUESTED])
def test_stopped_paused_and_stop_requested_read_as_not_playing(state: str) -> None:
    context = _context(state=state)
    assert context is not None
    assert context.playing is False
