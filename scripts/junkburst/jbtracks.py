#!/usr/bin/env python3
"""Build one ``tracks.tsv`` row per junkburst stamp from the RoonServer logs.

``jbroonlogs`` reads the logs into segments. A burst is placed in the segment covering its stamp;
``roon_track_start_utc`` is that segment's virtual start read off the position sample nearest the burst, and
``position_s`` is the stamp less that start. A burst is a transition burst when a load or a resume falls inside its
own frame span.

A streamed row has no album in the logs: Roon logs a Qobuz URL where a local file gives a path. Its album is filled by
two lookups, in order — an existing ``tracks.tsv`` row with the same artist and track, then the one album the artist
carries across ``labels.tsv`` where that artist carries exactly one distinct album. Both match on the primary artist,
the text before the first ``' / '``. Neither reaching an album leaves the column empty, and the run names every such
stamp. A run also refills an empty album on a row already in the file.
"""

from __future__ import annotations

import difflib
import json
import os
import tempfile
import zlib
from bisect import bisect_right
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from jbconfig import LABELS_TSV, SRC, TRACKS_TSV
from jblabels import primary_artist
from jbroonlogs import Logs, Segment, read_logs

#: A burst is placed against a segment that reaches this far past its last position sample.
SEGMENT_TAIL_S = 12.0

#: A segment with fewer samples than this cannot be placed from its own samples alone.
CONFIDENCE_MIN_SAMPLES = 3

#: A load or a resume this close to a burst stamp makes the burst's placement ambiguous.
CONFIDENCE_QUIET_S = 60.0

#: A capture whose gzip or JSON will not read keeps its stamp as its start and this nominal frame span.
DEFAULT_SPAN_S = 4.7

#: Decompressing every capture to read its frame span costs a core for minutes, so the spans are cached here.
SPAN_CACHE = Path(os.environ.get("CLAUDE_SCRATCH", tempfile.gettempdir())) / "junkburst-spans.json"

#: ``tracks.tsv``'s own column order.
COLUMNS = ("stamp", "track", "album", "artist", "roon_track_start_utc", "position_s", "transition", "confidence")

#: Columns ``--check`` diffs on every reachable row. ``album`` is diffed on local rows only, and the three columns the
#: logs cannot reproduce to the second are written but never diffed.
DIFFED = ("track", "artist", "transition")

_STAMP = "%Y%m%dT%H%M%SZ"
_ISO = "%Y-%m-%dT%H:%M:%SZ"

#: A usable ``labels.tsv`` line carries at least an artist and an album.
_LABEL_CELLS = 2

_spans: dict[str, list[Any]] = {}

#: Stamps whose capture would not read, named in the stage's own output.
DAMAGED: list[str] = []


def _read_blob(path: Path) -> dict[str, Any] | None:
    """Return the capture's JSON, tolerating a bad CRC and a stray control character, or ``None``."""
    try:
        raw = zlib.decompressobj(zlib.MAX_WBITS | 16).decompress(path.read_bytes())
    except (OSError, zlib.error):
        return None
    try:
        blob: dict[str, Any] = json.loads(raw.decode("utf-8", "replace"), strict=False)
        return blob
    except json.JSONDecodeError:
        return None


def _load_cache() -> None:
    """Read the span cache once per process."""
    if _spans or not SPAN_CACHE.exists():
        return
    _spans.update(json.loads(SPAN_CACHE.read_text(encoding="utf-8")))


def _save_cache() -> None:
    """Write the span cache back."""
    SPAN_CACHE.write_text(json.dumps(_spans), encoding="utf-8")


def parse_stamp(stamp: str) -> datetime:
    """Return a burst stamp as its UTC instant."""
    return datetime.strptime(stamp, _STAMP).replace(tzinfo=UTC)


