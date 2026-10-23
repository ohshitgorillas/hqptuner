"""Pipeline rows and their derived count are one pending edit."""

import json
from contextlib import suppress

import pytest

from hqptuner.conf.xmledit import GroundingError
from hqptuner.core.pending import PendingSnapshot, PendingStore, clean_pending
from hqptuner.core.readings import Readings

ROW = {"source": "0", "gain": "0", "gainunit": "dB", "mixdown": "0", "process": ""}
GENERATION = 7
TITLE = "fixture-title"
REPLACEMENT = "fixture-replacement"
INVALID_ROWS = ["{", json.dumps([{"source": "left"}]), json.dumps(["row"])]


def rows(count: int) -> str:
    return json.dumps([ROW] * count)


# Break: stage rows without deriving their count.
@pytest.mark.parametrize(("size", "count"), [(2, "2"), (5, "5"), (128, "128")])
def test_staging_rows_derives_the_count(size: int, count: str) -> None:
    store = PendingStore()
    store.stage(live={}, http={"matrix_pipelines": rows(size)})
    assert store.snapshot().http.get("pipelines") == count


# Break: replacing rows leaves the count belonging to the previous rows.
@pytest.mark.parametrize(("size", "count"), [(3, "3"), (6, "6")])
def test_replacing_rows_replaces_their_count(size: int, count: str) -> None:
    store = PendingStore()
    store.stage(live={}, http={"matrix_pipelines": rows(4)})
    store.stage(live={}, http={"matrix_pipelines": rows(size)})
    assert store.snapshot().http.get("pipelines") == count


# Break: notify before the count is staged, or notify separately for each half.
@pytest.mark.parametrize(("size", "count"), [(3, "3"), (5, "5")])
def test_observers_receive_one_complete_pipeline_edit(size: int, count: str) -> None:
    heard: list[tuple[str | None, str | None]] = []
    store = PendingStore(
        on_change=lambda: heard.append(
            (store.snapshot().http.get("matrix_pipelines"), store.snapshot().http.get("pipelines"))
        )
    )
    payload = rows(size)
    store.stage(live={}, http={"matrix_pipelines": payload})
    assert heard == [(payload, count)]


# Break: defer row validation until Apply.
@pytest.mark.parametrize("payload", INVALID_ROWS)
def test_invalid_rows_are_rejected_during_staging(payload: str) -> None:
    store = PendingStore()
    with pytest.raises(GroundingError):
        store.stage(live={}, http={"matrix_pipelines": payload})


# Break: merge an unrelated field before validating the rows in the same edit.
@pytest.mark.parametrize("payload", INVALID_ROWS)
def test_invalid_rows_leave_the_rest_of_the_buffer_untouched(payload: str) -> None:
    store = PendingStore()
    store.stage(live={}, http={"title": TITLE})
    with suppress(GroundingError):
        store.stage(live={}, http={"title": REPLACEMENT, "matrix_pipelines": payload})
    assert store.snapshot().http.get("title") == TITLE


# Break: overwrite the old rows before validating their replacement.
@pytest.mark.parametrize("payload", INVALID_ROWS)
def test_invalid_replacement_preserves_the_previous_pipeline_edit(payload: str) -> None:
    store = PendingStore()
    previous = rows(3)
    store.stage(live={}, http={"matrix_pipelines": previous, "pipelines": "3"})
    with suppress(GroundingError):
        store.stage(live={}, http={"matrix_pipelines": payload})
    assert store.snapshot().http.get("matrix_pipelines") == previous


# Break: dropping either half leaves its companion in the pending buffer.
@pytest.mark.parametrize(
    ("removed", "companion", "expected"),
    [("matrix_pipelines", "pipelines", None), ("pipelines", "matrix_pipelines", None), ("title", "pipelines", "3")],
)
def test_dropping_either_half_drops_the_pipeline_edit(removed: str, companion: str, expected: str | None) -> None:
    store = PendingStore()
    store.stage(live={}, http={"matrix_pipelines": rows(3), "pipelines": "3"})
    store.drop(live={}, http=[removed])
    assert store.snapshot().http.get(companion) == expected


# Break: cleaning the already-current half strands the still-dirty companion.
@pytest.mark.parametrize(("file_rows", "file_count"), [(rows(3), "4"), (rows(4), "3")])
def test_reconciliation_retains_both_halves_until_both_are_current(file_rows: str, file_count: str) -> None:
    readings = Readings()
    readings.take_file(generation=GENERATION, file_config={"matrix_pipelines": file_rows, "pipelines": file_count})
    payload = rows(3)
    pending = PendingSnapshot(live={}, http={"matrix_pipelines": payload, "pipelines": "3"})
    cleaned = clean_pending(pending, readings)
    assert (cleaned.http.get("matrix_pipelines"), cleaned.http.get("pipelines")) == (payload, "3")
