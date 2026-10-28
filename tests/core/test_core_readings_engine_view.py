"""The readings' view of the Engine, built on a plain ``Readings`` with no daemon.

Each Engine reading is handed in as the dicts the 4321 client returns for
``State``, ``Status``, the enumerations and ``VolumeRange``. The File reading
beside it disagrees with the Engine on the 1x filter, so a view that leaks the
File, or the Engine reading from before a break, reads differently from one
that does not.
"""

from typing import Literal

import pytest

from hqptuner.core.readings import EngineFields, Readings, Source, Stamp

#: Two generations a reading may be taken in, and the one after the first.
FIRST_GENERATION = 1
LATER_GENERATION = 4
NEXT_GENERATION = 2

#: A ``State`` frame on the PCM chain, and a second one on another 1x filter.
ENGINE_STATE = {
    "state": "2",
    "mode": "1",
    "filter1x": "3",
    "filterNx": "0",
    "shaper": "1",
    "rate": "0",
    "volume": "-10.0",
}
OTHER_ENGINE_STATE = {
    "state": "2",
    "mode": "1",
    "filter1x": "7",
    "filterNx": "2",
    "shaper": "0",
    "rate": "0",
    "volume": "-20.0",
}

#: A ``Status`` frame, and the one the reading after a break carries.
ENGINE_STATUS = {"state": "2", "active_mode": "PCM", "active_rate": "44100"}
NEXT_ENGINE_STATUS = {"state": "0", "active_mode": "PCM", "active_rate": "0"}

#: The filter enumeration and the ``VolumeRange`` frame.
ENGINE_ENUMS = {"filters": [{"index": "3", "name": "poly-sinc-gauss", "value": "40"}]}
ENGINE_VOLUME_RANGE = {"min": "-60", "max": "0", "enabled": "1", "adaptive": "0"}

#: The File's form fields, naming a different 1x filter from the Engine's.
FILE_CONFIG = {"mode": "1", "filter": "12", "shaper": "1"}


def engine_fields(state: dict[str, str]) -> EngineFields:
    """Every Engine field one full reading carries, ``State`` as given."""
    return {"state": state, "status": ENGINE_STATUS, "enums": ENGINE_ENUMS, "volume_range": ENGINE_VOLUME_RANGE}


def file_backed_readings() -> Readings:
    """A ``Readings`` already holding the File's reading."""
    readings = Readings()
    readings.file_config = FILE_CONFIG
    return readings


@pytest.mark.parametrize("generation", [FIRST_GENERATION, LATER_GENERATION])
def test_an_engine_reading_is_stamped_engine_with_the_generation_it_was_read_in(generation: int) -> None:
    readings = file_backed_readings()
    readings.take_engine(generation, **engine_fields(ENGINE_STATE))
    assert readings.engine_stamp == Stamp(source=Source.ENGINE, generation=generation)


@pytest.mark.parametrize("state", [ENGINE_STATE, OTHER_ENGINE_STATE])
def test_the_engine_snapshot_carries_the_state_the_engine_answered(state: dict[str, str]) -> None:
    readings = file_backed_readings()
    readings.take_engine(FIRST_GENERATION, **engine_fields(state))
    snapshot = readings.engine_snapshot()
    assert snapshot is not None
    assert snapshot.state == state


def test_a_break_ends_the_engine_view_read_before_it() -> None:
    readings = file_backed_readings()
    readings.take_engine(FIRST_GENERATION, **engine_fields(ENGINE_STATE))
    before = readings.engine_snapshot()
    readings.break_engine()
    assert readings.engine_snapshot() != before


@pytest.mark.parametrize("unread", ["state", "volume_range"])
def test_after_a_break_a_field_the_next_reading_did_not_carry_reads_as_not_read(
    unread: Literal["state", "volume_range"],
) -> None:
    readings = file_backed_readings()
    readings.take_engine(FIRST_GENERATION, **engine_fields(ENGINE_STATE))
    readings.break_engine()
    next_fields = engine_fields(OTHER_ENGINE_STATE)
    next_fields["status"] = NEXT_ENGINE_STATUS
    del next_fields[unread]
    readings.take_engine(NEXT_GENERATION, **next_fields)
    snapshot = readings.engine_snapshot()
    assert snapshot is not None
    assert (getattr(snapshot, unread), snapshot.status) == (None, NEXT_ENGINE_STATUS)


@pytest.mark.parametrize("generation", [NEXT_GENERATION, LATER_GENERATION])
def test_the_first_reading_after_a_break_is_stamped_with_its_own_generation(generation: int) -> None:
    readings = file_backed_readings()
    readings.take_engine(FIRST_GENERATION, **engine_fields(ENGINE_STATE))
    readings.break_engine()
    readings.take_engine(generation, **engine_fields(OTHER_ENGINE_STATE))
    assert readings.engine_stamp == Stamp(source=Source.ENGINE, generation=generation)


@pytest.mark.parametrize("generation", [FIRST_GENERATION, LATER_GENERATION])
def test_the_held_reading_keeps_the_generation_it_was_read_in_past_the_next_reading(generation: int) -> None:
    readings = file_backed_readings()
    readings.take_engine(generation, **engine_fields(ENGINE_STATE))
    readings.break_engine()
    readings.take_engine(generation + 1, **engine_fields(OTHER_ENGINE_STATE))
    held = readings.take_held()
    assert held is not None
    assert held.stamp == Stamp(source=Source.ENGINE, generation=generation)


@pytest.mark.parametrize(("earlier", "last"), [(ENGINE_STATE, OTHER_ENGINE_STATE), (OTHER_ENGINE_STATE, ENGINE_STATE)])
def test_the_held_reading_is_the_last_one_taken_before_the_break(earlier: dict[str, str], last: dict[str, str]) -> None:
    readings = file_backed_readings()
    readings.take_engine(FIRST_GENERATION, **engine_fields(earlier))
    readings.take_engine(FIRST_GENERATION, **engine_fields(last))
    readings.break_engine()
    readings.take_engine(NEXT_GENERATION, **engine_fields(earlier))
    held = readings.take_held()
    assert held is not None
    assert held.state == last


def test_the_held_reading_is_given_up_once_it_is_taken() -> None:
    readings = file_backed_readings()
    readings.take_engine(FIRST_GENERATION, **engine_fields(ENGINE_STATE))
    readings.break_engine()
    first = readings.take_held()
    assert readings.take_held() != first
