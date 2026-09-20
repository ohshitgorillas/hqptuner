"""Junk-filter advice from the metering stream's spectral aggregate.

Functions over the windowed per-bin minimum power spectrum (``metering.py``
supplies it): detect the HF signatures the manual's junk-filter table addresses
and name the filter that treats them. Nothing here writes to the engine or reads
its state — ``classify`` detects, ``treats`` says whether an engaged filter covers
what was detected, and the caller decides what to do with the pair.

Signatures (manual p.53, "Playback filter"):
- junk standing above an image fold in a hi-res container → ``20k`` (sharp cut;
  the manual's "fake high-res content" case), read per closed block: the band
  above the fold at or above ``LEVEL_LINE_DB``, a loud-frame step over
  ``STEP_CUT_DB``, and the ratio to the music under ``RATIO_VETO_DB`` or a step
  reaching ``STEP_YIELD_DB``. A block whose band above the fold sits under the
  level line earns nothing: the corner would trade floor for floor.
- persistent narrow spurs above the music's natural decay → ``30k`` / ``40k``
  (slow roll-off above the corner). The manual's example cause is analog-tape
  transfers, but clipping harmonics of an authentic hi-res recording look the
  same to this rule (field report: an authentic 96k recording with clipping
  fired it), so the cause is unknowable from the spectrum. The verdict states the
  observation only and offers the hires families as an alternative to the corner.
- HF noise rising with frequency → ``50k`` (very slow roll-off; the manual's
  "excessive noise shaping" case — some ADCs, DSD-to-PCM conversions)

The spur and the ramp read one curve, the windowed per-bin *minimum* spectrum the
caller supplies. A master's own limit — a shaping ramp, a bias tone — is present
in every frame and survives the minimum; music energy at the same frequency is
intermittent, and any quiet moment in the window drops its bin to the hiss floor.
A mean cannot separate the two: loud music raises the local baseline until the
signature disappears into it (observed live: a 30.3 kHz tone 15 dB proud during a
quiet intro fell to 6 dB of excess once the music started).

The 20k rule reads neither that curve nor any window: it reads the block that
closed most recently, and carries nothing from the block before it. The ramp is a
property of the spectrum in front of it, recomputed on every call and held by
nothing. The spur is not: a tone that has engaged is held per bin until its excess
falls under ``SPUR_RELEASE_DB`` or the bin stops standing clear of the floor, so a
loud passage that lifts the baseline over a tone does not drop the advice and
bring it back. The held set lives in a ``SpurHolder`` the caller owns and discards
with its aggregate; a caller passing none reads the window in front of it alone.
Where several rules fire the lowest corner wins: it treats every signature the
others name. The rate-relative filters (2x/4x/8x) are never recommended. The spur
and ramp thresholds are read off the junkcal capture corpus with their readings
recorded beside them; the 20k rule's four are read off the burst corpus under
``/srv/hqptuner/state/junkburst/`` (docs/junk-filter-autopilot-resource-20k.md §2).
"""

import math
import statistics
from typing import Any

from hqptuner.engine import blockstats

# Eligibility floor: every signature lives above 24 kHz, so a container carrying
# nothing up there has nothing for these rules to read.
MIN_RATE_HZ = 48_000
MIN_BANDWIDTH_HZ = 24_000.0

FLOOR_PERCENTILE = 10  # the aggregate's noise floor: a low percentile, not min
#: Level over the row's own floor a bin must reach to carry a ceiling or a spur.
#: The trough of the corpus histogram of (smoothed curve minus floor): floor mode
#: 222097 rows at 1 dB, first local minimum 68205 at 11, content mode 75127 at 15.
CONTRAST_DB = 11.0

#: The level the band above the fold must reach for the corner to have anything to
#: remove: the lowest line that keeps real music in play, and the locked line.
LEVEL_LINE_DB = -125.0
#: Ratio of that band to the 15-18 kHz music band at or above which the block is
#: forced real: real ultrasonic content tracks the music to within about 15 dB.
RATIO_VETO_DB = -15.0
#: The loud-frame step's cut, candidate G90 locked at 11 dB.
STEP_CUT_DB = 11.0
#: The step at which the veto stands down, the top of the flat range.
STEP_YIELD_DB = 14.0

# Spurs: raw per-bin values against the curve's own wide median baseline. A
# persistent tone is a few bins wide, which the 9-bin working curve erases.
SPUR_MIN_HZ = 25_000.0
SPUR_BASELINE_BINS = 51
SPUR_CORNER_SPLIT_HZ = 45_000.0  # spur above this → 40k corner still clears it

