#!/usr/bin/env python3
"""Cut every junkcal capture into one file per labelled album, so no file ever mixes two albums again.

A capture file is a listening period, not an album: ``tests/support/fixtures/junkcal/labels.json`` records, for every
album, the capture it came from (``source``), how many rows it runs (``rows``) and the timestamp of its first kept
row. Any scorer that reads a capture as one labelled unit is reading a label the fixture never gave it.

This writes, into the capture directory:

- ``album-<stamp>-<label>.jsonl`` for every album in ``labels.json``, its rows verbatim and in order;
- ``gap-<capture>-<index>.jsonl`` for every run of rows no album covers, so the split loses nothing;
- ``manifest.json``, one entry per written file: its label (``null`` for a gap), its source capture and its row count.

A capture in ``WHOLE_ALBUMS`` is one album from its first row to its last, under the label given there, and needs no
``labels.json`` entry. A manifest already in the capture directory is kept: its entries for the captures split on this
run are replaced, files and all, and every other entry stands, so one new capture can be added without its sources
being re-split.

The split is verified before anything is reported: every capture's rows must come back, in order, byte for byte, from
the files cut out of it. Originals are not touched here; ``--delete`` removes them only after that check passes.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

#: One album as this script carries it, and one manifest entry as it writes it.
Album = dict[str, Any]
Entry = dict[str, Any]

CAPTURES = Path("/srv/hqptuner/state/junkcal")
FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "support" / "fixtures" / "junkcal"

#: Captures the fixture never cut, each one album end to end, keyed by capture stamp with its label.
WHOLE_ALBUMS: dict[str, str] = {"20260917T021414Z": "20k"}

MANIFEST = "manifest.json"


def albums(fixtures: Path) -> dict[str, list[Album]]:
    """Return every album grouped by the capture file it was cut from, in first-row order."""
    with (fixtures / "labels.json").open(encoding="utf-8") as fh:
        labels: dict[str, Album] = json.load(fh)
    out: dict[str, list[Album]] = {}
    for stamp, entry in labels.items():
        out.setdefault(str(entry["source"]), []).append(
            {
                "stamp": stamp,
                "label": str(entry["junk_filter"]),
                "rows": int(entry["rows"]),
                "kept": [str(row["timestamp"]) for row in entry["kept"]],
            }
        )
    for group in out.values():
        group.sort(key=lambda a: min(a["kept"]))
    return out


def segments(
    lines: list[str], group: list[Album], name: str, problems: list[str]
) -> list[tuple[int, int, Album | None]]:
    """Return the capture's rows partitioned into album spans and the gaps between them.

    An album's ``rows`` counts from its own first row, and the rows the fixture kept are sampled from inside it — the
    first kept row is not the first row, so the span is not anchored on it. Each album is placed at the earliest start
    that still covers every row it kept and does not reach back into the album before it.
    """
    where = {json.loads(line)["timestamp"]: i for i, line in enumerate(lines)}
    spans: list[tuple[int, int, Album]] = []
    cursor = 0
    for album in group:
        seen = [where[stamp] for stamp in album["kept"] if stamp in where]
        if len(seen) != len(album["kept"]):
            problems.append(f"{name}: album {album['stamp']} has kept rows the capture does not carry")
            continue
        start = max(cursor, max(seen) - album["rows"] + 1)
        if start > min(seen):
            problems.append(
                f"{name}: album {album['stamp']} spans {album['rows']} rows but its kept rows run "
                f"{min(seen)}-{max(seen)} with the album before it ending at {cursor}"
            )
            continue
        stop = min(len(lines), start + album["rows"])
        if start + album["rows"] > len(lines):
            problems.append(f"{name}: album {album['stamp']} runs to row {start + album['rows']} of {len(lines)}")
        spans.append((start, stop, album))
        cursor = stop
    out: list[tuple[int, int, Album | None]] = []
    cursor = 0
    for start, stop, album in spans:
        if start > cursor:
            out.append((cursor, start, None))
        out.append((start, stop, album))
        cursor = max(cursor, stop)
    if cursor < len(lines):
        out.append((cursor, len(lines), None))
    return out


def whole_album(path: Path, lines: list[str]) -> list[Album]:
    """Return the one album a ``WHOLE_ALBUMS`` capture is, or nothing for a capture not listed there."""
    stamp = path.stem.removeprefix("junkcal-")
    if stamp not in WHOLE_ALBUMS or not lines:
        return []
    return [{"stamp": stamp, "label": WHOLE_ALBUMS[stamp], "rows": len(lines), "kept": [first_of(lines)]}]


def carried(captures: Path, sources: list[Path]) -> dict[str, Entry]:
    """Return the manifest already on disk minus the entries the captures split on this run replace."""
    index = captures / MANIFEST
    if not index.exists():
        return {}
    with index.open(encoding="utf-8") as fh:
        manifest: dict[str, Entry] = json.load(fh)
    replaced = {path.name for path in sources}
    for name in [name for name, entry in manifest.items() if entry["source"] in replaced]:
        (captures / name).unlink(missing_ok=True)
        del manifest[name]
    return manifest


def write_split(captures: Path, fixtures: Path) -> tuple[dict[str, Entry], list[str], list[Path]]:
    """Cut every capture, verify each split reproduces its capture, and return the manifest."""
    grouped = albums(fixtures)
    sources = sorted(captures.glob("junkcal-*.jsonl"))
    originals = sorted(captures.glob("junkcal-*.jsonl.orig"))
    manifest = carried(captures, sources + originals)
    problems: list[str] = []
    trimmed_stamps: set[str] = set()
    for path in sources:
        lines = path.read_text(encoding="utf-8").splitlines()
        trimmed_stamps.update(json.loads(line)["timestamp"] for line in lines)
        spans = segments(lines, grouped.get(path.name) or whole_album(path, lines), path.name, problems)
        written, problem = cut(path, lines, spans, captures)
        manifest.update(written)
        if problem is not None:
            problems.append(problem)
    for path in originals:
        kept = [
            line
            for line in path.read_text(encoding="utf-8").splitlines()
            if json.loads(line)["timestamp"] not in trimmed_stamps
        ]
        sources.append(path)
        if kept:
            name = f"gap-{path.name.removeprefix('junkcal-').removesuffix('.jsonl.orig')}-orig.jsonl"
            (captures / name).write_text("\n".join(kept) + "\n", encoding="utf-8")
            manifest[name] = {"label": None, "source": path.name, "rows": len(kept), "first": first_of(kept)}
    return manifest, problems, sources


def cut(
    path: Path,
    lines: list[str],
    spans: list[tuple[int, int, Album | None]],
    captures: Path,
) -> tuple[dict[str, Entry], str | None]:
    """Write one capture's spans out and check they concatenate back to the capture."""
    manifest: dict[str, Entry] = {}
    rebuilt: list[str] = []
    for start, stop, album in spans:
        rows = lines[start:stop]
        if not rows:
            continue
        if album is None:
            name = f"gap-{path.stem.removeprefix('junkcal-')}-{start:04d}.jsonl"
            label = None
        else:
            name = f"album-{album['stamp']}-{album['label']}.jsonl"
            label = album["label"]
        (captures / name).write_text("\n".join(rows) + "\n", encoding="utf-8")
        manifest[name] = {"label": label, "source": path.name, "rows": len(rows), "first": first_of(rows)}
        rebuilt.extend(rows)
    if rebuilt != lines:
        return manifest, f"{path.name}: split does not rebuild the capture ({len(rebuilt)} rows of {len(lines)})"
    return manifest, None


