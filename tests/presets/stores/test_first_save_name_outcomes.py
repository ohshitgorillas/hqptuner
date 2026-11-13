"""What a name's first save answers, in both preset stores.

Characterization of behavior that already exists.

A first save takes the stricter first-save rule. A name the shared rule refuses
answers with the stable refusal code, never an unhandled error, and a letter this
Python's Unicode database carries no name for is an ordinary letter, not a crash.
"""

from collections.abc import Callable
from pathlib import Path

import pytest

from hqptuner.presets.store.live import LivePresetError, LivePresetStore, LiveRecord
from hqptuner.presets.store.presets import PresetError, PresetStore

PAYLOAD = b"<hqplayerd/>"
RECORD = LiveRecord(chain="pcm", fields={"filter": "40"}, names={"filter": "poly-sinc-gauss-long"})

#: The default station a live snapshot is saved under when no preset is loaded.
STATION = ""

#: A name the shared rule refuses: a leading period would make ``<name>.xml`` a hidden file.
REFUSED = ".hidden"

#: U+17000, a Tangut ideograph: a letter (category Lo) with no Unicode name in this Python.
UNNAMED_LETTER = chr(0x17000) + " Den"

NAME_INVALID = "name_invalid"


def config_store(tmp_path: Path) -> PresetStore:
    return PresetStore(tmp_path / "presets")


def live_store(tmp_path: Path) -> LivePresetStore:
    return LivePresetStore(tmp_path / "live-presets.json", stations=list)


STORES = [
    pytest.param(config_store, id="config-store"),
    pytest.param(live_store, id="live-store"),
]


def save_outcome(store: PresetStore | LivePresetStore, name: str) -> list[str] | str:
    """The store's listed names after saving ``name``, or the code the save was refused with."""
    try:
        if isinstance(store, PresetStore):
            store.save(name, PAYLOAD)
            return store.names()
        store.save(name, RECORD, [STATION])
        return list(store.all(STATION))
    except (PresetError, LivePresetError) as exc:
        return exc.code


@pytest.mark.parametrize("build", STORES)
def test_a_first_save_under_a_refused_name_answers_name_invalid(
    tmp_path: Path, build: Callable[[Path], PresetStore | LivePresetStore]
) -> None:
    assert save_outcome(build(tmp_path), REFUSED) == NAME_INVALID


@pytest.mark.parametrize("build", STORES)
def test_a_first_save_of_a_name_holding_a_letter_with_no_unicode_name_is_stored(
    tmp_path: Path, build: Callable[[Path], PresetStore | LivePresetStore]
) -> None:
    assert save_outcome(build(tmp_path), UNNAMED_LETTER) == [UNNAMED_LETTER]
