"""The 1x lossy-source facet, stored server-side (docs/testing.md).

The narrow bar's 1x stage no longer hides hi-res-named filters behind a
show/hide switch. It groups by SOURCE CLASS instead: one three-state control
over the filters HQPlayer documents as being for lossy and lossy-adjacent
sources — the ``hires`` families and ``poly-sinc-mqa/mp3`` — with the states
``lossless``, ``lossy`` and ``both``, defaulting to ``both``.

This file is the store half of that: the wire key is ``lossy_1x``, the retired
``hires_1x`` and ``hires_nx`` keys are no longer facets at all, and a file an
older HQPTuner left carrying them reads as if they were never there and loses
them on the next write. Which filters each state then offers is the frontend's
subject (tests/js/store/narrowing-lossy.test.js).

Narrowing is purely presentational and never reaches hqplayerd
(docs/architecture.md, "Filter narrowing"), so every store here lands under
pytest's ``tmp_path`` and nothing is daemon-facing.
"""

import json
from pathlib import Path

import pytest

from hqptuner.presets.narrowingstore import NarrowingError, NarrowingStore

#: The three states of the 1x lossy control.
STATES = ["lossless", "lossy", "both"]

#: The state a store that was never written reports.
DEFAULT_STATE = "both"

#: The keys the per-class show/hide pair used to occupy, against a value each
#: once accepted. Neither is a facet any more.
RETIRED_HIRES: dict[str, object] = {"hires_1x": "hide", "hires_nx": "all"}

#: Well-typed tokens outside the control's domain.
OUT_OF_DOMAIN = ["hide", "show", "only", "", "hires"]


def store_at(tmp_path: Path) -> NarrowingStore:
    return NarrowingStore(tmp_path / "narrowing.json")


def seeded_with(tmp_path: Path, legacy: str) -> Path:
    """The file an older HQPTuner left: the retired key present, no ``lossy_1x``.

    Written by the store itself so the layout is the store's own, then edited —
    either on-disk layout is accepted, the facets nested under ``facets`` or the
    facets beside the schema stamp, so these cases pin what a stored entry means
    rather than where it sits.
    """
    path = tmp_path / "narrowing.json"
    store_at(tmp_path).write({"phase": ["linear"]})
    doc = json.loads(path.read_text())
    inner = doc.get("facets")
    facets = inner if isinstance(inner, dict) else doc
    facets.pop("lossy_1x", None)
    facets[legacy] = RETIRED_HIRES[legacy]
    path.write_text(json.dumps(doc))
    return path


# --- the control's own domain -------------------------------------------------


def test_a_store_that_was_never_written_reports_the_lossy_control_at_both(tmp_path: Path) -> None:
    assert store_at(tmp_path).read()["lossy_1x"] == DEFAULT_STATE


@pytest.mark.parametrize("state", STATES)
def test_a_written_lossy_state_reads_back_as_written(tmp_path: Path, state: str) -> None:
    store = store_at(tmp_path)
    store.write({"lossy_1x": state})
    assert store.read()["lossy_1x"] == state


@pytest.mark.parametrize("state", STATES)
def test_a_write_answers_with_the_lossy_state_it_stored(tmp_path: Path, state: str) -> None:
    assert store_at(tmp_path).write({"lossy_1x": state})["lossy_1x"] == state


# --- what the control refuses --------------------------------------------------
# The refusal names the facet and the value, so a client that sent a token from
# the retired show/hide vocabulary is told which control and which word.


@pytest.mark.parametrize("value", OUT_OF_DOMAIN)
def test_an_out_of_domain_lossy_write_is_refused_naming_the_facet(tmp_path: Path, value: str) -> None:
    with pytest.raises(NarrowingError, match="lossy_1x"):
        store_at(tmp_path).write({"lossy_1x": value})


@pytest.mark.parametrize("value", [v for v in OUT_OF_DOMAIN if v])
def test_an_out_of_domain_lossy_write_is_refused_naming_the_value(tmp_path: Path, value: str) -> None:
    with pytest.raises(NarrowingError, match=value):
        store_at(tmp_path).write({"lossy_1x": value})


# --- the retired per-class show/hide pair ---------------------------------------


@pytest.mark.parametrize("legacy", sorted(RETIRED_HIRES))
def test_a_write_of_a_retired_hires_key_is_refused_naming_that_key(tmp_path: Path, legacy: str) -> None:
    with pytest.raises(NarrowingError, match=legacy):
        store_at(tmp_path).write({legacy: RETIRED_HIRES[legacy]})


@pytest.mark.parametrize("legacy", sorted(RETIRED_HIRES))
def test_a_stored_retired_hires_key_does_not_surface_on_read(tmp_path: Path, legacy: str) -> None:
    seeded_with(tmp_path, legacy)
    assert legacy not in store_at(tmp_path).read()


# Nor does a retired key migrate into the new control: the file below carries
# `hires_1x: "hide"` and no `lossy_1x` at all, so a read that mapped the old
# hide onto the new "lossless" would answer something other than the default.
@pytest.mark.parametrize("legacy", sorted(RETIRED_HIRES))
def test_a_file_carrying_a_retired_hires_key_reads_the_lossy_control_at_its_default(
    tmp_path: Path, legacy: str
) -> None:
    seeded_with(tmp_path, legacy)
    assert store_at(tmp_path).read()["lossy_1x"] == DEFAULT_STATE


@pytest.mark.parametrize("legacy", sorted(RETIRED_HIRES))
def test_the_next_write_drops_a_retired_hires_key_from_the_file(tmp_path: Path, legacy: str) -> None:
    path = seeded_with(tmp_path, legacy)
    store_at(tmp_path).write({"lossy_1x": "lossy"})
    assert legacy not in path.read_text()