#: Excess over the 51-bin baseline above 25 kHz that engages a bin. Two modes in
#: the corpus: 769 rows at 4 dB, a local minimum of 37 at 22, 130 again at 28.
SPUR_SPLIT_DB = 22.0

#: Excess at which a held bin releases. Pooled over the 29 bins that cross the
#: engage split in the corpus's nine spur albums, every row of those albums, 510
#: values in 1 dB bins: nine values at 0 to 8 dB, nothing at 9 or 10, then 31
#: running 11 to 21 and on without a break into the main mode at 22 and above.
#: The minimum at 10 is the only two-sided one below the engage split, separating
#: the nine rows whose spur has gone from the 31 whose excess has only sagged.
#: Thin, and named as thin: one value either side of a two-bin gap, out of 510.
SPUR_RELEASE_DB = 10.0

# Filter families a spur verdict offers instead of the corner filter (manual
# p.34/p.32: "for HiRes content", "also suitable for playback of lossy
# compression"). Prefixes — each family ships -lp/-ip/-mp phase variants.
SPUR_FAMILIES = ("poly-sinc-gauss-hires", "poly-sinc-ext2-hires")

# Noise-shaping ramp: the band above RAMP_LO_HZ rising without turning back, read
# as the rank correlation of its smoothed trend against frequency. Neither a
# slope nor a fit quality: what separates a shaped master from a clean one is
# that the rise never reverses, and DSD-derived material is often flat or
# lowpassed where a slope would have to find its rise.
#: 141 band bottoms from 30 to 100 kHz at 0.5 kHz steps against five readings,
#: 750 combinations: 9 separate the corpus's two groups at all, all of them the
#: trend rank, widest margin at 57.5 kHz. A least-squares fit separates nowhere.
RAMP_LO_HZ = 57_500.0
#: The lowest corpus row expecting 50k reads 0.9676 and the highest expecting
#: nothing reads 0.9586: a 0.0090 margin across 38 rows, the narrowest threshold
#: here, and the first to re-read when the corpus grows.
RAMP_RANK = 0.963
# The 50k corner acts only on a container carrying content past it, so the source
# Nyquist must exceed the corner. 176.4 kHz is the lowest standard PCM rate whose
# Nyquist (88.2 kHz) clears it; 88.2 and 96 kHz sources never do.
RAMP_MIN_RATE = 176_400

#: The top bins every rule drops, plus a full spur baseline in what is left.
MIN_BINS = blockstats.DROP_TOP_BINS + SPUR_BASELINE_BINS


class SpurHolder:
    """The bins a spur verdict is standing on, held from window to window.

    Frequencies rather than bin indices, so a samplerate change re-grids without carrying stale indices in; the bins
    the new grid lacks are dropped. No level, no window count, no track identity: a held bin releases when the rules
    stop seeing it, not at a track boundary.
    """

    def __init__(self) -> None:
        """Start with nothing held: the reader opens owing its verdict to the window in front of it."""
        self.held: set[float] = set()

    def decide(self, visible: dict[float, float]) -> set[float]:
        """Return the held set after one window, ``visible`` being excess by frequency.

        A held bin absent from ``visible`` has stopped standing clear of the floor and releases whatever its excess.
        """
        held = {frequency for frequency in self.held if frequency in visible}
        for frequency, excess in visible.items():
            if excess >= SPUR_SPLIT_DB:
                held.add(frequency)
            elif excess < SPUR_RELEASE_DB:
                held.discard(frequency)
        self.held = held
        return held


# Owner-approved for this site: the block record is a sixth argument beside the window curve, its geometry and the
# held spur set, and none of the five folds into another.
def classify(  # noqa: PLR0913
    min_levels_db: list[float] | None,
    bandwidth: float,
    *,
    samplerate: int | None,
    sdm: bool,
    holder: SpurHolder | None = None,
    block: blockstats.BlockRecord | None = None,
) -> dict[str, Any] | None:
    """Return the signature this spectrum carries, or None when there is nothing to say.

    ``min_levels_db`` is the windowed per-bin minimum spectrum (dB, one value per bin up to ``bandwidth`` = the source
    Nyquist), or None while no frame has been folded at all — the reader has no other readiness gate, so the first
    frame past the decimator already carries a spectrum the rules can read. The verdict is spectrum-only — the
    metering tap sees the source, so engaging a filter never changes what the detector sees — which is why detection
    says nothing about what the engine has engaged. Whether
    the engaged settings already treat the signature is ``treats``, and the caller applies it: the advisor's note goes
    quiet under treatment while auto-pilot needs the untreated signature to know what to engage and what to let go of.
    Where more than one rule fires, the lowest corner is the verdict: it treats every signature the others name.
    ``block`` is the record of the block that closed most recently, which the 20k rule alone reads; None, or a record
    whose band above the fold has no reading, fires no 20k verdict.
    """
    found = verdicts(min_levels_db, bandwidth, samplerate=samplerate, sdm=sdm, holder=holder, block=block)
    return min(found, key=lambda v: _CORNER_KHZ[str(v["filter"])]) if found else None


