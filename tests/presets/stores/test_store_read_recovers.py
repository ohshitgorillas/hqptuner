"""A store whose file was broken and is then fixed reads again, through the same store, with no restart.

Characterization of behavior that already exists.

Each case opens one store over a file under ``tmp_path``, saves into it through
the store's own surface, then overwrites the file with bytes that will not
parse or with a stamp no build has written, and reads once, which refuses. The
user then puts the saved bytes back. The store still open must read exactly
what a store opened afresh over the fixed file reads, as the app would after a
restart.
"""

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import pytest

from hqptuner.errors import HQPTunerError
from hqptuner.presets.store.autopilot import AutopilotStore
from hqptuner.presets.store.descriptions import DescriptionStore
from hqptuner.presets.store.favorites import FavoriteStore
from hqptuner.presets.store.live import LivePresetStore, LiveRecord
from hqptuner.presets.store.matrixmode import MatrixModeStore
from hqptuner.presets.store.narrowing import NarrowingStore
from hqptuner.presets.store.presets import PresetStore

PRESET = "Den"
PRESET_XML = b"<hqplayerd/>"
RECORD = LiveRecord(chain="pcm", fields={"filter": "12"})

#: Bytes no JSON reader parses.
CORRUPT = b"{not json"

#: A document stamped with a schema no build of HQPTuner has written.
TOO_NEW = b'{"schema": 9999}'


@dataclass(frozen=True)
class Opened:
    """One open store: its first save and its read, bound to that one instance."""

    save: Callable[[], object]
    read: Callable[[], object]


def favorites(root: Path) -> Opened:
    store = FavoriteStore(root / "favorites.json")
    return Opened(lambda: store.write(["sinc-M"]), store.read)


def narrowing(root: Path) -> Opened:
    store = NarrowingStore(root / "narrowing.json")
    return Opened(lambda: store.write({"genre": ["jazz"]}), store.read)


def descriptions(root: Path) -> Opened:
    store = DescriptionStore(root / "descriptions.json")
    return Opened(lambda: store.write(PRESET, "Warm."), store.read)


def matrix_modes(root: Path) -> Opened:
    store = MatrixModeStore(root / "matrixmodes.json")
    return Opened(lambda: store.write(PRESET, "headphones"), store.read)


def autopilot(root: Path) -> Opened:
    store = AutopilotStore(root / "autopilot.json")
    return Opened(lambda: store.set_for_preset(PRESET, enabled=True), store.read)


def live_snapshots(root: Path) -> Opened:
    store = LivePresetStore(root / "live-presets.json", stations=list)
    return Opened(lambda: store.save("alpha", RECORD, [""]), store.book)


def preset_listing(root: Path) -> Opened:
    store = PresetStore(root / "presets")
    return Opened(lambda: store.save(PRESET, PRESET_XML), store.names)


def active_preset(root: Path) -> Opened:
    store = PresetStore(root / "presets")

    def save_then_activate() -> None:
        store.save(PRESET, PRESET_XML)
        store.set_active(PRESET)

    return Opened(save_then_activate, lambda: store.active)


#: Each store, the file under ``tmp_path`` a user breaks, and how it is broken.
BROKEN = [
    *[
        pytest.param(opener, file, broken, id=f"{file}-{kind}")
        for opener, file in [
            (favorites, "favorites.json"),
            (narrowing, "narrowing.json"),
            (descriptions, "descriptions.json"),
            (matrix_modes, "matrixmodes.json"),
            (autopilot, "autopilot.json"),
            (live_snapshots, "live-presets.json"),
            (preset_listing, "presets/store.json"),
        ]
        for kind, broken in [("corrupt", CORRUPT), ("too-new", TOO_NEW)]
    ],
    pytest.param(active_preset, "presets/active.json", CORRUPT, id="presets/active.json-corrupt"),
]


def refuse(read: Callable[[], object]) -> None:
    """Read once, expecting the store's refusal; raise when the read is not refused, so the case cannot run."""
    try:
        read()
    except HQPTunerError:
        return
    message = "the broken file read without a refusal"
    raise RuntimeError(message)


@pytest.mark.parametrize(("opener", "file", "broken"), BROKEN)
def test_a_store_reads_again_once_its_broken_file_is_fixed(
    tmp_path: Path, opener: Callable[[Path], Opened], file: str, broken: bytes
) -> None:
    store = opener(tmp_path)
    store.save()
    path = tmp_path / file
    fixed = path.read_bytes()
    path.write_bytes(broken)
    refuse(store.read)
    path.write_bytes(fixed)
    assert store.read() == opener(tmp_path).read()
