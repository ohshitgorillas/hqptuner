"""Static-metadata join behavior (data/filters.json _join_rules)."""

from pathlib import Path

import pytest

from hqptuner.metadata import StaticMetadata

DATA_DIR = Path(__file__).parent.parent / "hqptuner" / "data"


@pytest.fixture()
def static() -> StaticMetadata:
    return StaticMetadata(DATA_DIR)


def test_exact_name_joins_its_own_entry(static: StaticMetadata) -> None:
    entry = static.filter_entry("poly-sinc-short-lp")
    assert entry is not None and "poly-sinc" in entry["description"]


def test_alias_joins_the_canonical_entry(static: StaticMetadata) -> None:
    assert static.filter_entry("poly-sinc-shrt-lp") == static.filter_entry("poly-sinc-short-lp")


def test_2s_suffix_joins_the_base_entry(static: StaticMetadata) -> None:
    base = static.filter_entry("poly-sinc-long-lp")
    assert base is not None and static.filter_entry("poly-sinc-long-lp-2s") is not None


def test_2s_description_carries_the_two_stage_note(static: StaticMetadata) -> None:
    entry = static.filter_entry("poly-sinc-long-lp-2s")
    assert entry is not None and "Two stage oversampling" in entry["description"]


def test_2s_description_keeps_the_base_prose(static: StaticMetadata) -> None:
    base = static.filter_entry("poly-sinc-long-lp")
    entry = static.filter_entry("poly-sinc-long-lp-2s")
    assert base is not None and entry is not None and entry["description"].startswith(base["description"])


def test_unknown_name_returns_none(static: StaticMetadata) -> None:
    assert static.filter_entry("no-such-filter") is None


# --- facet coverage (the narrowing overlay: quality/focus/apodizing/ratio) ---
# Every filter must carry the manual-transcribed facets, or the client's
# live-first/static-fallback facet map (store/facets.js) leaves the inactive
# output mode's filters un-narrowable. These guard the transcription.

FOCUS_TOKENS = {"transients", "timbre", "space"}
RATIO_CLASSES = {"integer", "2x", "1:1", "any"}


def _filters(static: StaticMetadata) -> dict[str, dict]:
    return static.raw["filters"]["filters"]


def _ratio_values(entry: dict) -> set:
    if "ratio" in entry:
        return {entry["ratio"]}
    return {entry.get("ratio_pcm"), entry.get("ratio_sdm")}


def test_every_filter_carries_quality_focus_and_apodizing(static: StaticMetadata) -> None:
    missing = [n for n, e in _filters(static).items() if not {"quality", "focus", "apodizing"} <= e.keys()]
    assert missing == []


def test_every_filter_carries_a_ratio_class(static: StaticMetadata) -> None:
    missing = [
        n for n, e in _filters(static).items() if "ratio" not in e and not ("ratio_pcm" in e and "ratio_sdm" in e)
    ]
    assert missing == []


def test_quality_ratings_are_ints_one_to_five(static: StaticMetadata) -> None:
    bad = [n for n, e in _filters(static).items() if e["quality"] not in range(1, 6)]
    assert bad == []


def test_apodizing_values_are_from_the_known_set(static: StaticMetadata) -> None:
    bad = [n for n, e in _filters(static).items() if e["apodizing"] not in {"full", "half", "none"}]
    assert bad == []


def test_focus_tokens_are_from_the_known_set(static: StaticMetadata) -> None:
    bad = [n for n, e in _filters(static).items() if set(e["focus"]) - FOCUS_TOKENS]
    assert bad == []


def test_ratio_classes_are_from_the_known_set(static: StaticMetadata) -> None:
    bad = [n for n, e in _filters(static).items() if _ratio_values(e) - RATIO_CLASSES]
    assert bad == []
