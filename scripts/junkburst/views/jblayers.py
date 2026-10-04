"""Four layer readings per steady labelled burst at every image fold, collapsed per fold family and graded per family.

Every reading is taken on the burst's summed dB frames, at each of 22.05, 24, 44.1 and 48 kHz that lies on the burst's
grid and below its container's Nyquist:

- ``mirror_frame``: the p90 over frames of the frame correlation across the fold, over its 6 kHz span.
- ``above_level``: the p90 over gated frames of the mean level over 300 Hz to 6 kHz above the fold.
- ``above_ratio``: the p90 over gated frames of that band's mean less the frame's mean over the 3 kHz band ending 4 kHz
  under the fold. A frame is gated in when that under-fold mean sits at or above -105 dB.
- ``shelf_slope``: the least-squares slope in dB per kHz of the 9-bin-smoothed per-bin median curve from 500 Hz above
  the fold to 500 Hz under twice the fold, and ``shelf_span`` its max minus min over the same band.

A reading whose band leaves the grid is not read. Within a family ``mirror_frame`` comes from the larger fold the burst
carries and the rest from the lower. A 192 kHz burst also carries ``wall_2x_hz`` in the 2x family: the boundary of the
largest fall from one 1 kHz band to the 1 kHz band above it, swept from 44 to 60 kHz in 250 Hz steps on the same
smoothed median curve, with that fall in dB beside it as ``wall_2x_fall_db``. Each track reports the max and the median
over its bursts per reading.

Each 1x track also takes a layered verdict, the first layer that fires deciding it: layer 1 calls fake when its
``mirror_frame`` max reaches a cut M, layer 2 calls real when its ``above_ratio`` max reaches a cut R, layer 3 calls
fake when any of its bursts engages under the running rule of ``jbrunning.py`` at a 0.5 s warm-up and an 8 dB/kHz named
cut, at any step cut and unnamed cut that rule sweeps, and a track no layer decides is called real. M is swept over
0.1, 0.2, 0.3 and 0.4, and R over -20, -15, -10 and -5 dB.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path

import numpy as np
from jbcurves import Grid, band_bins, median_smooth
from jbderived import load_burst, summed_db
from jbframeonlyscore import steady_bursts
from jbimages import fold_frame_corr
from jblabels import load_tracks, normalize
from jbrunning import score_corpus as running_corpus

#: Where the report is written, and the command that writes it.
REPORT = Path(__file__).resolve().parents[3] / ".junkburst-report-layers.md"
RUN_CMD = (
    "PYTHONPATH=scripts/junkburst:scripts/junkburst/features:scripts/junkburst/views "
    ".venv/bin/python scripts/junkburst/views/jblayers.py"
)

#: The fold families, each with its folds in ascending order.
FAMILIES: dict[str, tuple[float, ...]] = {"1x": (22_050.0, 24_000.0), "2x": (44_100.0, 48_000.0)}

#: Per family: album key sets, each an AND of normalized substrings, and the grade a matching burst takes. A burst
#: matching none takes the family's fallback grade, where ``None`` is the owner's own label.
DARK_SIDE = ("dark side of the moon",)
GRADE_KEYS: dict[str, tuple[tuple[tuple[str, ...], str], ...]] = {
    "1x": (
        (("lateralus",), "REAL"),
        (("amnesty",), "REAL"),
        (("one beat",), "FAKE"),
        (("awaken", "my love"), "FAKE"),
        (DARK_SIDE, "REAL"),
    ),
    "2x": ((DARK_SIDE, "FAKE"),),
}
FALLBACK_GRADE: dict[str, str | None] = {"1x": None, "2x": "REAL"}
#: The families a track enters only when it carries at least one reading there.
READ_ONLY_FAMILIES = ("2x",)

READINGS = ("mirror_frame", "above_level", "above_ratio", "shelf_slope", "shelf_span")
MIRROR_READINGS = ("mirror_frame",)
WALL_READINGS = ("wall_2x_hz", "wall_2x_fall_db")
#: Every reading each family reports, and the ones reported beside another rather than cut and ranked on their own.
FAMILY_READINGS: dict[str, tuple[str, ...]] = {"1x": READINGS, "2x": (*READINGS, *WALL_READINGS)}
BESIDE_READINGS = ("wall_2x_fall_db",)

#: The percentile the per-frame readings are reduced by.
FRAME_PCT = 90.0

#: ``above_level``: the band above the fold.
ABOVE_LO_HZ = 300.0
ABOVE_HI_HZ = 6_000.0
#: ``above_ratio``: the reference band under the fold, given by how far under the fold it ends and its width.
UNDER_GAP_HZ = 4_000.0
UNDER_SPAN_HZ = 3_000.0
#: The level a frame's mean over the reference band must reach for either above reading to read that frame.
UNDER_GATE_DB = -105.0

#: ``shelf_slope``: the median curve's smoothing, and how far inside the fold and twice the fold the band stops.
SHELF_SMOOTH_BINS = 9
SHELF_GUARD_HZ = 500.0

#: ``wall_2x_hz``: the container rate it is read at, the swept band boundaries, and each band's width.
WALL_RATE_HZ = 192_000.0
WALL_SWEEP_HZ = tuple(44_000.0 + 250.0 * i for i in range(65))
WALL_BAND_HZ = 1_000.0

#: The layered verdict: the family it reads, the swept layer 1 and layer 2 cuts, and layer 3's running-rule point.
VERDICT_FAMILY = "1x"
MIRROR_CUTS = (0.1, 0.2, 0.3, 0.4)
RATIO_CUTS_DB = (-20.0, -15.0, -10.0, -5.0)
ENGAGE_WARMUP_S = 0.5
ENGAGE_NAMED_CUT = 8.0
#: The deciding layers in the order they are tried, the last deciding every track the others leave.
LAYERS = ("1", "2", "3", "else")

#: How many tracks each side the nearest-the-line lists name.
NEAREST_COUNT = 3
#: Fewest distinct track values a cut can be placed between.
MIN_CUT_VALUES = 2


def _p90(values: np.ndarray | None) -> float:
    """Return the p90 of the finite values, NaN where there are none or no reading."""
    if values is None:
        return float("nan")
    finite = values[np.isfinite(values)]
    return float(np.percentile(finite, FRAME_PCT)) if finite.size else float("nan")


def _band_mean(frames: np.ndarray, grid: Grid, lo_hz: float, hi_hz: float) -> np.ndarray | None:
    """Per frame: the mean dB level over one band, or ``None`` when the band is off the grid."""
    span = band_bins(grid, lo_hz, hi_hz)
    if span is None:
        return None
    return np.asarray(frames[:, span[0] : span[1] + 1].mean(axis=1), dtype=np.float64)


def above_readings(frames: np.ndarray, grid: Grid, fold_hz: float) -> tuple[float, float]:
    """Return ``above_level`` and ``above_ratio`` at one fold, both over the frames the reference band gates in."""
    above = _band_mean(frames, grid, fold_hz + ABOVE_LO_HZ, fold_hz + ABOVE_HI_HZ)
    under_hi = fold_hz - UNDER_GAP_HZ
    under = _band_mean(frames, grid, under_hi - UNDER_SPAN_HZ, under_hi)
    if above is None or under is None:
        return float("nan"), float("nan")
    kept = under >= UNDER_GATE_DB
    return _p90(above[kept]), _p90((above - under)[kept])


def shelf_readings(curve: np.ndarray, grid: Grid, fold_hz: float) -> tuple[float, float]:
    """Return ``shelf_slope`` in dB per kHz and ``shelf_span`` in dB off the smoothed median curve at one fold."""
    span = band_bins(grid, fold_hz + SHELF_GUARD_HZ, 2.0 * fold_hz - SHELF_GUARD_HZ)
    if span is None or span[1] <= span[0]:
        return float("nan"), float("nan")
    idx = np.arange(span[0], span[1] + 1)
    band = curve[idx]
    slope = float(np.polyfit(grid.hz_of(idx) / 1_000.0, band, 1)[0])
    return slope, float(band.max() - band.min())


def fold_readings(frames: np.ndarray, curve: np.ndarray, grid: Grid, fold_hz: float) -> dict[str, float]:
    """Return every reading at one fold."""
    level, ratio = above_readings(frames, grid, fold_hz)
    slope, span = shelf_readings(curve, grid, fold_hz)
    return {
        "mirror_frame": _p90(fold_frame_corr(frames, grid, fold_hz)),
        "above_level": level,
        "above_ratio": ratio,
        "shelf_slope": slope,
        "shelf_span": span,
    }


def wall_2x(curve: np.ndarray, grid: Grid) -> dict[str, float]:
    """Return ``wall_2x_hz`` and ``wall_2x_fall_db``: the swept boundary with the largest band-to-band fall, and it."""
    best_hz, best_fall = float("nan"), float("-inf")
    rows = curve[None, :]
    for hz in WALL_SWEEP_HZ:
        lower = _band_mean(rows, grid, hz - WALL_BAND_HZ, hz)
        upper = _band_mean(rows, grid, hz, hz + WALL_BAND_HZ)
        if lower is None or upper is None:
            continue
        fall = float(lower[0] - upper[0])
        if fall > best_fall:
            best_hz, best_fall = hz, fall
    return {"wall_2x_hz": best_hz, "wall_2x_fall_db": best_fall if np.isfinite(best_fall) else float("nan")}


@dataclass(frozen=True)
class BurstReadings:
    """One burst's readings at every fold it carries, and its 2x wall where its container is 192 kHz."""

    by_fold: dict[float, dict[str, float]]
    wall: dict[str, float]


