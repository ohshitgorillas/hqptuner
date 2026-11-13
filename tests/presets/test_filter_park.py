"""The filter park's byte ceiling and its handling of a name already parked,
read back as the members an apply ships, and what it keeps and refuses on
upload: hostile bytes in a name, RIFF/WAVE containers built chunk by chunk,
repeated uploads under one name, and a first upload into a backup directory
that does not exist yet. Every case drives `FilterPark.park` alone.

Every upload refusal the park raises is a `ValueError` the upload route answers
as `invalid_input`; these cases pin which refusal, by type.
"""

import struct
from collections.abc import Iterator
from contextlib import suppress
from pathlib import Path

import pytest
from conftest import minimal_wave

from hqptuner.presets.store.filterpark import (
    PARK_MAX_BYTES,
    FilterNameRefusedError,
    FilterNotWaveError,
    FilterPark,
    ParkAtCapacityError,
)

#: The daemon home the park reports paths against; never read by these cases.
HOME = "/x/home"

#: The one name both uploads carry, so the second always collides with the first.
NAME = "probe.wav"

#: Size of the second upload, in bytes; identical in every case, so only the
#: park's fill decides whether it is kept.
UPLOAD = 1024

#: A first upload that leaves exactly room for the second.
EXACT_FIT = PARK_MAX_BYTES - UPLOAD

#: A first upload that leaves one byte too little room for the second.
ONE_OVER = EXACT_FIT + 1

#: The first upload's size, and the sizes of everything parked once the second has been tried.
CEILING_CASES = [
    pytest.param(EXACT_FIT, [UPLOAD, EXACT_FIT], id="fills-the-park-exactly"),
    pytest.param(ONE_OVER, [ONE_OVER], id="one-byte-over"),
]


@pytest.fixture
def park(tmp_path: Path) -> Iterator[FilterPark]:
    """An empty park under ``tmp_path``, emptied again afterwards so no ceiling-sized file outlives the case."""
    filter_park = FilterPark(tmp_path / "park", HOME)
    yield filter_park
    filter_park.clear()


def _parked_sizes_after_a_colliding_upload(park: FilterPark, first: int) -> list[int]:
    """Park a ``first``-byte file, try an ``UPLOAD``-byte file under the same name, return the parked sizes sorted."""
    park.park(NAME, minimal_wave(first))
    with suppress(ParkAtCapacityError):
        park.park(NAME, minimal_wave(UPLOAD))
    return sorted(len(data) for data in park.members().values())


@pytest.mark.parametrize(("first", "expected"), CEILING_CASES)
def test_a_colliding_upload_is_parked_beside_the_first_only_while_the_park_stays_within_its_ceiling(
    park: FilterPark, first: int, expected: list[int]
) -> None:
    assert _parked_sizes_after_a_colliding_upload(park, first) == expected


#: The name every WAV case uploads under.
WAV_NAME = "probe.wav"

#: A 16-byte PCM `fmt ` payload: format 1, one channel, 44100 Hz, 88200 B/s, block 2, 16 bits.
FMT_PCM = struct.pack("<HHIIHH", 1, 1, 44100, 88200, 2, 16)

#: The same payload declaring zero channels, then declaring a zero sample rate.
FMT_NO_CHANNELS = struct.pack("<HHIIHH", 1, 0, 44100, 88200, 2, 16)
FMT_NO_RATE = struct.pack("<HHIIHH", 1, 1, 0, 88200, 2, 16)

#: One 16-bit null sample, the `data` payload of every container below.
SAMPLE = bytes(2)

#: Chunk sizes at and above 2 GiB, as a RIFF size field carries them.
TWO_GIB = 0x80000000
MAX_SIZE = 0xFFFFFFFF

#: A three-byte `LIST` payload: odd, so RIFF pads it with one byte.
ODD_PAYLOAD = b"abc"
PAD = b"\x00"

#: Bytes of a `fmt ` payload left before end of file when it is cut short.
FMT_CUT = 7


def _chunk(tag: bytes, payload: bytes, declared: int | None = None) -> bytes:
    """One RIFF chunk: ``tag``, its size field (``declared``, else the payload length) and ``payload``."""
    size = len(payload) if declared is None else declared
    return tag + struct.pack("<I", size) + payload


def _riff(chunks: bytes, magic: bytes = b"RIFF", form: bytes = b"WAVE") -> bytes:
    """A RIFF container of form ``form`` holding ``chunks``, its size field kept in step with them."""
    return magic + struct.pack("<I", 4 + len(chunks)) + form + chunks


FMT = _chunk(b"fmt ", FMT_PCM)
DATA = _chunk(b"data", SAMPLE)

