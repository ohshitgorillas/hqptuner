"""The owner's labels: the two TSV inputs, the family grouping, and the duplicate-arrival collapse."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from jbconfig import BY_TRACK, DER, LABELS_TSV, TRACKS_TSV

if TYPE_CHECKING:
    from pathlib import Path

#: Column counts a ``labels.tsv`` row carries: four for an artist, album and track verdict, three for an album one.
TRACK_ROW_COLUMNS = 4
ALBUM_ROW_COLUMNS = 3

#: The owner's verdicts that grade a burst, each mapped to the side it is scored on. ``CLEAN`` is a master the owner
#: hears as clean, scored with ``REAL``. Every other verdict grades nothing and drops the burst from the corpus.
GRADES = {"FAKE": "FAKE", "REAL": "REAL", "CLEAN": "REAL"}

#: Owner's family grouping for the per-family wrong-side table. Each key set is an AND of normalized substrings
#: matched against the burst's album field; the first family whose any key set matches wins. A REAL burst is always
#: "real" regardless of album; a FAKE burst matching no key set is "unassigned".
FAMILY_KEYS: dict[str, tuple[tuple[str, ...], ...]] = {
    "soft wall": (
        ("foundations of burden",),
        ("wine dark sea",),
        ("avow",),
        ("white1",),
        ("white2",),
        ("master of puppets",),
        ("masterpiece",),
        ("guidance",),
        ("my arms", "your hearse"),
        ("symphony no 5",),
        ("the chronic", "re lit"),
        ("awaken", "my love"),
        ("emma ruth rundle", "marked for death"),
        ("another eternity",),
    ),
    "hard wall": (
        ("morningrise",),
        ("orchid",),
        ("the hot rock",),
        ("touched by the crimson king",),
        ("vile nilotic rites",),
        ("amassakoul",),
        ("dragon new warm mountain",),
    ),
    "no shelf": (
        ("ok computer", "oknotok", "disc 1"),
        ("caligula",),
        ("amnesty",),
    ),
}
FAMILY_ORDER = ("soft wall", "hard wall", "no shelf", "unassigned", "real")


def _rows(path: Path) -> list[list[str]]:
    """Every non-empty line of a TSV split on tabs, header included."""
    return [line.split("\t") for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def load_tracks() -> dict[str, dict[str, str]]:
    """``tracks.tsv`` keyed by stamp, values keyed by the file's own column names."""
    rows = _rows(TRACKS_TSV)
    header = rows[0]
    out: dict[str, dict[str, str]] = {}
    for row in rows[1:]:
        padded = row + [""] * (len(header) - len(row))
        entry = dict(zip(header, padded, strict=False))
        out[entry["stamp"]] = entry
    return out


def load_labels() -> tuple[dict[tuple[str, str], str], dict[tuple[str, str, str], str]]:
    """``labels.tsv`` as an (artist, album) map and an (artist, album, track) map for the ``BY_TRACK`` albums."""
    by_album: dict[tuple[str, str], str] = {}
    by_track: dict[tuple[str, str, str], str] = {}
    for row in _rows(LABELS_TSV)[1:]:
        if len(row) >= TRACK_ROW_COLUMNS:
            by_track[(row[0].strip(), row[1].strip(), row[2].strip())] = row[3].strip()
        elif len(row) == ALBUM_ROW_COLUMNS:
            by_album[(row[0].strip(), row[1].strip())] = row[2].strip()
    return by_album, by_track


def owner_label(
    stamp: str,
    tracks: dict[str, dict[str, str]],
    by_album: dict[tuple[str, str], str],
    by_track: dict[tuple[str, str, str], str],
) -> str | None:
    """Return the owner's verdict for one burst, or ``None`` when nothing labels it.

    The burst's artist and album from ``tracks.tsv`` index ``labels.tsv``, and a ``BY_TRACK`` album is resolved once
    more by the burst's track title. A burst absent from ``tracks.tsv``, or whose row reaches no label, is unlabelled.
    """
    row = tracks.get(stamp)
    if row is None:
        return None
    artist, album, track = row.get("artist", "").strip(), row.get("album", "").strip(), row.get("track", "").strip()
    label = by_album.get((artist, album))
    if label == BY_TRACK:
        label = by_track.get((artist, album, track))
    if label in GRADES:
        return GRADES[label]
    return None


#: Punctuation folded to spaces before two album spellings are compared: curly quotes, the non-breaking hyphen by code
#: point, then the plain quotes, dashes and separators.
FOLD_CHARS = tuple(chr(c) for c in (0x201C, 0x201D, 0x2018, 0x2019, 0x2010)) + tuple("\"'-,.!()[]{}&/")


def normalize(text: str) -> str:
    """Lowercase, punctuation folded to spaces, whitespace collapsed, so album spellings compare loosely."""
    out = text.lower()
    for ch in FOLD_CHARS:
        out = out.replace(ch, " ")
    return " ".join(out.split())


def family_of(label: str, album: str) -> str:
    """Return the owner's family for one burst: "real" for any REAL burst, else the first matching key set's family."""
    if label == "REAL":
        return "real"
    norm = normalize(album)
    for family, keysets in FAMILY_KEYS.items():
        for keys in keysets:
            if all(k in norm for k in keys):
                return family
    return "unassigned"


def collapse_overlaps(stamps: list[str]) -> tuple[list[str], list[dict[str, str]]]:
    """One burst per span of arrival time, earliest stamp kept, plus one row per stamp dropped.

    Two writers metering the same 5 s leave two stamps carrying the same audio; scoring both counts every block of it
    twice. Bursts are walked in arrival order and one whose span starts before the kept burst's span ends is dropped.
    """
    spans: dict[str, tuple[float, float]] = {}
    for stamp in stamps:
        arrived = json.loads((DER / f"{stamp}.json").read_text(encoding="utf-8"))["arrived"]
        spans[stamp] = (float(arrived[0]), float(arrived[-1]))
    kept: list[str] = []
    dropped: list[dict[str, str]] = []
    keeper, keeper_end = None, 0.0
    for stamp in sorted(stamps, key=lambda s: (spans[s][0], s)):
        start, end = spans[stamp]
        if keeper is not None and start < keeper_end:
            dropped.append({"stamp": stamp, "duplicates": keeper})
            keeper_end = max(keeper_end, end)
            continue
        kept.append(stamp)
        keeper, keeper_end = stamp, end
    return kept, dropped