def burst_readings(stamp: str) -> BurstReadings:
    """Read one burst once: its readings at every fold on its grid and below its container's Nyquist, and its wall."""
    meta, db = load_burst(stamp)
    grid = Grid(int(meta["bins"]), float(meta["bandwidth"]))
    frames = summed_db(db)[:, : grid.kept]
    del db
    rate = float(meta["samplerate"])
    folds = [f for family in FAMILIES.values() for f in family if f < rate / 2.0 and f <= grid.hz(grid.kept - 1)]
    no_wall = dict.fromkeys(WALL_READINGS, float("nan"))
    if not folds:
        return BurstReadings({}, no_wall)
    curve = median_smooth(np.median(frames, axis=0)[None, :], SHELF_SMOOTH_BINS)[0]
    wall = wall_2x(curve, grid) if rate == WALL_RATE_HZ else no_wall
    return BurstReadings({f: fold_readings(frames, curve, grid, f) for f in folds}, wall)


def family_readings(burst: BurstReadings, family: str) -> dict[str, float] | None:
    """Collapse one burst's folds within a family: mirror readings off the larger fold, the rest off the lower."""
    carried = [f for f in FAMILIES[family] if f in burst.by_fold]
    if not carried:
        return None
    out = {r: burst.by_fold[max(carried) if r in MIRROR_READINGS else min(carried)][r] for r in READINGS}
    return out | {r: burst.wall[r] for r in FAMILY_READINGS[family] if r in WALL_READINGS}