def burst_span(stamp: str, src: Path = SRC) -> tuple[datetime, float]:
    """Return the burst's start instant and the seconds its frames span."""
    _load_cache()
    if stamp in _spans:
        began, span = _spans[stamp]
        return datetime.fromisoformat(began), float(span)
    blob = _read_blob(src / f"junkburst-{stamp}.json.gz")
    if blob is None:
        DAMAGED.append(stamp)
        began, span = parse_stamp(stamp), DEFAULT_SPAN_S
    else:
        began = datetime.fromisoformat(blob["started"]).astimezone(UTC)
        arrived = [frame["arrived"] for frame in blob["frames"]]
        span = (max(arrived) - min(arrived)) if arrived else 0.0
    _spans[stamp] = [began.isoformat(), span]
    return began, span


def _segment_for(logs: Logs, at: datetime) -> Segment | None:
    """Return the segment a burst stamp falls in, or ``None`` when the logs no longer reach that far back."""
    found = None
    for segment in logs.segments:
        if segment.began > at:
            break
        if at <= segment.last + timedelta(seconds=SEGMENT_TAIL_S):
            found = segment
    return found


def _near(breaks: list[datetime], lo: datetime, hi: datetime) -> bool:
    """Say whether a load or a resume falls in ``[lo, hi]``."""
    index = bisect_right(breaks, lo)
    return index < len(breaks) and breaks[index] <= hi


@dataclass
class Albums:
    """The two album lookups a streamed row falls back on, in the order they are tried."""

    by_track: dict[tuple[str, str], str] = field(default_factory=dict)
    by_artist: dict[str, str] = field(default_factory=dict)

    def lookup(self, artist: str, track: str) -> str:
        """Return the album for a streamed row, or empty when neither lookup reaches one."""
        primary = primary_artist(artist)
        return self.by_track.get((primary, track)) or self.by_artist.get(primary, "")


def read_albums(tracks_tsv: Path = TRACKS_TSV, labels: Path = LABELS_TSV) -> Albums:
    """Read the album a streamed row can fall back on from ``tracks.tsv`` and ``labels.tsv``."""
    out = Albums()
    for line in tracks_tsv.read_text(encoding="utf-8").splitlines()[1:]:
        cells = line.split("\t")
        if len(cells) == len(COLUMNS) and cells[2]:
            out.by_track.setdefault((primary_artist(cells[3]), cells[1]), cells[2])
    seen: dict[str, set[str]] = {}
    for line in labels.read_text(encoding="utf-8").splitlines()[1:]:
        cells = line.split("\t")
        if len(cells) >= _LABEL_CELLS:
            seen.setdefault(primary_artist(cells[0]), set()).add(cells[1].strip())
    out.by_artist = {artist: next(iter(albums)) for artist, albums in seen.items() if len(albums) == 1}
    return out


def row_for(stamp: str, logs: Logs, albums: Albums, src: Path = SRC) -> dict[str, str] | None:
    """Return one ``tracks.tsv`` row for a burst stamp, or ``None`` when no segment covers it."""
    began, span = burst_span(stamp, src)
    segment = _segment_for(logs, began)
    if segment is None:
        return None
    start = segment.start(began)
    if start is None:
        return None
    quiet = timedelta(seconds=CONFIDENCE_QUIET_S)
    low = len(segment.samples) < CONFIDENCE_MIN_SAMPLES or _near(logs.breaks, began - quiet, began + quiet)
    return {
        "stamp": stamp,
        "track": segment.title,
        "album": segment.album or albums.lookup(segment.artist, segment.title),
        "artist": segment.artist,
        "roon_track_start_utc": start.strftime(_ISO),
        "position_s": f"{(began.replace(microsecond=0) - start).total_seconds():.1f}",
        "transition": "yes" if _near(logs.breaks, began, began + timedelta(seconds=span)) else "no",
        "confidence": "low" if low else "high",
        "local": "yes" if segment.local else "no",
    }


def stamps(src: Path = SRC) -> list[str]:
    """Return every burst stamp under the capture directory, oldest first."""
    return sorted(p.name[len("junkburst-") : -len(".json.gz")] for p in src.glob("junkburst-*.json.gz"))


