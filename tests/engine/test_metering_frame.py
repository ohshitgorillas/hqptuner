"""The metering frame read: the header bytes come back as they arrived, and an implausible header is refused.

Each case feeds bytes to a real ``asyncio.StreamReader``. The frames are packed by the tests' own layout in
``fake_metering``, not by the engine's struct.
"""

import asyncio
import struct

import pytest
from fake_metering import mono_frame

from hqptuner.engine.metering import MAX_BINS, MAX_CHANNELS, ImplausibleMeteringHeaderError, read_raw_frame

#: A float32 that is not a tidy number: a signaling NaN with a payload bit, which only a read as sent hands back.
SIGNALING_NAN = struct.pack("<I", 0x7FA00001)


def _fed(data: bytes) -> asyncio.StreamReader:
    """A stream reader holding ``data`` and then end of stream."""
    reader = asyncio.StreamReader()
    reader.feed_data(data)
    reader.feed_eof()
    return reader


def _header(*, channels: int, bins: int) -> bytes:
    """A 32-byte header carrying the given counts."""
    return struct.pack("<4I3fI", 1, channels, bins, 16, 22050.0, 0.01, 2.0, 0)


async def test_a_frame_read_hands_back_the_header_bytes_it_was_sent_and_a_body_sized_from_that_header() -> None:
    frame = mono_frame(bandwidth=22050.0, transform_time=0.01, bits=16, gain=2.0, reals=[0.5] * 4, imags=[0.25] * 4)
    sent_header = frame[:24] + SIGNALING_NAN + frame[28:32]
    sent = sent_header + frame[32:]
    raw, header, body = await read_raw_frame(_fed(sent + b"trailing bytes of the next frame"))
    assert (raw, body, header[1:3]) == (sent_header, sent[32:], (1, 4))


@pytest.mark.parametrize(
    ("channels", "bins"),
    [
        pytest.param(0, 8, id="no channels"),
        pytest.param(MAX_CHANNELS + 1, 8, id="too many channels"),
        pytest.param(2, 1, id="one bin"),
        pytest.param(2, MAX_BINS + 1, id="too many bins"),
    ],
)
async def test_a_header_with_a_channel_or_bin_count_out_of_range_is_refused(channels: int, bins: int) -> None:
    with pytest.raises(ImplausibleMeteringHeaderError):
        await read_raw_frame(_fed(_header(channels=channels, bins=bins)))