def grade_of(album: str, owner: str, family: str) -> str:
    """Return a burst's grade in one family: its album's override where one matches, else the family's fallback."""
    norm = normalize(album)
    for keys, grade in GRADE_KEYS[family]:
        if all(k in norm for k in keys):
            return grade
    fallback = FALLBACK_GRADE[family]
    return owner if fallback is None else fallback


@dataclass(frozen=True)
class TrackRow:
    """One track in one family: its grade, its burst count, and the max and median per reading over its bursts."""

    track: str
    grade: str
    bursts: int
    maxes: dict[str, float]
    medians: dict[str, float]


def _stats(bursts: list[dict[str, float]], names: tuple[str, ...], fn: str) -> dict[str, float]:
    """Per reading: the max or median of the bursts' finite values, NaN where there are none."""
    out = {}
    for r in names:
        finite = [b[r] for b in bursts if np.isfinite(b[r])]
        out[r] = float("nan") if not finite else float(max(finite) if fn == "max" else np.median(finite))
    return out


def track_rows(per_burst: list[tuple[str, str, dict[str, float]]], family: str) -> list[TrackRow]:
    """Group one family's (track, grade, readings) bursts by track, real before fake, then by track name."""
    grouped: dict[tuple[str, str], list[dict[str, float]]] = {}
    for track, grade, readings in per_burst:
        grouped.setdefault((track, grade), []).append(readings)
    names = FAMILY_READINGS[family]
    rows = [
        TrackRow(track, grade, len(bursts), _stats(bursts, names, "max"), _stats(bursts, names, "median"))
        for (track, grade), bursts in grouped.items()
    ]
    if family in READ_ONLY_FAMILIES:
        rows = [row for row in rows if any(np.isfinite(v) for v in row.maxes.values())]
    return sorted(rows, key=lambda row: (row.grade != "REAL", row.track))


