"""Junk-filter advice from the metering stream's spectral aggregate.

Pure functions over a time-averaged power spectrum (``metering.py`` supplies
it): detect the HF signatures the manual's junk-filter table addresses and name
the filter that treats them. Advice only — nothing here writes to the engine;
the caller surfaces the text and the user decides.

Signatures (manual p.53, "Playback filter"):
- brick wall well below the container's Nyquist in a hi-res container →
  ``20k`` (sharp cut; the manual's "fake high-res content" case)
- persistent narrow spurs above the music's natural decay → ``30k`` / ``40k``
  (slow roll-off above the corner). The manual's example cause is analog-tape
  transfers, but clipping harmonics of an authentic hi-res recording look the
  same to this rule (field report: an authentic 96k recording with clipping
  fired it), so the cause is unknowable from the spectrum. The verdict states
  the observation only and offers the hires filter families as an alternative
  to the corner filter.
- HF noise rising with frequency → ``50k`` (very slow roll-off; the manual's
  "excessive noise shaping" case — some ADCs, DSD-to-PCM conversions)

The brick-wall and ramp rules read the track's mean spectrum — both are
broadband shapes that only firm up under a long average. The spur rule instead
reads a windowed per-bin *minimum* spectrum (the caller supplies it): a bias
tone is present in every frame, so it survives the minimum, while music energy
at the same frequency is intermittent and any quiet moment inside the window
drops its bin to the hiss floor. The mean spectrum can never separate the two —
loud broadband music raises the spur's local baseline until the tone
disappears into it (observed live: a persistent 30.3 kHz tone 15 dB proud
during a quiet intro fell to 6 dB of excess once the music started).

The rate-relative filters (2x/4x/8x) are deliberately never recommended.

Thresholds are conservative on purpose: only unambiguous signatures earn a
recommendation, and every threshold is a module constant so tuning against real
captures stays a one-line change.
"""

import statistics
from typing import Any

# Minimum accumulated coverage before any verdict — early in a track the
# average still carries fades and silence.
MIN_SECONDS = 15.0

# Eligibility floor: every signature lives above 24 kHz, so a container that
# carries nothing up there has nothing for these rules to read.
MIN_RATE_HZ = 48_000
MIN_BANDWIDTH_HZ = 24_000.0

SMOOTH_BINS = 9  # median-filter width for the working curve (odd)
FLOOR_PERCENTILE = 10  # the aggregate's noise floor: a low percentile, not min

# Brick wall: a >= BRICK_DROP_DB fall within +/- BRICK_SPAN_HZ of a candidate
# edge inside BRICK_WINDOW_HZ, with everything above staying near the floor.
BRICK_WINDOW_HZ = (18_000.0, 26_000.0)
BRICK_DROP_DB = 30.0
BRICK_SPAN_HZ = 1_500.0
ABOVE_FLOOR_DB = 8.0  # "near the floor" allowance above the cliff
FAKE_HIRES_MIN_RATE = 88_200

# Spurs: narrow smoothed curve exceeding a wide smoothed baseline.
SPUR_MIN_HZ = 25_000.0
SPUR_DB = 15.0
SPUR_BASELINE_BINS = 51
SPUR_CORNER_SPLIT_HZ = 45_000.0  # spur above this → 40k corner still clears it

# Filter families a spur verdict offers as an alternative to the corner filter
# (manual p.34/p.32: "for HiRes content", "also suitable for playback of lossy
# compression"). Name prefixes — each family ships -lp/-ip/-mp phase variants.
SPUR_FAMILIES = ("poly-sinc-gauss-hires", "poly-sinc-ext2-hires")

# Noise-shaping ramp: rise from the lower HF region to the top of the band.
RAMP_LO_HZ = 25_000.0
RAMP_RISE_DB = 10.0
RAMP_ABOVE_FLOOR_DB = 20.0  # a real ramp carries energy, not floor wobble


