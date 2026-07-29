"""Synthesized spectra for the junk-filter suites, and the wire frames built
from them (`fake_metering.frame`, protocol.md §7: bin k sits at
``k * bandwidth / (bins - 1)`` Hz).

Shared by `test_junk_advisor` (the pure `classify` cases) and
`test_junk_persistence` (the windowed-minimum and latch cases), so neither
test file imports from the other."""

from collections.abc import Callable

from fake_metering import frame

BINS = 1025


def spectrum(bandwidth: float, level_at: Callable[[float], float], bins: int = BINS) -> list[float]:
    step = bandwidth / (bins - 1)
    return [level_at(k * step) for k in range(bins)]


def fake_hires_96k() -> list[float]:
    """96 kHz container, strong flat content to ~22 kHz, then a cliff to the floor."""
    return spectrum(48000.0, lambda f: -20.0 if f <= 22000.0 else -140.0)


def genuine_hires_96k() -> list[float]:
    """Smooth gradual decay across the whole band — no cliff, no tones."""
    return spectrum(48000.0, lambda f: -20.0 - 120.0 * f / 48000.0)


def flat_fullband_96k() -> list[float]:
    """Strong flat content across the entire 0-48 kHz band — content clear to
    Nyquist, no cliff, no tone. Mixed into brick-wall evidence it erases the
    cliff from the cumulative mean, so no re-classification can recommend."""
    return spectrum(48000.0, lambda _f: -20.0)


def _decay_176(f: float) -> float:
    # music decaying naturally, reaching the floor by ~20 kHz — no cliff (6 dB/kHz)
    return max(-20.0 - 6.0 * f / 1000.0, -140.0)


def decaying_176() -> list[float]:
    """Ordinary decaying-music mean spectrum in a 176.4 kHz container — no tone."""
    return spectrum(88200.0, _decay_176)


def spur_min_176(tone_hz: float, tone_db: float = -45.0) -> list[float]:
    """Windowed per-bin *minimum* spectrum for a 176.4 kHz container: the natural
    decay plus one persistent narrow tone (a few bins wide) at ``tone_db`` — by
    default 95 dB above the -140 floor it stands in."""
    return spectrum(88200.0, lambda f: tone_db if abs(f - tone_hz) <= 130.0 else _decay_176(f))


def shaping_ramp_176() -> list[float]:
    """Music gone by ~20 kHz, then broadband noise rising smoothly to -60 at Nyquist."""

    def level(f: float) -> float:
        if f <= 20000.0:
            return -20.0 - 90.0 * f / 20000.0
        if f <= 24000.0:
            return -110.0
        return -110.0 + 50.0 * (f - 24000.0) / (88200.0 - 24000.0)

    return spectrum(88200.0, level)


#: 0.7 s of coverage per frame: 60 frames ≈ 42 s, comfortably past the minimum.
FAKE_HIRES_FRAME = frame(fake_hires_96k(), 48000.0, 0.7)