def score_corpus() -> dict[str, list[TrackRow]]:
    """Read every steady labelled burst once and return each family's per-track rows."""
    bursts = steady_bursts()
    tracks = load_tracks()
    per_family: dict[str, list[tuple[str, str, dict[str, float]]]] = {family: [] for family in FAMILIES}
    for n, entry in enumerate(bursts, 1):
        burst = burst_readings(entry["stamp"])
        album = tracks.get(entry["stamp"], {}).get("album", "")
        for family, rows in per_family.items():
            readings = family_readings(burst, family)
            if readings is not None:
                rows.append((entry["track"], grade_of(album, entry["label"], family), readings))
        if n % 50 == 0 or n == len(bursts):
            print(f"scored {n}/{len(bursts)}", flush=True)
    return {family: track_rows(rows, family) for family, rows in per_family.items()}


@dataclass(frozen=True)
class Cut:
    """One cut on one column: its value, the side fake is called on, and its wrong-side counts."""

    value: float
    fake_above: bool
    real_called_fake: int
    fake_called_real: int


def best_cut(real: list[float], fake: list[float]) -> Cut | None:
    """Return the cut midway between adjacent track values with the fewest wrong-side tracks, either orientation.

    Ties go to the lower cut, fake-above first. No cut exists without a finite value on both sides.
    """
    values = sorted(set(real + fake))
    if not real or not fake or len(values) < MIN_CUT_VALUES:
        return None
    best: Cut | None = None
    for lo, hi in pairwise(values):
        mid = (lo + hi) / 2.0
        for fake_above in (True, False):
            rcf = sum(1 for v in real if (v > mid) == fake_above)
            fcr = sum(1 for v in fake if (v > mid) != fake_above)
            if best is None or rcf + fcr < best.real_called_fake + best.fake_called_real:
                best = Cut(mid, fake_above, rcf, fcr)
    return best


def _cell(value: float) -> str:
    """One table cell, or ``none`` where there is no reading."""
    return f"{value:.2f}" if np.isfinite(value) else "none"


def _column(rows: list[TrackRow], reading: str, column: str, grade: str) -> list[float]:
    """Return the finite values of one reading's max or median column over one grade's tracks."""
    source = [row.maxes if column == "max" else row.medians for row in rows if row.grade == grade]
    return [values[reading] for values in source if np.isfinite(values[reading])]


