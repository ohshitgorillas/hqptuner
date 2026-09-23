"""Read-only spur survey: per-track spur candidates read from 20 kHz up, and a draft relabel under the new scheme.

Every labelled burst is read at four cumulative windows from its own start — 1 s, 2 s, 3 s and the full burst — each
folded to a per-bin minimum and read through ``junkadvisor``'s own spur curve, but from 20 kHz up rather than
``SPUR_MIN_HZ``. A bin at or over 16 dB excess on the full window is a candidate; its partner is a bin within 3 dB of
it at 44100 or 48000 minus its frequency, the mirror an image or an alias would leave. A candidate with no partner on
a majority of the track's bursts writes that track's draft label to the spur band from
``docs/junk-filter-autopilot-resource-20k.md`` section 1, except a ``FAKE`` row, which is flagged ``FAKE?`` for the
owner instead of overwritten.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from jbconfig import BY_TRACK, DER, LABELS_TSV
from jbderived import load_burst, summed_db
from jblabels import (
    ALBUM_ROW_COLUMNS,
    TRACK_ROW_COLUMNS,
    collapse_overlaps,
    load_labels,
    load_tracks,
    owner_label,
    primary_artist,
)

from hqptuner.engine import junkadvisor
from hqptuner.engine.junkadvisor import _Curve

if TYPE_CHECKING:
    from collections.abc import Callable

    import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
DRAFT_TSV = ROOT / ".junkburst-labels-draft.tsv"
SPUR_REPORT = ROOT / ".junkburst-report-spur.md"

READ_FLOOR_HZ = 20_000.0
CANDIDATE_DB = 16.0
STRONG_DB = 22.0
PARTNER_TOLERANCE_DB = 3.0
CUMULATIVE_WINDOWS_S = (1.0, 2.0, 3.0)
IMAGE_TOTALS_HZ = (44_100.0, 48_000.0)

#: Provisional spur band edges, docs section 1: a spur below the first edge is SPUR20, and so on up to SPUR50.
SPUR_BAND_EDGES = ((27_500.0, "SPUR20"), (37_500.0, "SPUR30"), (47_500.0, "SPUR40"))
SPUR50 = "SPUR50"


def spur_label_for(freq: float) -> str:
    """Return the provisional spur label for a frequency under the docs section 1 band edges."""
    for edge, label in SPUR_BAND_EDGES:
        if freq < edge:
            return label
    return SPUR50


def excesses_from_20k(curve: _Curve) -> dict[int, float]:
    """``junkadvisor._excesses``, but reading from 20 kHz up rather than ``SPUR_MIN_HZ``, keyed by bin index."""
    limit = curve.floor + junkadvisor.CONTRAST_DB
    start = curve.at(READ_FLOOR_HZ)
    return {i: curve.levels[i] - curve.baseline[i] for i in range(start, len(curve.levels)) if curve.levels[i] > limit}


def excess_at(curve: _Curve, freq: float) -> float:
    """Return the raw excess (level minus wide baseline) of the bin nearest a frequency, threshold or not."""
    i = curve.at(freq)
    return curve.levels[i] - curve.baseline[i]


def has_partner(curve: _Curve, freq: float, excess: float) -> bool:
    """Whether a bin within 3 dB of this excess stands at 44100 or 48000 minus this frequency."""
    for total in IMAGE_TOTALS_HZ:
        partner_freq = total - freq
        if not (0.0 <= partner_freq <= curve.bandwidth):
            continue
        if abs(excess_at(curve, partner_freq) - excess) <= PARTNER_TOLERANCE_DB:
            return True
    return False


def window_curves(meta: dict[str, Any], summed: np.ndarray) -> dict[Any, _Curve]:
    """Per-bin minimum curves at 1 s, 2 s, 3 s and the full burst, each from the burst's own start."""
    arrived = meta["arrived"]
    bandwidth = float(meta["bandwidth"])
    curves: dict[Any, _Curve] = {}
    for window in CUMULATIVE_WINDOWS_S:
        idx = [i for i, t in enumerate(arrived) if t - arrived[0] < window]
        mins = summed[idx].min(axis=0)
        curves[window] = _Curve([float(v) for v in mins], bandwidth)
    full_mins = summed.min(axis=0)
    curves["full"] = _Curve([float(v) for v in full_mins], bandwidth)
    return curves


