"""`MatrixModeStore` — which half of the Matrix tab a PRESET is for, and the JSON
file it lives in.

A preset is a whole hqplayerd config, and whether it drives speakers or
headphones is a property of that preset rather than of the browser that last
looked at it. hqplayerd re-serializes its config from its own model, so an
HQPTuner attribute added to the XML would not survive (docs/architecture.md
§2, docs/matrix-spec.md:31) — the choice therefore lives in HQPTuner's own
sidecar file, keyed by preset NAME, the stable join key.

This file covers the store surface alone: reading an install that never chose,
the round trip, what a mode may be, what a name may be, and what a file some
newer HQPTuner left looks like. The REST pair built over it is in
``tests/presets/test_matrix_mode_routes.py``.

Nothing here touches hqplayerd: a `MatrixModeStore` is a file and nothing else.
Every store file lands under pytest's ``tmp_path``, never in the repo's state
dir. The on-disk layout — ``{"schema": N, "presets": {name: "speakers" |
"headphones"}}`` — is the contract a DIFFERENT HQPTuner version reads, so the
case about a foreign file hand-writes one, the way a wire test hand-writes a
frame.

The name rule is the preset store's own (``hqptuner/presets/names.py``), so the
cases below take one name it refuses and one unusual name it accepts, both
lifted from ``tests/presets/test_preset_names.py``.
"""

import contextlib
import json
from pathlib import Path

import pytest

from hqptuner.presets.matrixmodestore import (
    MatrixModeError,
    MatrixModeSchemaError,
    MatrixModeStore,
)

#: A stamp no released HQPTuner can claim to understand.
TOO_NEW = {"schema": 99, "presets": {"Night": "headphones"}}

NAME = "Night"
OTHER = "Studio"


def store_at(tmp_path: Path) -> MatrixModeStore:
    return MatrixModeStore(tmp_path / "matrixmodes.json")


def seed(tmp_path: Path, content: str) -> Path:
    path = tmp_path / "matrixmodes.json"
    path.write_text(content)
    return path


# --- an install that never chose ---------------------------------------------


def test_reading_a_store_with_no_file_yields_no_modes(tmp_path: Path) -> None:
    assert store_at(tmp_path).read() == {}


def test_reading_a_store_with_no_file_creates_nothing(tmp_path: Path) -> None:
    store_at(tmp_path).read()
    assert list(tmp_path.iterdir()) == []


# --- the round trip -----------------------------------------------------------


@pytest.mark.parametrize("mode", [pytest.param("speakers", id="speakers"), pytest.param("headphones", id="headphones")])
def test_a_written_mode_reads_back_for_its_preset(tmp_path: Path, mode: str) -> None:
    store = store_at(tmp_path)
    store.write(NAME, mode)
    assert store.read()[NAME] == mode


def test_a_mode_reads_back_through_a_second_store_over_the_same_file(tmp_path: Path) -> None:
    store_at(tmp_path).write(NAME, "speakers")
    assert store_at(tmp_path).read()[NAME] == "speakers"