def track_table(rows: list[TrackRow], names: tuple[str, ...]) -> list[str]:
    """One family's per-track table, real tracks first."""
    head = " | ".join(f"{r} max | {r} median" for r in names)
    out = [f"| track | grade | bursts | {head} |", "| --- | --- | ---: |" + " ---: |" * (2 * len(names))]
    for row in rows:
        cells = " | ".join(f"{_cell(row.maxes[r])} | {_cell(row.medians[r])}" for r in names)
        out.append(f"| {row.track} | {row.grade} | {row.bursts} | {cells} |")
    return out


def _named(rows: list[TrackRow], reading: str, grade: str, *, descending: bool) -> str:
    """Name the tracks of one grade nearest the other side on one reading's max column, with their values."""
    carried = [row for row in rows if row.grade == grade and np.isfinite(row.maxes[reading])]
    carried.sort(key=lambda row: row.maxes[reading], reverse=descending)
    return ", ".join(f"{row.track} ({_cell(row.maxes[reading])})" for row in carried[:NEAREST_COUNT]) or "none"


def nearest_lines(rows: list[TrackRow], names: tuple[str, ...]) -> list[str]:
    """Per reading: the real and fake tracks nearest the other side by the max column, sides set by its best cut."""
    out = []
    for reading in names:
        cut = best_cut(_column(rows, reading, "max", "REAL"), _column(rows, reading, "max", "FAKE"))
        if cut is None:
            out.append(f"- `{reading}`: no cut, no side to be near")
            continue
        side = "above" if cut.fake_above else "below"
        real = _named(rows, reading, "REAL", descending=cut.fake_above)
        fake = _named(rows, reading, "FAKE", descending=not cut.fake_above)
        out.append(f"- `{reading}` (fake side {side}): real {real}; fake {fake}")
    return out


def cut_table(rows: list[TrackRow], names: tuple[str, ...]) -> list[str]:
    """Per reading and column: the cut with the fewest wrong-side tracks and its two wrong-side counts."""
    out = [
        "| reading | column | cut | fake side | wrong-side tracks | real called fake | fake called real |",
        "| --- | --- | ---: | --- | ---: | ---: | ---: |",
    ]
    for reading in names:
        for column in ("max", "median"):
            cut = best_cut(_column(rows, reading, column, "REAL"), _column(rows, reading, column, "FAKE"))
            if cut is None:
                out.append(f"| {reading} | {column} | none | none | none | none | none |")
                continue
            side = "above" if cut.fake_above else "below"
            counts = f"{cut.real_called_fake + cut.fake_called_real} | {cut.real_called_fake} | {cut.fake_called_real}"
            out.append(f"| {reading} | {column} | {cut.value:.3f} | {side} | {counts} |")
    return out


def engaged_tracks() -> set[str]:
    """Return the tracks with a burst engaged under the running rule at layer 3's warm-up and named cut, any others."""
    engaged = set()
    for outcome in running_corpus().outcomes:
        _step_cut, warmup_s, named_cut, _unnamed_cut = outcome.point
        if outcome.status == "engaged" and warmup_s == ENGAGE_WARMUP_S and named_cut == ENGAGE_NAMED_CUT:
            engaged.add(outcome.track)
    return engaged


@dataclass(frozen=True)
class Verdict:
    """One track's layered call, its grade, and the layer that decided it."""

    track: str
    grade: str
    call: str
    layer: str


def verdict(row: TrackRow, *, engaged: bool, mirror_cut: float, ratio_cut: float) -> Verdict:
    """Return one track's call from the first layer that fires; a missing reading fires no layer."""
    if row.maxes["mirror_frame"] >= mirror_cut:
        return Verdict(row.track, row.grade, "FAKE", "1")
    if row.maxes["above_ratio"] >= ratio_cut:
        return Verdict(row.track, row.grade, "REAL", "2")
    if engaged:
        return Verdict(row.track, row.grade, "FAKE", "3")
    return Verdict(row.track, row.grade, "REAL", "else")