def render(row: dict[str, str]) -> str:
    """Return one row as its tab-separated line."""
    return "\t".join(row[name] for name in COLUMNS)


def log_floor(logs: Logs) -> datetime:
    """Return the earliest instant the retained logs can place a burst at."""
    return min((s.began for s in logs.segments), default=datetime.max.replace(tzinfo=UTC))


def _masked(was: str, row: dict[str, str]) -> str:
    """Return the rebuilt row with every undiffed column taken from the row already in the file."""
    old = was.split("\t")
    keep = set(COLUMNS) - set(DIFFED) - ({"album"} if row["local"] == "yes" else set())
    return "\t".join(old[i] if name in keep else row[name] for i, name in enumerate(COLUMNS))


def _report_empty(empty: list[dict[str, str]]) -> None:
    """Name every row whose album neither lookup reached."""
    print(f"album unfilled={len(empty)}")
    for row in empty:
        print(f"  {row['stamp']}\t{row['artist']}\t{row['track']}")


def _check(rows: list[str], logs: Logs, albums: Albums, src: Path) -> None:
    """Rebuild every row already in the file and print a unified diff over the diffed columns."""
    floor = log_floor(logs)
    built, unreachable, empty = [], 0, []
    for line in rows:
        stamp = line.split("\t", 1)[0]
        row = row_for(stamp, logs, albums, src) if parse_stamp(stamp) >= floor else None
        if row is None:
            unreachable += 1
            built.append(line)
            continue
        if not row["album"]:
            empty.append(row)
        built.append(_masked(line, row))
    diff = list(difflib.unified_diff(rows, built, "tracks.tsv", "rebuilt", lineterm=""))
    print(f"rows={len(rows)} unreachable={unreachable} reachable={len(rows) - unreachable}")
    print(f"diffed columns: {', '.join(DIFFED)}, album on local rows")
    print(f"differing rows={sum(1 for line in diff if line.startswith('-') and not line.startswith('---'))}")
    if DAMAGED:
        print(f"damaged captures={len(DAMAGED)}: {' '.join(DAMAGED)}")
    _report_empty(empty)
    print("\n".join(diff))


def _refill(rows: list[str], albums: Albums) -> int:
    """Fill the album on rows already in the file that carry none, in place, and return how many were filled."""
    filled = 0
    for index, line in enumerate(rows):
        cells = line.split("\t")
        if len(cells) != len(COLUMNS) or cells[2]:
            continue
        album = albums.lookup(cells[3], cells[1])
        if not album:
            continue
        cells[2] = album
        rows[index] = "\t".join(cells)
        filled += 1
    return filled


def tracks(*, check: bool, src: Path = SRC) -> None:
    """Append a row per burst absent from ``tracks.tsv``, or rebuild the rows already there and diff them."""
    path = src / "tracks.tsv"
    lines = path.read_text(encoding="utf-8").splitlines()
    header, rows = lines[:1], lines[1:]
    logs = read_logs()
    albums = read_albums(path)
    if check:
        _check(rows, logs, albums, src)
        _save_cache()
        return
    refilled = _refill(rows, albums)
    if refilled:
        print(f"album refilled={refilled}")
    have = {line.split("\t", 1)[0] for line in rows}
    fresh, empty = [], []
    for stamp in stamps(src):
        row = row_for(stamp, logs, albums, src) if stamp not in have else None
        if row is None:
            continue
        if row["album"]:
            # A row built this run is an existing row for every row after it, so a later burst of the same track
            # reaches the album its own segment carried no load for.
            albums.by_track.setdefault((row["artist"], row["track"]), row["album"])
        else:
            empty.append(row)
        fresh.append(render(row))
    _save_cache()
    if not fresh and not refilled:
        print("no new rows")
        return
    path.write_text("\n".join(header + rows + fresh) + "\n", encoding="utf-8")
    if fresh:
        print("\n".join(fresh))
    else:
        print("no new rows")
    _report_empty(empty)