# Wide by necessity: every argument is an independent measurement or engine fact
# the verdict reads, five of the eight are already keyword-only, and a parameter
# object would rename them rather than reduce them.
def classify(  # noqa: PLR0913
    levels_db: list[float],
    bandwidth: float,
    seconds: float,
    *,
    samplerate: int | None,
    sdm: bool,
    junk_filter: str | None,
    min_levels_db: list[float] | None = None,
    filter_name: str | None = None,
) -> dict[str, Any] | None:
    """The recommendation for this aggregate, or None when there is nothing to say.

    ``levels_db`` is the mean power spectrum (dB, one value per bin up to ``bandwidth`` = the source Nyquist);
    ``min_levels_db`` is the windowed per-bin minimum spectrum the spur rule reads, or None while the window has not yet
    been earned (no spur verdicts until it has); ``junk_filter`` is the engine's current junk-filter *name* and
    ``filter_name`` the active main filter's. The verdict is spectrum-only — the metering tap sees the source, so
    engaging a filter never changes what the detector sees — and the advice stands until the engaged settings actually
    treat the signature.
    """
    if not _eligible(seconds, samplerate, bandwidth, len(levels_db), sdm=sdm):
        return None
    smoothed = _median_smooth(levels_db, SMOOTH_BINS)
    floor = _percentile(smoothed, FLOOR_PERCENTILE)
    verdict = (
        _brick_wall(smoothed, bandwidth, floor, samplerate or 0)
        or _spurs(min_levels_db, bandwidth)
        or _ramp(smoothed, bandwidth, floor)
    )
    if verdict is None or treats(verdict, junk_filter, filter_name):
        return None
    return verdict


def _eligible(seconds: float, samplerate: int | None, bandwidth: float, bins: int, *, sdm: bool) -> bool:
    if seconds < MIN_SECONDS or bins < SPUR_BASELINE_BINS:
        return False
    return not (sdm or samplerate is None or samplerate <= MIN_RATE_HZ or bandwidth <= MIN_BANDWIDTH_HZ)


# Fixed-corner filters by corner frequency. A corner at or below the
# recommended one also removes the junk (it cuts everything the recommended
# corner would), so it counts as treatment.
_CORNER_KHZ = {"20k": 20, "30k": 30, "40k": 40, "50k": 50}


def treated(junk_filter: str | None, recommended: str) -> bool:
    """Whether the engaged junk filter already treats the detected signature.

    ``none`` (or nothing engaged) never does; a fixed corner treats when it is at or below the recommended corner; a
    rate-relative filter (2x/4x/8x) is a deliberate manual choice and is never second-guessed.
    """
    if junk_filter in (None, "none"):
        return False
    engaged = _CORNER_KHZ.get(junk_filter)
    if engaged is None:
        return True  # rate-relative or unknown — the user chose it, don't nag
    return engaged <= _CORNER_KHZ[recommended]


def treats(verdict: dict[str, Any], junk_filter: str | None, filter_name: str | None) -> bool:
    """Whether the engine's current settings already treat the verdict's signature.

    Treatment is either the engaged junk filter (corner logic above), or — for verdicts that offer filter families — an
    active main filter from one of them.
    """
    if treated(junk_filter, str(verdict["filter"])):
        return True
    families: list[str] = verdict.get("families") or []
    return filter_name is not None and any(filter_name.startswith(f) for f in families)


def _median_smooth(levels: list[float], width: int) -> list[float]:
    half = width // 2
    n = len(levels)
    return [statistics.median(levels[max(0, i - half) : min(n, i + half + 1)]) for i in range(n)]