@dataclass(frozen=True)
class SweepRow:
    """Every track's layered verdict at one layer 1 and layer 2 cut pair."""

    mirror_cut: float
    ratio_cut: float
    verdicts: tuple[Verdict, ...]

    def wrong(self, grade: str) -> list[Verdict]:
        """Return the tracks of one grade called the other way."""
        return [v for v in self.verdicts if v.grade == grade and v.call != grade]


def layer_sweep(rows: list[TrackRow], engaged: set[str]) -> list[SweepRow]:
    """Return every track's layered verdict at every cut pair, layer 1 cut outermost."""
    return [
        SweepRow(m, r, tuple(verdict(row, engaged=row.track in engaged, mirror_cut=m, ratio_cut=r) for row in rows))
        for m in MIRROR_CUTS
        for r in RATIO_CUTS_DB
    ]


def _pair(row: SweepRow) -> str:
    """Name one cut pair."""
    return f"M {row.mirror_cut:g}, R {row.ratio_cut:g} dB"


def verdict_lines(sweep: list[SweepRow]) -> list[str]:
    """Return the sweep table, every pair's wrong tracks, and the best pair's tracks under each deciding layer."""
    out = ["| M | R (dB) | real called fake | fake called real |", "| ---: | ---: | ---: | ---: |"]
    out += [f"| {s.mirror_cut:g} | {s.ratio_cut:g} | {len(s.wrong('REAL'))} | {len(s.wrong('FAKE'))} |" for s in sweep]
    out += ["", "### Wrong tracks per pair", ""]
    for s in sweep:
        wrong = [f"- {v.track}: {v.grade}, layer {v.layer}" for v in s.verdicts if v.call != v.grade]
        out += [f"#### {_pair(s)}", "", *(wrong or ["- none"]), ""]
    best = min(sweep, key=lambda s: (len(s.wrong("REAL")), len(s.wrong("FAKE"))))
    out += [f"### Best pair, {_pair(best)}: every track by deciding layer", ""]
    for layer in LAYERS:
        decided = [f"- {v.track}: {v.grade}, called {v.call}" for v in best.verdicts if v.layer == layer]
        out += [f"#### Layer {layer}", "", *(decided or ["- none"]), ""]
    return out


def write_report(families: dict[str, list[TrackRow]], sweep: list[SweepRow]) -> None:
    """Write every family's per-track table, nearest-the-line lists and cut table, then the layered verdict."""
    lines = ["# Layer readings per fold family over the labelled corpus", "", f"Produced by `{RUN_CMD}`.", ""]
    for family, rows in families.items():
        folds = " and ".join(f"{f / 1_000.0:g}" for f in FAMILIES[family])
        names = FAMILY_READINGS[family]
        ranked = tuple(r for r in names if r not in BESIDE_READINGS)
        real = sum(1 for row in rows if row.grade == "REAL")
        lines += [f"## {family} folds, {folds} kHz", "", f"{real} real tracks, {len(rows) - real} fake tracks.", ""]
        lines += ["### Per track", "", *track_table(rows, names), ""]
        lines += ["### Nearest the other side, max column", "", *nearest_lines(rows, ranked), ""]
        lines += ["### Cuts", "", *cut_table(rows, ranked), ""]
    lines += [
        f"## Layered verdict, {VERDICT_FAMILY} folds",
        "",
        (
            "Layer 1 calls fake at a `mirror_frame` max at or above M. Layer 2 calls real at an `above_ratio` max at "
            "or above R. Layer 3 calls fake when any burst engages under `jbrunning.py` at warm-up "
            f"{ENGAGE_WARMUP_S:g} s and named cut {ENGAGE_NAMED_CUT:g} dB/kHz, at any step cut and unnamed cut it "
            "sweeps. Else real."
        ),
        "",
        *verdict_lines(sweep),
    ]
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {REPORT}")


def main() -> None:
    """Score the corpus, resolve the running rule, and write the report."""
    families = score_corpus()
    write_report(families, layer_sweep(families[VERDICT_FAMILY], engaged_tracks()))


if __name__ == "__main__":
    main()
