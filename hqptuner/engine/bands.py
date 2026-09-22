"""What one metering frame carries: its per-bin power, whether it is silent, and the three band levels the header reads.

The decode half is the frame layout of protocol.md §7. The band half is the header's level readout: three levels split
at fixed frequencies and a ring that holds a second of them, so the bars ride a second of music rather than whichever
frame the poll happened to land on.

The corners are frequencies rather than fractions of the bin count, so a tone reads in the same band whatever rate the
source runs at. The top bins ``blockstats`` drops are kept here: the bars report what the source sends rather than
scoring it.
"""

import math
import struct
from collections import deque
from collections.abc import Callable

# Frames quieter than this on every channel (RMS dBFS) carry no tone.
SILENT_RMS_DB = -90.0
# The readout's three bands: low below the first corner, mid between them, high from the second to the source Nyquist.
BAND_EDGES_HZ = (250.0, 4_000.0)
# How much frame time the readout averages over. A read neither drains nor resets it, so every page polling
# /api/status sees the same second.
BAND_WINDOW_SECONDS = 1.0
# Where a band with no power in it sits, and where the bars park.
BAND_FLOOR_DB = -100.0

#: one frame's low, mid and high levels, in dB
Bands = tuple[float, float, float]


def frame_silent(body: bytes, channels: int, bins: int) -> bool:
    """Whether every channel's RMS sits below the silence threshold.

    The RMS is the third float of the per-channel level block (protocol.md §7).
    """
    stride = 16 + 8 * bins
    return all(struct.unpack_from("<f", body, ch * stride + 8)[0] < SILENT_RMS_DB for ch in range(channels))


def frame_power(body: bytes, channels: int, bins: int) -> list[float]:
    """Channel-summed squared magnitudes.

    The transform block is two consecutive halves (reals then imaginaries, not interleaved) — protocol.md §7.
    """
    power = [0.0] * bins
    stride = 16 + 8 * bins
    for ch in range(channels):
        vals = struct.unpack_from(f"<{2 * bins}f", body, ch * stride + 16)
        for k in range(bins):
            power[k] += vals[k] ** 2 + vals[bins + k] ** 2
    return power


def band_levels(power: list[float], bandwidth: float) -> Bands:
    """One frame's low, mid and high levels in dB, split at ``BAND_EDGES_HZ`` and running to ``bandwidth``.

    Bin ``i`` sits at ``i * bandwidth / (bins - 1)``, the geometry the frame header declares.
    """
    bins = len(power)
    per_bin = bandwidth / (bins - 1)
    low_top = min(bins - 1, round(BAND_EDGES_HZ[0] / per_bin))
    mid_top = min(bins - 1, round(BAND_EDGES_HZ[1] / per_bin))
    return (
        _band_db(sum(power[: low_top + 1])),
        _band_db(sum(power[low_top + 1 : mid_top + 1])),
        _band_db(sum(power[mid_top + 1 :])),
    )


def _band_db(power: float) -> float:
    """One band's summed power in dB, floored where the band carries nothing."""
    if power <= 0:
        return BAND_FLOOR_DB
    return max(BAND_FLOOR_DB, 10 * math.log10(power))


class BandRing:
    """The last window of band triples, averaged on demand.

    A read neither drains nor resets it: ``/api/status`` has readers besides the page's poll, and a window emptied by
    the first reader would take the reading away from the traffic that fills it. The window is counted in the frame
    time the frames themselves declare.
    """

    def __init__(self, window: float = BAND_WINDOW_SECONDS) -> None:
        """Hold triples covering at most ``window`` seconds of frame time."""
        self._window = window
        self._entries: deque[tuple[float, Bands]] = deque()
        self._covered = 0.0

    def add(self, levels: Bands, covered: float) -> None:
        """Take one frame's triple and the frame time it covers, dropping whatever has aged past the window."""
        self._entries.append((covered, levels))
        self._covered += covered
        while len(self._entries) > 1 and self._covered - self._entries[0][0] >= self._window:
            self._covered -= self._entries.popleft()[0]

    def mean(self) -> Bands | None:
        """Return the mean of the triples in hand, or None while there are none."""
        if not self._entries:
            return None
        count = len(self._entries)
        return (
            sum(entry[1][0] for entry in self._entries) / count,
            sum(entry[1][1] for entry in self._entries) / count,
            sum(entry[1][2] for entry in self._entries) / count,
        )


class BandReadout:
    """The reader's band state: a ring, and the clock that says whether what is in it is still current.

    A stream that stops arriving without the engine leaving the playing state leaves the ring standing, so the reading
    ages here rather than at the seam that never fires.
    """

    def __init__(self, monotonic: Callable[[], float]) -> None:
        """Read staleness off ``monotonic``; the ring starts empty."""
        self._monotonic = monotonic
        self._ring = BandRing()
        self._at: float | None = None

    def add(self, levels: Bands, covered: float) -> None:
        """Take one frame's triple and stamp the ring as current."""
        self._ring.add(levels, covered)
        self._at = self._monotonic()

    def clear(self) -> None:
        """Drop the ring, so the bars park rather than hold the last thing that played."""
        self._ring = BandRing()
        self._at = None

    def read(self) -> Bands | None:
        """Return the mean of the window, or None while the ring is empty or stale."""
        if self._at is None or self._monotonic() - self._at > BAND_WINDOW_SECONDS:
            return None
        return self._ring.mean()
