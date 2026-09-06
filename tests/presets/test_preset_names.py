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
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from hqptuner.presets.store.live import LivePresetError, LivePresetStore
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


# --- the two stores behind one save surface ------------------------------------
#
# The trailing-whitespace and mixed-script sweeps run through both stores. Each
# builder below roots a store under tmp_path, optionally holding one name an
# older build stored: the config store keeps <name>.xml beside its stamp (an
# unstamped directory is adopted, tests/presets/test_presetstore.py), the live
# store is one stamped JSON file, so the stamp is lifted off a file this build
# wrote rather than spelled out here.


def config_store(tmp_path: Path, seeded: str | None = None) -> PresetStore:
    directory = tmp_path / "presets"
    if seeded is not None:
        directory.mkdir()
        (directory / f"{seeded}.xml").write_bytes(PAYLOAD)
    return PresetStore(directory)


def live_store(tmp_path: Path, seeded: str | None = None) -> LivePresetStore:
    path = tmp_path / "live-presets.json"
    if seeded is not None:
        LivePresetStore(path).save("seed", RECORD)
        stamped = json.loads(path.read_text())
        stamped["presets"] = {seeded: RECORD}
        path.write_text(json.dumps(stamped))
    return LivePresetStore(path)


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
        store.save(name, RECORD)
        return list(store.all())
    except (PresetError, LivePresetError) as exc:
        return exc.code


# A Latin word with its first letter swapped for CYRILLIC SMALL LETTER A (U+0430):
# a name that looks like "admin" and is not. Spelled with chr() so the source
# says which letter is foreign; the string is the same at runtime.
MIXED_SCRIPT = chr(0x0430) + "dmin"
# The same word written entirely in Cyrillic, and a Latin name carrying the
# MICRO SIGN (U+00B5): neither mixes a script with Latin letters.
CYRILLIC = "админ"
MICRO = chr(0x00B5) + "-law"


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


# --- trailing whitespace is trimmed, not refused and not kept ----------------


@pytest.mark.parametrize(
    ("raw", "trimmed"),
    [
        pytest.param("Studio ", "Studio", id="one-space"),
        # a tab then a space: a rule that drops one trailing space leaves "Night\t"
        pytest.param("Night\t ", "Night", id="tab-and-space"),
    ],
)
@pytest.mark.parametrize("build", STORES)
def test_a_name_with_trailing_whitespace_is_stored_under_the_name_without_it(
    tmp_path: Path, build: Callable[[Path], PresetStore | LivePresetStore], raw: str, trimmed: str
) -> None:
    assert save_outcome(build(tmp_path), raw) == [trimmed]


# --- a name mixing Latin and Cyrillic letters --------------------------------


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        pytest.param(MIXED_SCRIPT, "name_invalid", id="latin-and-cyrillic"),
        pytest.param(CYRILLIC, [CYRILLIC], id="pure-cyrillic"),
        pytest.param(MICRO, [MICRO], id="latin-with-micro-sign"),
    ],
)
@pytest.mark.parametrize("build", STORES)
def test_a_first_save_refuses_a_mixed_script_name_and_takes_a_single_script_one(
    tmp_path: Path, build: Callable[[Path], PresetStore | LivePresetStore], name: str, expected: list[str] | str
) -> None:
    assert save_outcome(build(tmp_path), name) == expected


@pytest.mark.parametrize("build", STORES)
def test_a_mixed_script_name_the_store_already_holds_saves_while_a_new_one_is_refused(
    tmp_path: Path, build: Callable[[Path, str], PresetStore | LivePresetStore]
) -> None:
    # seeded the way an older build left it, so the first save is a re-save of a
    # held name and the second is a new mixed-script name entering the store
    store = build(tmp_path, MIXED_SCRIPT)
    assert [save_outcome(store, MIXED_SCRIPT), save_outcome(store, MIXED_SCRIPT + "2")] == [
        [MIXED_SCRIPT],
        "name_invalid",
    ]


def test_import_takes_a_mixed_script_daemon_profile_that_a_later_new_save_is_refused(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    assert [store.import_missing({MIXED_SCRIPT: PAYLOAD}), save_outcome(store, MIXED_SCRIPT + "2")] == [
        [MIXED_SCRIPT],
        "name_invalid",
    ]


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