def read_burst(stamp: str) -> tuple[list[dict[str, Any]], _Curve]:
    """One burst's candidate bins at or over 16 dB on the full window, each with its four-window excess and partner."""
    meta, db = load_burst(stamp)
    summed = summed_db(db)
    curves = window_curves(meta, summed)
    full = curves["full"]
    candidates = []
    for i, exc in excesses_from_20k(full).items():
        if exc < CANDIDATE_DB:
            continue
        freq = full.hz(i)
        four = {w: curves[w].levels[i] - curves[w].baseline[i] for w in (*CUMULATIVE_WINDOWS_S, "full")}
        candidates.append({"freq": freq, "excesses": four, "full_excess": exc, "partner": has_partner(full, freq, exc)})
    return candidates, full


def evidence_for(stamps: list[str], burst_data: dict[str, dict[str, Any]]) -> tuple[list[dict[str, Any]], str | None]:
    """Top three spur frequencies by full-window excess, and the spur label a majority-no-partner candidate names.

    Each top frequency carries its best occurrence's four-window excesses and partner flag, plus, read fresh over
    every one of these bursts, how many clear 22 dB on the full window. The named spur label is the highest-excess
    top frequency whose visible occurrences (>= 16 dB) go without a partner on more than half of them; ``None`` when
    no top frequency clears that bar.
    """
    best_by_round: dict[int, dict[str, Any]] = {}
    for s in stamps:
        for c in burst_data[s]["candidates"]:
            key = round(c["freq"])
            if key not in best_by_round or c["full_excess"] > best_by_round[key]["full_excess"]:
                best_by_round[key] = {**c, "stamp": s}
    top3 = sorted(best_by_round.values(), key=lambda c: c["full_excess"], reverse=True)[:3]

    rows = []
    named: str | None = None
    for c in top3:
        freq = c["freq"]
        clears22 = 0
        visible = 0
        no_partner = 0
        for s in stamps:
            curve = burst_data[s]["curve"]
            exc = excess_at(curve, freq)
            if exc >= STRONG_DB:
                clears22 += 1
            if exc >= CANDIDATE_DB:
                visible += 1
                if not has_partner(curve, freq, exc):
                    no_partner += 1
        majority_no_partner = visible > 0 and no_partner * 2 > visible
        rows.append({**c, "clears22": clears22})
        if named is None and majority_no_partner:
            named = spur_label_for(freq)
    return rows, named


