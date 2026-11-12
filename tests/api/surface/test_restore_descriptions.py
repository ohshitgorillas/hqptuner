"""A description entry an archive carries meets the limits a ``PUT`` does, or is dropped and the rest merge."""

import json
from pathlib import Path

import pytest

from hqptuner.presets.store.descriptions import DescriptionStore

_VALID = "Living Room"


@pytest.fixture
def merged(tmp_path: Path) -> DescriptionStore:
    """A store that has merged one valid entry and one of each kind a ``PUT`` would refuse."""
    texts = {"Long text": "x" * 2001, "Bad\x01name": "ok", "n" * 129: "ok", _VALID: "warm"}
    profiles = {name: {"text": text, "updated": "2000-01-01T00:00:00+00:00"} for name, text in texts.items()}
    store = DescriptionStore(tmp_path / "descriptions.json")
    store.merge(json.dumps({"schema": 1, "profiles": profiles}).encode())
    return store


@pytest.mark.parametrize("name", ["Long text", "Bad\x01name", "n" * 129], ids=["text-too-long", "control", "name-long"])
def test_a_carried_entry_past_the_put_limits_is_dropped(merged: DescriptionStore, name: str) -> None:
    assert name not in merged.read()


def test_the_valid_entry_beside_dropped_ones_merges(merged: DescriptionStore) -> None:
    assert merged.read()[_VALID]["text"] == "warm"