def test_writing_one_preset_leaves_another_presets_mode_alone(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write(OTHER, "headphones")
    store.write(NAME, "speakers")
    assert store.read()[OTHER] == "headphones"


def test_rewriting_a_preset_replaces_its_mode(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write(NAME, "speakers")
    store.write(NAME, "headphones")
    assert store.read()[NAME] == "headphones"


# --- a write answers with the whole map ----------------------------------------
# The caller renders every preset it knows about, so one write is one round trip.


def test_a_write_answers_with_the_whole_map_so_no_follow_up_read_is_needed(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.write(OTHER, "headphones")
    assert sorted(store.write(NAME, "speakers")) == ["Night", "Studio"]


def test_the_map_a_write_answers_with_carries_the_mode_just_written(tmp_path: Path) -> None:
    assert store_at(tmp_path).write(NAME, "speakers")[NAME] == "speakers"


# --- what a mode may be ---------------------------------------------------------


@pytest.mark.parametrize(
    "mode",
    [
        pytest.param("", id="empty"),
        pytest.param("Speakers", id="capitalised"),
        pytest.param("speaker", id="singular"),
        pytest.param("headphone", id="singular-headphone"),
        pytest.param("stereo", id="unknown-word"),
        pytest.param(" speakers", id="leading-space"),
    ],
)
def test_a_mode_that_is_neither_half_of_the_tab_is_refused(tmp_path: Path, mode: str) -> None:
    with pytest.raises(MatrixModeError):
        store_at(tmp_path).write(NAME, mode)


def test_a_refused_mode_leaves_the_previous_mode_in_place(tmp_path: Path) -> None:
    # The refusal itself is pinned above; suppressed here so the one assertion
    # this test owns is what the store was left holding.
    store = store_at(tmp_path)
    store.write(NAME, "speakers")
    with contextlib.suppress(MatrixModeError):
        store.write(NAME, "stereo")
    assert store.read()[NAME] == "speakers"


def test_a_refused_mode_stores_nothing_on_a_store_that_was_never_written(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    with contextlib.suppress(MatrixModeError):
        store.write(NAME, "stereo")
    assert store.read() == {}


# --- what a name may be -----------------------------------------------------------
# The rule is the preset store's (hqptuner/presets/names.py): a denylist that
# refuses what breaks a filename or a store and accepts the rest of Unicode
# (tests/presets/test_preset_names.py).


@pytest.mark.parametrize(
    "name",
    [
        pytest.param("", id="empty"),
        pytest.param(" ", id="only-whitespace"),
        pytest.param("a/b", id="forward-slash"),
        pytest.param("..", id="parent-directory"),
        pytest.param(".hidden", id="leading-dot"),
        pytest.param("a\x00b", id="nul"),
        pytest.param("Night ", id="trailing-space"),
    ],
)
def test_a_name_that_is_not_a_storable_preset_name_is_refused(tmp_path: Path, name: str) -> None:
    with pytest.raises(MatrixModeError):
        store_at(tmp_path).write(name, "speakers")


def test_a_refused_name_stores_nothing(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    with contextlib.suppress(MatrixModeError):
        store.write("a/b", "speakers")
    assert store.read() == {}


@pytest.mark.parametrize(
    "name",
    [
        pytest.param("Headphones — ZMF Ori 3.0", id="em-dash"),
        pytest.param("音楽プリセット", id="cjk"),
        pytest.param("Bass 🎧 boost", id="non-bmp-emoji"),
        pytest.param("Rock & Roll <loud> \"quoted\" 'single'", id="xml-metacharacters"),
    ],
)
def test_a_preset_name_the_preset_store_accepts_carries_a_mode(tmp_path: Path, name: str) -> None:
    assert store_at(tmp_path).write(name, "headphones")[name] == "headphones"


def test_an_unusual_name_reads_back_off_disk_exactly_as_given(tmp_path: Path) -> None:
    store_at(tmp_path).write("音楽プリセット", "speakers")
    assert list(store_at(tmp_path).read()) == ["音楽プリセット"]


# --- how many presets may carry a mode -------------------------------------------


def test_the_two_hundred_and_fifty_seventh_preset_is_refused(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    for i in range(256):
        store.write(f"preset-{i}", "speakers")
    with pytest.raises(MatrixModeError):
        store.write("preset-256", "speakers")


# The refusal above says nothing on its own about WHERE the ceiling is — a store
# that stopped at five would satisfy it — so the last preset under the ceiling is
# stated too.
def test_exactly_two_hundred_and_fifty_six_presets_are_accepted(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    for i in range(255):
        store.write(f"preset-{i}", "speakers")
    assert len(store.write("preset-255", "speakers")) == 256


# --- a file this HQPTuner did not write ---------------------------------------------


# A damaged file costs the recorded modes, not the page: the tab falls back to
# the last-used side rather than raising at the user.
@pytest.mark.parametrize(
    "content",
    [
        pytest.param("not json at all {", id="not-json"),
        pytest.param("", id="empty-file"),
        pytest.param("[]", id="json-list"),
        pytest.param('"Night"', id="json-string"),
        pytest.param("17", id="json-number"),
        pytest.param("null", id="json-null"),
    ],
)
def test_a_file_that_is_not_our_record_reads_as_empty(tmp_path: Path, content: str) -> None:
    seed(tmp_path, content)
    assert store_at(tmp_path).read() == {}


def test_a_file_stamped_by_a_newer_hqptuner_is_refused_on_read(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps(TOO_NEW))
    with pytest.raises(MatrixModeSchemaError):
        store_at(tmp_path).read()


def test_the_schema_refusal_is_caught_by_a_caller_catching_the_general_error(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps(TOO_NEW))
    with pytest.raises(MatrixModeError):
        store_at(tmp_path).read()


def test_a_file_another_hqptuner_wrote_reads_back_its_mode(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps({"schema": 1, "presets": {NAME: "headphones"}}))
    assert store_at(tmp_path).read()[NAME] == "headphones"