NOT_WAVE = [
    pytest.param(_riff(b"fmt "), id="chunks-run-out-inside-the-fmt-header"),
    pytest.param(_riff(FMT + b"data\x02"), id="chunks-run-out-inside-the-data-header"),
    pytest.param(_riff(_chunk(b"LIST", b"", TWO_GIB) + FMT + DATA), id="chunk-before-fmt-declares-2gib"),
    pytest.param(_riff(_chunk(b"LIST", b"", MAX_SIZE) + FMT + DATA), id="chunk-before-fmt-declares-4gib-less-one"),
    pytest.param(_riff(DATA + _chunk(b"fmt ", FMT_PCM[:FMT_CUT], len(FMT_PCM))), id="fmt-truncated-at-eof"),
    pytest.param(_riff(_chunk(b"fmt ", FMT_NO_CHANNELS) + DATA), id="zero-channels"),
    pytest.param(_riff(_chunk(b"fmt ", FMT_NO_RATE) + DATA), id="zero-sample-rate"),
    pytest.param(_riff(FMT + DATA, form=b"AVI "), id="riff-but-not-wave"),
    pytest.param(_riff(FMT + DATA, magic=b"RIFX"), id="wave-without-riff"),
    pytest.param(_riff(DATA), id="fmt-missing"),
    pytest.param(_riff(FMT), id="data-missing"),
]

VALID_WAVE = [
    pytest.param(_riff(_chunk(b"LIST", ODD_PAYLOAD) + PAD + FMT + DATA), id="odd-chunk-padded-before-fmt"),
    pytest.param(_riff(FMT + _chunk(b"data", b"")), id="final-chunk-empty-data"),
    pytest.param(_riff(DATA + FMT), id="fmt-payload-ends-at-eof"),
]

#: Names carrying a control byte (lowest, highest below space), DEL, or `..` away from either end.
HOSTILE_NAMES = [
    pytest.param("pro\x00be.wav", id="nul"),
    pytest.param("pro\x1fbe.wav", id="unit-separator"),
    pytest.param("pro\nbe.txt", id="newline"),
    pytest.param("pro\x7fbe.wav", id="del"),
    pytest.param("pro..be.wav", id="dot-dot-inside"),
    pytest.param("probe..wav", id="dot-dot-before-extension"),
]

#: Names one byte away from a hostile one: space, tilde, a lone inner dot.
PLAIN_NAMES = [
    pytest.param("pro be.wav", id="space"),
    pytest.param("pro~be.wav", id="tilde"),
    pytest.param("pro.be.wav", id="single-dot"),
]

#: Three distinct bodies uploaded one after another under ``WAV_NAME``.
REPEATS = [minimal_wave(46), minimal_wave(48), minimal_wave(50)]


def _parked_after(park: FilterPark, name: str, body: bytes) -> dict[str, bytes]:
    """Upload ``body`` as ``name`` and return everything the park then holds."""
    park.park(name, body)
    return park.files()


@pytest.mark.parametrize("body", NOT_WAVE)
def test_a_wav_upload_that_is_not_a_readable_wave_container_is_refused_as_not_a_wav(
    park: FilterPark, body: bytes
) -> None:
    with pytest.raises(FilterNotWaveError):
        park.park(WAV_NAME, body)


@pytest.mark.parametrize("body", VALID_WAVE)
def test_a_valid_wave_container_with_an_unusual_chunk_layout_is_parked_verbatim(park: FilterPark, body: bytes) -> None:
    assert _parked_after(park, WAV_NAME, body) == {WAV_NAME: body}


@pytest.mark.parametrize("name", HOSTILE_NAMES)
def test_a_name_with_a_control_byte_del_or_dot_dot_is_refused(park: FilterPark, name: str) -> None:
    with pytest.raises(FilterNameRefusedError):
        park.park(name, minimal_wave() if name.endswith(".wav") else b"Preamp: -6.4 dB")


@pytest.mark.parametrize("name", PLAIN_NAMES)
def test_a_name_one_byte_from_a_hostile_one_is_parked_under_that_name(park: FilterPark, name: str) -> None:
    assert list(_parked_after(park, name, minimal_wave())) == [name]


def _upload_repeats(park: FilterPark) -> list[str]:
    """Upload every body in ``REPEATS`` under ``WAV_NAME``; return the names the park reported, in upload order."""
    return [park.park(WAV_NAME, body)["name"] for body in REPEATS]


def test_repeated_uploads_under_one_name_each_keep_their_own_bytes(park: FilterPark) -> None:
    _upload_repeats(park)
    assert sorted(park.files().values()) == sorted(REPEATS)


def test_repeated_uploads_under_one_name_report_the_distinct_names_they_were_parked_under(park: FilterPark) -> None:
    assert sorted(_upload_repeats(park)) == sorted(park.files())


def test_the_first_upload_parks_when_the_backup_directory_does_not_exist_yet(tmp_path: Path) -> None:
    fresh = FilterPark(tmp_path / "backup" / "pending-filters", HOME)
    assert _parked_after(fresh, WAV_NAME, minimal_wave()) == {WAV_NAME: minimal_wave()}
