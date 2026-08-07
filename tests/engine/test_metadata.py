"""Static-metadata join behavior (data/filters.json _join_rules)."""

from pathlib import Path
from typing import Any

import pytest
from narrow import present

from hqptuner.metadata import StaticMetadata, merge_enumerations

DATA_DIR = Path(__file__).parent.parent.parent / "hqptuner" / "data"


@pytest.fixture()
def static() -> StaticMetadata:
    return StaticMetadata(DATA_DIR)


def test_exact_name_joins_its_own_entry(static: StaticMetadata) -> None:
    entry = present(static.filter_entry("poly-sinc-short-lp"))
    assert "poly-sinc" in entry["description"]


def test_alias_joins_the_canonical_entry(static: StaticMetadata) -> None:
    assert static.filter_entry("poly-sinc-shrt-lp") == static.filter_entry("poly-sinc-short-lp")


def test_2s_suffix_resolves_to_an_entry(static: StaticMetadata) -> None:
    assert static.filter_entry("poly-sinc-long-lp-2s") is not None


def test_2s_description_carries_the_two_stage_note(static: StaticMetadata) -> None:
    entry = present(static.filter_entry("poly-sinc-long-lp-2s"))
    assert "Two stage oversampling" in entry["description"]


def test_2s_description_keeps_the_base_prose(static: StaticMetadata) -> None:
    base = present(static.filter_entry("poly-sinc-long-lp"))
    entry = present(static.filter_entry("poly-sinc-long-lp-2s"))
    assert entry["description"].startswith(base["description"])


def test_unknown_name_returns_none(static: StaticMetadata) -> None:
    assert static.filter_entry("no-such-filter") is None


# --- facet coverage (the narrowing overlay: quality/focus/apodizing/ratio) ---
# Every filter must carry the manual-transcribed facets, or the client's
# live-first/static-fallback facet map (store/facets.js) leaves the inactive
# output mode's filters un-narrowable. These guard the transcription.

FOCUS_TOKENS = {"transients", "timbre", "space"}
RATIO_CLASSES = {"integer", "2x", "1:1", "any"}


def _filters(static: StaticMetadata) -> dict[str, dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = static.raw["filters"]["filters"]
    return entries


def _ratio_values(entry: dict[str, Any]) -> set[Any]:
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


# --- merge_enumerations: static prose attached to live engine items ----------
# The engine item stays authoritative (names, IDs, live facets); the static db
# only contributes prose, and an unmatched engine entry still renders.


def _filter_item(name: str, arg: str = "0") -> dict[str, str]:
    return {"index": "1", "name": name, "value": "40", "arg": arg}


def test_merge_attaches_static_prose_to_a_known_filter(static: StaticMetadata) -> None:
    merged = merge_enumerations({"filters": [_filter_item("poly-sinc-gauss-long")]}, static, "PCM")
    assert merged["filters"][0]["static"] is not None


def test_merge_leaves_an_unknown_filter_with_null_static(static: StaticMetadata) -> None:
    merged = merge_enumerations({"filters": [_filter_item("no-such-filter")]}, static, "PCM")
    assert merged["filters"][0]["static"] is None


def test_merge_keeps_the_engine_items_own_fields(static: StaticMetadata) -> None:
    merged = merge_enumerations({"filters": [_filter_item("sinc-M")]}, static, "PCM")
    assert merged["filters"][0]["value"] == "40"


@pytest.mark.parametrize("arg,apodizing", [("0", False), ("1", True), ("2", False), ("3", True)])
def test_merge_decodes_apodizing_from_arg_bit_zero(static: StaticMetadata, arg: str, *, apodizing: bool) -> None:
    merged = merge_enumerations({"filters": [_filter_item("sinc-M", arg=arg)]}, static, "PCM")
    assert merged["filters"][0]["apodizing"] is apodizing


def test_merge_treats_a_missing_arg_as_not_apodizing(static: StaticMetadata) -> None:
    merged = merge_enumerations({"filters": [{"index": "1", "name": "sinc-M", "value": "25"}]}, static, "PCM")
    assert merged["filters"][0]["apodizing"] is False


# --- shaper join picks its db by output mode: PCM dithers vs SDM modulators ---


def test_shaper_entry_reads_pcm_dithers_in_pcm_mode(static: StaticMetadata) -> None:
    assert static.shaper_entry("NS9", "PCM") is not None


def test_shaper_entry_reads_sdm_modulators_in_sdm_mode(static: StaticMetadata) -> None:
    assert static.shaper_entry("ASDM7EC", "SDM (DSD)") is not None


def test_shaper_entry_does_not_cross_modes(static: StaticMetadata) -> None:
    # NS9 is a PCM dither; in SDM mode the modulator db answers for shapers
    assert static.shaper_entry("NS9", "SDM (DSD)") is None


def test_merge_attaches_shaper_prose_by_mode(static: StaticMetadata) -> None:
    merged = merge_enumerations({"shapers": [{"index": "0", "name": "ASDM7EC", "value": "3"}]}, static, "SDM (DSD)")
    assert merged["shapers"][0]["static"] is not None