def _read_tsv_rows(path: Path) -> list[list[str]]:
    return [line.split("\t") for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _track_table(label: str, bursts_read: int, rows: list[dict[str, Any]]) -> list[str]:
    lines = [
        f"Label: {label} — bursts read: {bursts_read}",
        "",
        "| frequency (Hz) | excess @1s | excess @2s | excess @3s | excess @full | partner | clears 22 dB on |",
        "| ---: | ---: | ---: | ---: | ---: | --- | ---: |",
    ]
    for r in rows:
        e = r["excesses"]
        lines.append(
            f"| {r['freq']:.0f} | {e[1.0]:.2f} | {e[2.0]:.2f} | {e[3.0]:.2f} | {e['full']:.2f} | "
            f"{'yes' if r['partner'] else 'no'} | {r['clears22']} of {bursts_read} bursts |"
        )
    if not rows:
        lines.append("| (no bin cleared 16 dB on the full window) | | | | | | |")
    return [*lines, ""]


def _read_bursts(graded: list[str], owner: dict[str, str | None]) -> dict[str, dict[str, Any]]:
    """Read every graded burst once, keyed by stamp, each with its candidates, full curve and owner label."""
    burst_data: dict[str, dict[str, Any]] = {}
    for s in graded:
        candidates, full = read_burst(s)
        burst_data[s] = {"candidates": candidates, "curve": full, "label": owner[s]}
        print(f"read {s}: {len(candidates)} candidate bin(s) at or over {CANDIDATE_DB:g} dB", flush=True)
    return burst_data


def _group_by_track(graded: list[str], tracks: dict[str, dict[str, str]]) -> dict[tuple[str, str, str], list[str]]:
    """Group the graded stamps by (primary artist, album, track)."""
    groups: dict[tuple[str, str, str], list[str]] = {}
    for s in graded:
        row = tracks.get(s, {})
        key = (primary_artist(row.get("artist", "")), row.get("album", "").strip(), row.get("track", "").strip())
        groups.setdefault(key, []).append(s)
    return groups


def _track_sections(
    groups: dict[tuple[str, str, str], list[str]],
    burst_data: dict[str, dict[str, Any]],
) -> tuple[list[str], dict[tuple[str, str, str], str | None]]:
    """Report sections for every track in artist/album/track order, and the spur label each track names."""
    sections: list[str] = []
    track_named: dict[tuple[str, str, str], str | None] = {}
    for key in sorted(groups, key=lambda k: (k[0].lower(), k[1].lower(), k[2].lower())):
        artist, album, track = key
        stamps_here = groups[key]
        label = burst_data[stamps_here[0]]["label"]
        rows, named = evidence_for(stamps_here, burst_data)
        track_named[key] = named
        sections.append(f"## {artist} — {album} — {track}")
        sections.append("")
        sections.extend(_track_table(label or "unlabelled", len(stamps_here), rows))
    return sections, track_named


def _relabel(old_label: str, named: str | None) -> str:
    """Return the row's draft label: a named spur, ``FAKE`` flagged not overwritten, ``REAL`` folded to ``CLEAN``."""
    if named is not None:
        return "FAKE?" if old_label == "FAKE" else named
    return "CLEAN" if old_label == "REAL" else old_label


def _draft_row(
    row: list[str],
    track_named: dict[tuple[str, str, str], str | None],
    album_named: Callable[[str, str], str | None],
) -> tuple[list[str], str, str]:
    """One labels TSV row redrafted: the output columns, the old label and the new one."""
    if len(row) >= TRACK_ROW_COLUMNS:
        artist_raw, album, track, old_label = row[0], row[1].strip(), row[2].strip(), row[3].strip()
        key = (primary_artist(artist_raw), album, track)
        new_label = _relabel(old_label, track_named[key]) if key in track_named else old_label
        return [artist_raw, row[1], row[2], new_label], old_label, new_label
    if len(row) == ALBUM_ROW_COLUMNS:
        artist_raw, album, old_label = row[0], row[1].strip(), row[2].strip()
        new_label = old_label if old_label == BY_TRACK else _relabel(old_label, album_named(artist_raw, album))
        return [artist_raw, row[1], new_label], old_label, new_label
    unchanged = row[-1] if row else ""
    return row, unchanged, unchanged


def _draft(
    track_named: dict[tuple[str, str, str], str | None],
    album_named: Callable[[str, str], str | None],
) -> tuple[list[str], list[str]]:
    """Return the draft labels TSV lines, and one report line per row whose label moved."""
    header, *rest = _read_tsv_rows(LABELS_TSV)
    draft_lines = ["\t".join(header)]
    changes: list[str] = []
    for row in rest:
        out_row, old_label, new_label = _draft_row(row, track_named, album_named)
        draft_lines.append("\t".join(out_row))
        if old_label != new_label:
            reason = (
                "REAL folded to CLEAN, no majority-no-partner spur found"
                if new_label == "CLEAN"
                else "named spur without partner on a majority of the row's bursts"
            )
            changes.append(f"- `{'/'.join(row[:-1])}`: {old_label} -> {new_label} ({reason})")
    return draft_lines, changes


def main() -> None:
    """Read every labelled burst once, write the per-track spur report and the draft relabel."""
    tracks = load_tracks()
    by_album, by_track = load_labels()
    stamps = sorted(p.stem for p in DER.glob("*.npy"))
    owner = {s: owner_label(s, tracks, by_album, by_track) for s in stamps}
    labelled = [s for s in stamps if owner[s] is not None]
    graded, _dropped = collapse_overlaps(labelled)
    print(f"derived bursts={len(stamps)} labelled={len(labelled)} graded={len(graded)}", flush=True)

    burst_data = _read_bursts(graded, owner)
    groups = _group_by_track(graded, tracks)
    track_sections, track_named = _track_sections(groups, burst_data)

    def album_named(artist_raw: str, album: str) -> str | None:
        """Union the evidence of every track in an album row's reach, skipping any the row does not govern."""
        akey = (primary_artist(artist_raw), album)
        if by_album.get(akey) == BY_TRACK:
            return None
        pooled = [s for k, v in groups.items() if (k[0], k[1]) == akey for s in v]
        if not pooled:
            return None
        _rows, named = evidence_for(pooled, burst_data)
        return named

    draft_lines, changes = _draft(track_named, album_named)
    DRAFT_TSV.write_text("\n".join(draft_lines) + "\n", encoding="utf-8")
    print(f"wrote {DRAFT_TSV}", flush=True)

    sections = ["# Junkburst spur survey", "", "Produced by `python scripts/junkburst/features/jbspur.py`.", ""]
    sections.extend(track_sections)
    sections.append("## Relabelled")
    sections.append("")
    sections.extend(changes or ["(no row's label changed)"])
    SPUR_REPORT.write_text("\n".join(sections) + "\n", encoding="utf-8")
    print(f"wrote {SPUR_REPORT}", flush=True)


if __name__ == "__main__":
    main()