# Owner-approved for this site: the same six arguments ``classify`` forwards.
def verdicts(  # noqa: PLR0913
    min_levels_db: list[float] | None,
    bandwidth: float,
    *,
    samplerate: int | None,
    sdm: bool,
    holder: SpurHolder | None = None,
    block: blockstats.BlockRecord | None = None,
) -> list[dict[str, Any]]:
    """Return one verdict per rule this spectrum fires, in 20k, spur, ramp order.

    No rule excludes another, so a caller needing what a spectrum supported rather than what it is advised to engage
    reads this; ``classify`` is the lowest corner among them.
    """
    if min_levels_db is None or not eligible(samplerate, bandwidth, len(min_levels_db), sdm=sdm):
        return []
    curve = _Curve(min_levels_db, bandwidth)
    rules = (_junk20k(block, bandwidth, samplerate or 0), _spur(curve, holder), _ramp(curve, samplerate or 0))
    return [verdict for verdict in rules if verdict is not None]


def eligible(samplerate: int | None, bandwidth: float, bins: int, *, sdm: bool) -> bool:
    """Whether a spectrum carries enough bins and HF bandwidth for any rule here to read it."""
    if bins < MIN_BINS:
        return False
    return not (sdm or samplerate is None or samplerate <= MIN_RATE_HZ or bandwidth <= MIN_BANDWIDTH_HZ)


# The engine's name for nothing engaged. Named rather than spelled out at each
# site because auto-pilot's baseline defaults to it and has to mean the same thing
# this module does by it.
NO_FILTER = "none"

# Fixed-corner filters by corner frequency. A corner at or below the recommended
# one also removes the junk, so it counts as treatment.
_CORNER_KHZ = {"20k": 20, "30k": 30, "40k": 40, "50k": 50}


def treated(junk_filter: str | None, recommended: str) -> bool:
    """Whether the engaged junk filter already treats the detected signature.

    ``none`` (or nothing engaged) never does; a fixed corner treats when it is at or below the recommended corner; a
    rate-relative filter (2x/4x/8x) is a manual choice and is never second-guessed.
    """
    if junk_filter in (None, NO_FILTER):
        return False
    engaged = _CORNER_KHZ.get(junk_filter)
    if engaged is None:
        return True  # rate-relative or unknown — the user chose it, don't nag
    return engaged <= _CORNER_KHZ[recommended]


def treats(verdict: dict[str, Any], junk_filter: str | None, filter_name: str | None) -> bool:
    """Whether the engine's current settings already treat the verdict's signature.

    Either the engaged junk filter (corner logic above), or — for verdicts offering families — a main filter from one.
    """
    if treated(junk_filter, str(verdict["filter"])):
        return True
    families: list[str] = verdict.get("families") or []
    return filter_name is not None and any(filter_name.startswith(f) for f in families)


def hz(i: int, bins: int, bandwidth: float) -> float:
    """Centre frequency of bin ``i`` on a grid of ``bins`` bins spanning 0 Hz to ``bandwidth``."""
    return i * bandwidth / (bins - 1)


class _Curve:
    """One spectrum as every rule reads it: the top bins gone, smoothed, and its own floor.

    Frequencies stay on the grid the untruncated spectrum came on, so the drop moves no bin's frequency.
    """

    def __init__(self, min_levels_db: list[float], bandwidth: float) -> None:
        """Take the curve apart once: what the three rules share is computed here and nowhere else."""
        self.bins = len(min_levels_db)
        self.bandwidth = bandwidth
        self.levels = min_levels_db[: self.bins - blockstats.DROP_TOP_BINS]
        self.smoothed = _median_smooth(self.levels, blockstats.SMOOTH_BINS)
        self.baseline = _median_smooth(self.levels, SPUR_BASELINE_BINS)
        self.floor = _percentile(self.smoothed, FLOOR_PERCENTILE)

    def hz(self, i: int) -> float:
        """Return the centre frequency of a kept bin."""
        return hz(i, self.bins, self.bandwidth)

    def at(self, frequency: float) -> int:
        """Return the kept bin nearest a frequency."""
        return min(len(self.levels) - 1, max(0, round(frequency * (self.bins - 1) / self.bandwidth)))

    def above(self, frequency: float) -> int:
        """Return the lowest kept bin at or above a frequency, or one past the last kept bin."""
        return min(len(self.levels), math.ceil(frequency * (self.bins - 1) / self.bandwidth))