def _percentile(levels: list[float], pct: int) -> float:
    ordered = sorted(levels)
    return ordered[min(len(ordered) - 1, (len(ordered) * pct) // 100)]


def _hz(i: int, bins: int, bandwidth: float) -> float:
    return i * bandwidth / (bins - 1)


def _bin(hz: float, bins: int, bandwidth: float) -> int:
    return min(bins - 1, max(0, round(hz * (bins - 1) / bandwidth)))


def _band_mean(levels: list[float], lo: int, hi: int) -> float:
    band = levels[lo : hi + 1]
    return sum(band) / len(band) if band else -200.0


def _brick_wall(smoothed: list[float], bandwidth: float, floor: float, samplerate: int) -> dict[str, Any] | None:
    if samplerate < FAKE_HIRES_MIN_RATE:
        return None
    bins = len(smoothed)
    span = max(1, _bin(BRICK_SPAN_HZ, bins, bandwidth))
    best_drop, edge = 0.0, -1
    for i in range(_bin(BRICK_WINDOW_HZ[0], bins, bandwidth), _bin(BRICK_WINDOW_HZ[1], bins, bandwidth) + 1):
        drop = smoothed[max(0, i - span)] - smoothed[min(bins - 1, i + span)]
        if drop > best_drop:
            best_drop, edge = drop, i
    if best_drop < BRICK_DROP_DB or edge < 0:
        return None
    above = _band_mean(smoothed, min(bins - 1, edge + 2 * span), bins - 1)
    if above > floor + ABOVE_FLOOR_DB:
        return None  # real content (or junk another rule owns) lives above the edge
    ceiling = _hz(edge, bins, bandwidth)
    reason = (
        f"Content stops at {ceiling / 1000:.1f} kHz in a {samplerate / 1000:g} kHz container — "
        f"consistent with fake hi-res. Recommend engaging the 20k high-frequency filter."
    )
    return {"filter": "20k", "reason": reason, "ceiling_khz": round(ceiling / 1000, 1)}


def _spurs(min_levels: list[float] | None, bandwidth: float) -> dict[str, Any] | None:
    """The spur verdict for the windowed minimum spectrum, or None when no persistent tone stands out.

    Spurs are hunted in the RAW per-bin values of the windowed minimum spectrum against that spectrum's own wide median
    baseline: a persistent tone is only a few bins wide, which is exactly what the working curve's 9-bin median erases —
    searching a smoothed curve can never find one. The minimum spectrum's baseline and floor are its own, not the
    mean's: the minimum sits far below the mean wherever music is intermittent, which is the very contrast this rule
    exploits.
    """
    if min_levels is None or len(min_levels) < SPUR_BASELINE_BINS:
        return None
    bins = len(min_levels)
    baseline = _median_smooth(min_levels, SPUR_BASELINE_BINS)
    floor = _percentile(_median_smooth(min_levels, SMOOTH_BINS), FLOOR_PERCENTILE)
    spur_hz, spur_db = 0.0, 0.0
    for i in range(_bin(SPUR_MIN_HZ, bins, bandwidth), bins):
        excess = min_levels[i] - baseline[i]
        if excess >= SPUR_DB and min_levels[i] > floor + ABOVE_FLOOR_DB and excess > spur_db:
            spur_hz, spur_db = _hz(i, bins, bandwidth), excess
    if spur_hz == 0.0:
        return None
    corner = "40k" if spur_hz > SPUR_CORNER_SPLIT_HZ else "30k"
    reason = (
        f"Persistent tone at {spur_hz / 1000:.1f} kHz — "
        f"recommend switching to a 'hires' resampling filter or engaging the {corner} high-frequency filter."
    )
    return {
        "filter": corner,
        "families": list(SPUR_FAMILIES),
        "reason": reason,
        "ceiling_khz": round(spur_hz / 1000, 1),
    }


def _ramp(smoothed: list[float], bandwidth: float, floor: float) -> dict[str, Any] | None:
    bins = len(smoothed)
    lo = _bin(RAMP_LO_HZ, bins, bandwidth)
    top_lo = _bin(0.85 * bandwidth, bins, bandwidth)
    top = _band_mean(smoothed, top_lo, bins - 1)
    rise = top - _band_mean(smoothed, lo, min(top_lo - 1, lo + (top_lo - lo) // 4))
    if rise < RAMP_RISE_DB or top < floor + RAMP_ABOVE_FLOOR_DB:
        return None
    reason = (
        f"HF noise rising toward {bandwidth / 1000:.0f} kHz — consistent with excessive noise shaping "
        f"(some ADCs, DSD-to-PCM transfers). Recommend engaging the 50k high-frequency filter."
    )
    return {"filter": "50k", "reason": reason, "ceiling_khz": round(bandwidth / 1000, 1)}
