"""The source-format facet, stored server-side (docs/testing.md).

The narrow bar carries a two-state control over the format the user's library is
in: ``pcm`` for a library that is PCM throughout, ``both`` for one that also
holds DSD files. It defaults to ``pcm``.

This file is the store half of that: the wire key is ``src_format`` and the
token set is exactly those two words. What the control then discloses is the
frontend's subject (tests/js/components/conversioncards-dsd.test.js); it narrows
no dropdown at all (tests/js/store/srcformat.test.js).

Narrowing is purely presentational and never reaches hqplayerd
(docs/architecture.md, "Filter narrowing"), so every store here lands under
pytest's ``tmp_path`` and nothing is daemon-facing.
"""

import json
from pathlib import Path

import pytest

from hqptuner.presets.narrowingstore import NarrowingError, NarrowingStore

#: The two states of the source-format control.
STATES = ["pcm", "both"]

#: The state a store that was never written reports.
DEFAULT_STATE = "pcm"

#: Well-typed tokens outside the control's domain. ``dsd`` and ``sdm`` are the
#: near misses a client naming HQPlayer's own output modes would send.
OUT_OF_DOMAIN = ["dsd", "sdm", "all", "", "PCM"]


def store_at(tmp_path: Path) -> NarrowingStore:
    return NarrowingStore(tmp_path / "narrowing.json")


def store_src_format(tmp_path: Path, value: object) -> Path:
    """Put ``value`` under ``src_format`` in a file the store itself wrote.

    Either on-disk layout is accepted — the facets nested under ``facets``, or
    the facets beside the schema stamp — so these cases pin what a stored entry
    means rather than where it sits.
    """
    path = tmp_path / "narrowing.json"
    store_at(tmp_path).write({"phase": "linear"})
    doc = json.loads(path.read_text())
    inner = doc.get("facets")
    facets = inner if isinstance(inner, dict) else doc
    facets["src_format"] = value
    path.write_text(json.dumps(doc))
    return path


# --- the control's own domain -------------------------------------------------


def test_a_store_that_was_never_written_reports_the_source_format_at_pcm(tmp_path: Path) -> None:
    assert store_at(tmp_path).read()["src_format"] == DEFAULT_STATE


@pytest.mark.parametrize("state", STATES)
def test_a_written_source_format_reads_back_as_written(tmp_path: Path, state: str) -> None:
    store = store_at(tmp_path)
    store.write({"src_format": state})
    assert store.read()["src_format"] == state


@pytest.mark.parametrize("state", STATES)
def test_a_write_answers_with_the_source_format_it_stored(tmp_path: Path, state: str) -> None:
    assert store_at(tmp_path).write({"src_format": state})["src_format"] == state


# --- what the control refuses --------------------------------------------------
# The refusal names the facet and the value, so a client that sent a token from
# HQPlayer's output-mode vocabulary is told which control and which word.


@pytest.mark.parametrize("value", OUT_OF_DOMAIN)
def test_an_out_of_domain_source_format_write_is_refused_naming_the_facet(tmp_path: Path, value: str) -> None:
    with pytest.raises(NarrowingError, match="src_format"):
        store_at(tmp_path).write({"src_format": value})


@pytest.mark.parametrize("value", [v for v in OUT_OF_DOMAIN if v])
def test_an_out_of_domain_source_format_write_is_refused_naming_the_value(tmp_path: Path, value: str) -> None:
    with pytest.raises(NarrowingError, match=value):
        store_at(tmp_path).write({"src_format": value})


# --- what a stored file may hold ------------------------------------------------
# A file another version — or a broken write — left behind loses the facet rather
# than the narrow bar: an unreadable entry reads as the default.


@pytest.mark.parametrize("value", OUT_OF_DOMAIN)
def test_an_out_of_domain_stored_source_format_reads_as_pcm(tmp_path: Path, value: str) -> None:
    store_src_format(tmp_path, value)
    assert store_at(tmp_path).read()["src_format"] == DEFAULT_STATE


def test_an_out_of_domain_stored_source_format_leaves_the_other_facets_alone(tmp_path: Path) -> None:
    store_src_format(tmp_path, "dsd")
    assert store_at(tmp_path).read()["phase"] == "linear"