def _median_smooth(levels: list[float], width: int) -> list[float]:
    half = width // 2
    n = len(levels)
    return [statistics.median(levels[max(0, i - half) : min(n, i + half + 1)]) for i in range(n)]


def _percentile(levels: list[float], pct: int) -> float:
    ordered = sorted(levels)
    return ordered[min(len(ordered) - 1, (len(ordered) * pct) // 100)]


def _junk20k(record: blockstats.BlockRecord | None, bandwidth: float, samplerate: int) -> dict[str, Any] | None:
    """Return the 20k verdict where one closed block carries junk the corner would remove.

    Three tests over the record: the mask, which drops a block whose band above the fold sits under the level line or
    has no reading at all; the loud-frame step over its cut; and the ratio to the music, which forces the block real
    unless the step reaches the yield.
    """
    if record is None or not (math.isfinite(record.above_db) and record.above_db >= LEVEL_LINE_DB):
        return None
    step, fold = blockstats.loud_frame_step(record, len(record.minimum), bandwidth)
    if not math.isfinite(step) or step < STEP_CUT_DB:
        return None
    vetoed = math.isfinite(record.ratio_db) and record.ratio_db >= RATIO_VETO_DB
    if vetoed and step < STEP_YIELD_DB:
        return None
    reason = (
        f"Junk above {fold / 1000:.1f} kHz in a {samplerate / 1000:g} kHz container, consistent with fake hi-res. "
        f"Recommend engaging the 20k high-frequency filter."
    )
    return {"filter": "20k", "reason": reason, "ceiling_khz": round(fold / 1000, 1)}


def _excesses(curve: _Curve) -> dict[float, float]:
    """Excess over the wide baseline, by frequency, for every visible bin above 25 kHz."""
    limit = curve.floor + CONTRAST_DB
    return {
        curve.hz(i): curve.levels[i] - curve.baseline[i]
        for i in range(curve.at(SPUR_MIN_HZ), len(curve.levels))
        if curve.levels[i] > limit
    }


def _spur_corner(frequency: float) -> str:
    return "40k" if frequency > SPUR_CORNER_SPLIT_HZ else "30k"


def _spur(curve: _Curve, holder: SpurHolder | None) -> dict[str, Any] | None:
    """Return the spur verdict for this window, or None when no bin is held under it.

    Every bin decides on its own excess; the verdict is the lowest corner any held bin implies, named for the held bin
    of that corner standing highest over its baseline right now.
    """
    visible = _excesses(curve)
    held = (holder or SpurHolder()).decide(visible)
    if not held:
        return None
    corner = min((_spur_corner(f) for f in held), key=lambda name: _CORNER_KHZ[name])
    spur_hz = max((f for f in held if _spur_corner(f) == corner), key=lambda f: visible[f])
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


def _ranks(values: list[float]) -> list[float]:
    """Return the rank of every value, ties sharing their midpoint rank."""
    order, ranks, start = sorted(range(len(values)), key=lambda i: values[i]), [0.0] * len(values), 0
    while start < len(order):
        stop = start
        while stop + 1 < len(order) and values[order[stop + 1]] == values[order[start]]:
            stop += 1
        for i in order[start : stop + 1]:
            ranks[i] = (start + stop) / 2.0
        start = stop + 1
    return ranks


def _rank_correlation(values: list[float]) -> float:
    """Spearman correlation of a series against its own rising index, 0.0 where either side is flat."""
    n = len(values)
    xs, ys = [float(i) for i in range(n)], _ranks(values)
    mx, my = sum(xs) / n, sum(ys) / n
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx == 0.0 or dy == 0.0:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True)) / (dx * dy)


def _ramp(curve: _Curve, samplerate: int) -> dict[str, Any] | None:
    """Return the ramp verdict where the working curve above 57.5 kHz rises without turning back.

    The band is smoothed again at the baseline's width to strip the ripple; one narrower than that window carries no
    trend of its own and does not fire.
    """
    if samplerate < RAMP_MIN_RATE:
        return None
    band = curve.smoothed[curve.above(RAMP_LO_HZ) :]
    if len(band) < SPUR_BASELINE_BINS:
        return None
    if _rank_correlation(_median_smooth(band, SPUR_BASELINE_BINS)) < RAMP_RANK:
        return None
    reason = (
        f"HF noise rising toward {curve.bandwidth / 1000:.0f} kHz — consistent with excessive noise shaping "
        f"(some ADCs, DSD-to-PCM transfers). Recommend engaging the 50k high-frequency filter."
    )
    return {"filter": "50k", "reason": reason, "ceiling_khz": round(curve.bandwidth / 1000, 1)}
