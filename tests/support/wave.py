"""RIFF/WAVE containers for the tests, packed here and nowhere else.

The builders write the container's own layout (a chunk is its tag, a little-endian size field and its payload; a
RIFF form is its magic, a size field and a form type ahead of its chunks), independent of the code that reads one, so
a reader and its fixture cannot agree on a layout that is wrong. A case that is about one wrong field of a
container takes the parts it needs and names that field itself.
"""

import struct


def fmt_payload(
    *, channels: int = 1, rate: int = 44100, byte_rate: int = 88200, block: int = 2, bits: int = 16, tag: int = 1
) -> bytes:
    """A 16-byte ``fmt `` payload: format ``tag``, ``channels``, ``rate``, ``byte_rate``, ``block`` and ``bits``.

    Every field defaults to one 16-bit PCM channel at 44100 Hz, so a case names only the field it changes.
    """
    return struct.pack("<HHIIHH", tag, channels, rate, byte_rate, block, bits)


def chunk(tag: bytes, payload: bytes, declared: int | None = None) -> bytes:
    """One RIFF chunk: ``tag``, its size field (``declared``, else the payload length) and ``payload``."""
    size = len(payload) if declared is None else declared
    return tag + struct.pack("<I", size) + payload


def riff(chunks: bytes, magic: bytes = b"RIFF", form: bytes = b"WAVE") -> bytes:
    """A RIFF container of form ``form`` holding ``chunks``, its size field kept in step with them."""
    return magic + struct.pack("<I", 4 + len(chunks)) + form + chunks


def pcm_wave(fmt: bytes, samples: bytes) -> bytes:
    """A well-formed WAVE container: a ``fmt `` chunk of ``fmt`` and a ``data`` chunk of ``samples``."""
    return riff(chunk(b"fmt ", fmt) + chunk(b"data", samples))
