"""Preset name rules, both stores, through their public APIs (docs/testing.md).

A preset name is a filename in HQPTuner's own store directory and a zip member
in the ``POST /restore`` archive that mirrors it to the daemon. Nothing in
HQPlayer's documentation constrains the charset of a configuration name
(``docs/protocol.md:66`` types it as unconstrained text), so the rule here is a
denylist: refuse only what breaks a filename, a zip member name or the store,
and accept the rest of Unicode.

The live store shares the naming rule even though a live snapshot name is a JSON
key rather than a filename; the byte-length and on-disk cases are therefore
config-store only.

Pure filesystem — no daemon, no socket, no HTTP. Every store is rooted under
pytest's ``tmp_path``.
"""

import contextlib
from pathlib import Path
from typing import Any

import pytest

from hqptuner.presets.store.live import LivePresetStore
from hqptuner.presets.store.presets import PresetError, PresetStore

PAYLOAD = b"<hqplayerd/>"

# The shape a live snapshot record has on the wire (see tests/live/test_live_presets.py);
# the store treats it as opaque, so the contents only need to survive a round trip.
RECORD: dict[str, Any] = {"chain": "pcm", "fields": {"filter": "40"}, "names": {"filter": "poly-sinc-gauss-long"}}

# Names that break nothing and must therefore be accepted verbatim. Measured
# against hqplayerd 6.0.4 on 2026-08-02: every one of these round-trips
# byte-identical through profile/save -> ConfigurationList -> /backup.
ACCEPTED_NAMES = [
    pytest.param("Headphones — ZMF Ori 3.0", id="em-dash"),
    pytest.param("Café Crème à la Naïveté", id="latin-accents"),
    pytest.param("音楽プリセット", id="cjk"),
    pytest.param("Bass 🎧 boost", id="non-bmp-emoji"),
    pytest.param("Rock & Roll <loud> \"quoted\" 'single'", id="xml-metacharacters"),
    pytest.param("100% + louder? #1 = best", id="url-metacharacters"),
    # The store keeps active.json and store.json beside the <name>.xml files.
    # A preset always carries the .xml suffix, so "active" lands at active.xml
    # and shadows nothing — these two names are ordinary, not reserved.
    pytest.param("active", id="sibling-active"),
    pytest.param("store", id="sibling-store"),
]

# Names that would break a filename, a zip member name or the store itself.
REFUSED_NAMES = [
    pytest.param("a/b", id="forward-slash"),
    pytest.param("/etc/passwd", id="absolute-path"),
    pytest.param("a\\b", id="backslash"),
    pytest.param("..", id="parent-directory"),
    pytest.param("Studio..xml", id="embedded-double-dot"),
    pytest.param(".hidden", id="leading-dot"),
    pytest.param("", id="empty"),
    pytest.param(" ", id="only-whitespace"),
    pytest.param(" Studio", id="leading-space"),
    pytest.param("Studio ", id="trailing-space"),
    pytest.param("a\x00b", id="nul"),
    pytest.param("a\x1fb", id="unit-separator"),
    pytest.param("a\x7fb", id="delete"),
]

# "é" written as e + U+0301 COMBINING ACUTE ACCENT, and its precomposed twin.
# The daemon does not normalize; neither may the store.
DECOMPOSED = "Café"  # C, a, f, e, U+0301
PRECOMPOSED = "Café"

# The filesystem's NAME_MAX is 255 BYTES. "ä" is two UTF-8 bytes, so both of
# these are far under 255 CHARACTERS: an implementation that counts characters
# accepts the overlong one and fails the refusal test below.
LONGEST_ACCEPTED = "ä" * 125 + "a"  # 251 bytes + ".xml" == 255
FIRST_REFUSED_LENGTH = "ä" * 126  # 252 bytes + ".xml" == 256


def store_at(tmp_path: Path) -> PresetStore:
    return PresetStore(tmp_path / "presets")


def live_store_at(tmp_path: Path) -> LivePresetStore:
    return LivePresetStore(tmp_path / "live-presets.json")


# --- accepted names, config store -------------------------------------------


@pytest.mark.parametrize("name", ACCEPTED_NAMES)
def test_a_preset_saved_under_an_accepted_name_reads_back_under_it(tmp_path: Path, name: str) -> None:
    store = store_at(tmp_path)
    store.save(name, PAYLOAD)
    assert store.read(name) == PAYLOAD


# --- accepted names, live store ---------------------------------------------


@pytest.mark.parametrize("name", ACCEPTED_NAMES)
def test_a_live_preset_saved_under_an_accepted_name_reads_back_under_it(tmp_path: Path, name: str) -> None:
    store = live_store_at(tmp_path)
    store.save(name, RECORD)
    assert store.read(name) == RECORD


# --- Unicode normalization is not the store's business -----------------------


def test_a_decomposed_name_reads_back_still_decomposed(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save(DECOMPOSED, PAYLOAD)
    assert store.names() == [DECOMPOSED]


def test_a_preset_saved_decomposed_does_not_answer_to_the_precomposed_name(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save(DECOMPOSED, PAYLOAD)
    assert store.exists(PRECOMPOSED) is False


def test_a_decomposed_live_preset_name_reads_back_still_decomposed(tmp_path: Path) -> None:
    store = live_store_at(tmp_path)
    store.save(DECOMPOSED, RECORD)
    assert list(store.all()) == [DECOMPOSED]


def test_a_live_preset_saved_decomposed_does_not_answer_to_the_precomposed_name(tmp_path: Path) -> None:
    store = live_store_at(tmp_path)
    store.save(DECOMPOSED, RECORD)
    assert PRECOMPOSED not in store.all()


# --- refusals ----------------------------------------------------------------


# --- the 255-BYTE filename boundary -----------------------------------------


def test_a_name_whose_utf8_bytes_plus_suffix_are_exactly_255_is_accepted(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    store.save(LONGEST_ACCEPTED, PAYLOAD)
    assert store.read(LONGEST_ACCEPTED) == PAYLOAD


# --- a refusal writes nothing ------------------------------------------------


@pytest.mark.parametrize(
    "name",
    [
        pytest.param("a/b", id="forward-slash"),
        pytest.param("../escape", id="parent-directory-hop"),
        pytest.param(".hidden", id="leading-dot"),
        pytest.param("a\x1fb", id="unit-separator"),
        pytest.param(FIRST_REFUSED_LENGTH, id="over-255-bytes"),
    ],
)
def test_a_refused_name_puts_no_payload_on_disk(tmp_path: Path, name: str) -> None:
    # The refusal itself is pinned above; suppressed here so the one assertion
    # this test owns is the disk check. A refused save may still materialize the
    # store directory and its stamp — that is bookkeeping, not a payload, so the
    # walk looks for the payload bytes specifically.
    store = store_at(tmp_path)
    with contextlib.suppress(PresetError):
        store.save(name, PAYLOAD)
    assert [p for p in tmp_path.rglob("*") if p.is_file() and PAYLOAD in p.read_bytes()] == []
