"""LIVE's record of the live writes a restart can drop, and what lets an entry go before one.

A setting goes on the record when HQPTuner's write changed it and the engine confirmed it
by readback. A value the engine already held was not changed, so it is not recorded, and
an output-mode write takes the pinned rate off, since the engine clears the pin on every
one. A heartbeat that finds another client moved a recorded setting lets that entry go,
unreported; one whose State read was refused lets nothing go, an entry confirmed after the
heartbeat's State read is newer than that read and stays, and a setting of the chain the
engine no longer has loaded was not moved by anyone.

The engine is the table in ``live_record``: the config file's State on the PCM chain.
"""

from typing import NamedTuple

import pytest
from live_record import (
    ADAPTIVE_ON,
    DITHER_NS9,
    FILTER_SINC_M,
    JUNK_20K,
    MODE_SDM,
    RATE_705600,
    Write,
    confirmed,
    engine,
    remembering,
)

from hqptuner.lanes.live import dropped
from hqptuner.lanes.live.chain import SDM

# --- what goes on the record --------------------------------------------------

#: A write of the output mode the engine already runs: State mode index 1, PCM.
SAME_MODE = Write("mode", {"value": "1"}, {"mode": "1"}, dropped.WrittenSetting("mode", "pcm", "PCM"))

#: The 1x filter another client left on list index 1, enum ID 38, which an Nx filter
#: write carries along unchanged as the other half of its ``SetFilter`` pair.
HELD_1X = {"filter1x": "1"}
FILTER_CARRYING_1X = Write("filter", {"value": "2", "value1x": "1"}, {"filterNx": "2"}, FILTER_SINC_M.entry)


class AlreadyHeld(NamedTuple):
    """A write whose arguments carry a value the engine held, the engine it was sent to,
    and what the record holds once the engine confirmed it."""

    write: Write
    before: dropped.EngineView
    recorded: dict[str, dropped.WrittenSetting]


ALREADY_HELD = {
    "the mode the engine runs": AlreadyHeld(SAME_MODE, engine(), {ADAPTIVE_ON.entry.field: ADAPTIVE_ON.entry}),
    "a 1x filter carried along": AlreadyHeld(
        FILTER_CARRYING_1X,
        engine(moved=HELD_1X),
        {ADAPTIVE_ON.entry.field: ADAPTIVE_ON.entry, FILTER_SINC_M.entry.field: FILTER_SINC_M.entry},
    ),
}


@pytest.mark.parametrize("held", ALREADY_HELD.values(), ids=ALREADY_HELD.keys())
def test_a_value_written_that_the_engine_already_held_is_not_recorded(held: AlreadyHeld) -> None:
    live = remembering(ADAPTIVE_ON)
    confirmed(live, held.write, before=held.before)
    assert live.written == held.recorded


#: Output-mode writes, and what stays recorded of a pinned rate and adaptive volume after each.
MODE_WRITES = {
    "the same mode": (SAME_MODE, {ADAPTIVE_ON.entry.field: ADAPTIVE_ON.entry}),
    "another mode": (
        MODE_SDM,
        {ADAPTIVE_ON.entry.field: ADAPTIVE_ON.entry, MODE_SDM.entry.field: MODE_SDM.entry},
    ),
}


@pytest.mark.parametrize(("mode", "recorded"), MODE_WRITES.values(), ids=MODE_WRITES.keys())
def test_a_confirmed_output_mode_write_takes_the_pinned_rate_off_the_record(
    mode: Write, recorded: dict[str, dropped.WrittenSetting]
) -> None:
    live = remembering(RATE_705600, ADAPTIVE_ON)
    confirmed(live, mode, before=engine(RATE_705600, ADAPTIVE_ON))
    assert live.written == recorded


def test_a_write_whose_readback_did_not_verify_is_not_recorded() -> None:
    live = remembering(ADAPTIVE_ON)
    confirmed(live, JUNK_20K, verified=False)
    assert live.written == {ADAPTIVE_ON.entry.field: ADAPTIVE_ON.entry}


# --- another client's change --------------------------------------------------


class Move(NamedTuple):
    """A recorded write, and the State another client then moves the engine to, off it."""

    write: Write
    moved: dict[str, str]


#: Each other client's value is a list index off the written one: mode index 0
#: "[source]", PCM filter index 3 enum ID 40, PCM shaper index 0, junk filter index 2
#: "30k", and rate index 0, auto, which is what another client's mode switch leaves a pin on.
MOVES = {
    "mode": Move(MODE_SDM, {"mode": "0"}),
    "filter": Move(FILTER_SINC_M, {"filterNx": "3"}),
    "dither": Move(DITHER_NS9, {"shaper": "0"}),
    "junk_filter": Move(JUNK_20K, {"filter_junk": "2"}),
    "rate": Move(RATE_705600, {"rate": "0"}),
}

#: A recorded write no other client touches.
KEPT = ADAPTIVE_ON


@pytest.mark.parametrize("move", MOVES.values(), ids=MOVES.keys())
def test_a_recorded_write_another_client_moved_is_let_go(move: Move) -> None:
    record = remembering(KEPT, move.write).written
    view = engine(KEPT, move.write, moved=move.moved)
    assert dropped.taken_over(record, record, view, answered=True) == {KEPT.entry.field: KEPT.entry}


def test_a_heartbeat_whose_state_read_was_refused_lets_nothing_go() -> None:
    move = MOVES["junk_filter"]
    record = remembering(KEPT, move.write).written
    view = engine(KEPT, move.write, moved=move.moved)
    assert dropped.taken_over(record, record, view, answered=False) == record


def test_a_write_confirmed_after_the_heartbeats_state_read_stays_recorded() -> None:
    live = remembering(KEPT)
    read = dict(live.written)
    confirmed(live, JUNK_20K, before=engine(KEPT))
    view = engine(KEPT, moved=MODE_SDM.state)
    assert dropped.taken_over(live.written, read, view, answered=True) == live.written


#: PCM-chain writes, which the engine leaves dormant once it loads the SDM chain.
PCM_CHAIN_WRITES = {"filter": FILTER_SINC_M, "dither": DITHER_NS9}


@pytest.mark.parametrize("write", PCM_CHAIN_WRITES.values(), ids=PCM_CHAIN_WRITES.keys())
def test_a_write_of_the_chain_the_engine_no_longer_has_loaded_is_not_let_go(write: Write) -> None:
    record = remembering(write).written
    view = engine(chain=SDM)
    assert dropped.taken_over(record, record, view, answered=True) == record
