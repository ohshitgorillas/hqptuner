"""LivePresetStore's station book through its public API (docs/testing.md).

A station is a config preset, named by the preset store; the unnamed default,
`""`, is a station too. Each station holds snapshots of its own, and one save
may write the same record to several. The store learns which stations exist
from the callable it is built with, which here stands in for the preset store.

The whole store is one JSON file under pytest's ``tmp_path``. The flat layout
older builds wrote (`{"schema": N, "presets": {...}}`) is written by hand, the
way a wire test writes a frame by hand: the situation is one another version
created.
"""

import json
from pathlib import Path

import pytest

from hqptuner.presets.store.live import LivePresetStore, LiveRecord, UnknownStationsError

RECORD = LiveRecord(chain="pcm", fields={"filter": "12"}, names={"filter": "poly-sinc-gauss-long"})

#: The stations the preset store names in these cases, besides the default.
STATIONS = ["Den", "Office"]


def store_at(tmp_path: Path) -> LivePresetStore:
    return LivePresetStore(tmp_path / "live-presets.json", stations=lambda: list(STATIONS))


@pytest.mark.parametrize(
    ("station", "expected"),
    [pytest.param("Den", {"alpha": RECORD}, id="saved-to"), pytest.param("Office", {}, id="not-saved-to")],
)
def test_a_record_saved_to_one_station_is_held_by_that_station_alone(
    tmp_path: Path, station: str, expected: dict[str, LiveRecord]
) -> None:
    store = store_at(tmp_path)
    store.save("alpha", RECORD, ["Den"])
    assert store.all(station) == expected


@pytest.mark.parametrize("station", ["", "Den"])
def test_one_save_writes_the_record_to_every_station_it_names(tmp_path: Path, station: str) -> None:
    store = store_at(tmp_path)
    store.save("alpha", RECORD, ["", "Den"])
    assert store.all(station) == {"alpha": RECORD}


@pytest.mark.parametrize("station", ["", "Den", "Office"])
def test_a_flat_file_reads_with_each_record_under_every_station_and_the_default(tmp_path: Path, station: str) -> None:
    (tmp_path / "live-presets.json").write_text(json.dumps({"schema": 4, "presets": {"alpha": RECORD.to_json()}}))
    assert store_at(tmp_path).all(station) == {"alpha": RECORD}


def test_saving_to_a_station_the_preset_store_does_not_name_is_refused(tmp_path: Path) -> None:
    with pytest.raises(UnknownStationsError, match="Nowhere"):
        store_at(tmp_path).save("alpha", RECORD, ["Den", "Nowhere"])


@pytest.mark.parametrize(
    ("station", "expected"),
    [pytest.param("Den", {}, id="deleted-from"), pytest.param("Office", {"alpha": RECORD}, id="kept-by")],
)
def test_deleting_a_record_from_one_station_leaves_it_under_another(
    tmp_path: Path, station: str, expected: dict[str, LiveRecord]
) -> None:
    store = store_at(tmp_path)
    store.save("alpha", RECORD, ["Den", "Office"])
    store.delete("Den", "alpha")
    assert store.all(station) == expected


@pytest.mark.parametrize(
    ("station", "expected"),
    [pytest.param("Den", {}, id="forgotten"), pytest.param("Office", {"alpha": RECORD}, id="kept")],
)
def test_forgetting_a_station_drops_its_records_and_no_other(
    tmp_path: Path, station: str, expected: dict[str, LiveRecord]
) -> None:
    store = store_at(tmp_path)
    store.save("alpha", RECORD, ["Den", "Office"])
    store.forget("Den")
    assert store.all(station) == expected


def test_the_book_lists_the_default_station_then_every_station_the_preset_store_names(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save("alpha", RECORD, ["Office"])
    assert list(store.book()) == ["", "Den", "Office"]


def test_the_book_holds_each_stations_records(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save("alpha", RECORD, ["Office"])
    assert store.book().get("Office") == {"alpha": RECORD}
