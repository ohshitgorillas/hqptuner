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