def first_of(rows: list[str]) -> str:
    """Return the timestamp of the first row in a span."""
    return str(json.loads(rows[0])["timestamp"])


def main() -> None:
    """Cut every capture, write the manifest, and report what the split produced."""
    ap = argparse.ArgumentParser(description="cut junkcal captures into one file per album")
    ap.add_argument("--captures", type=Path, default=CAPTURES)
    ap.add_argument("--fixtures", type=Path, default=FIXTURES)
    ap.add_argument("--delete", action="store_true", help="remove the capture files once the split verifies")
    args = ap.parse_args()

    manifest, problems, sources = write_split(args.captures, args.fixtures)
    index = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    (args.captures / MANIFEST).write_text(index, encoding="utf-8")

    album_files = {k: v for k, v in manifest.items() if v["label"] is not None}
    gap_files = {k: v for k, v in manifest.items() if v["label"] is None}
    print(f"albums={len(album_files)} album_rows={sum(v['rows'] for v in album_files.values())}")
    print(f"gaps={len(gap_files)} gap_rows={sum(v['rows'] for v in gap_files.values())}")
    print(f"sources={len(sources)} total_rows={sum(v['rows'] for v in manifest.values())}")
    for line in problems:
        print(f"PROBLEM {line}")
    if problems:
        print("split not verified — originals left alone")
        return
    if args.delete:
        for path in sources:
            path.unlink()
        print(f"deleted {len(sources)} capture files")
    else:
        print("verified; pass --delete to remove the originals")


if __name__ == "__main__":
    main()
