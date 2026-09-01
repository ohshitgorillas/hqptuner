#!/usr/bin/env python3
"""Gate: the shipped static metadata loads, and covers the engine it describes.

``hqptuner/data/*.json`` is hand-written prose and constraints joined to the
engine's enumerations by name (architecture §2). Nothing in the offline suite
reads the shipped files any more — tests run on ``tests/support/fixtures/
metadata_min`` — so a shipped file that fails to parse, drops the key the
loader reads, or forgets the row for a modulator the engine reports would
surface first in a running container. This gate reads the real files the way
the application does and refuses the commit instead.

Four checks, each a list of problem lines:

- every file the loader opens exists, parses, and carries the key the loader
  indexes (``<stem>-plain-names.json`` must carry its stem key);
- every shaper the engine snapshot (``engine-enums.json``) names has a row
  with the rate fields the fit alerts read and a description;
- every filter the snapshot names resolves through the production join
  (``StaticMetadata.filter_entry``: exact, alias, ``-2s`` stripped);
- every exposed control in ``settings.json`` carries label, tooltip, source.

Usage: ``python scripts/gates/check_metadata.py [DATA_DIR]`` — the shipped
directory when no argument is given.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from hqptuner.metadata import OVERLAYS, StaticMetadata

ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "hqptuner" / "data"

#: Files the loader opens whole, with no single key it must find.
DOCUMENTS = ("filters.json", "shapers.json", "settings.json", "easy-presets.json", "engine-enums.json")
#: Snapshot list -> shapers.json database -> the rate fields its rows must carry.
SHAPER_TABLES = (
    ("shapers_sdm", "sdm_modulators", ("min_rate_hz",)),
    ("shapers_pcm", "pcm_dithers", ("min_rate_hz", "max_rate_hz")),
)
FILTER_LISTS = ("filters_sdm", "filters_pcm")
SETTINGS_GROUPS = ("output", "dsp", "volume", "system")
PROSE_FIELDS = ("label", "tooltip", "source")


def _file_problems(path: Path, key: str | None = None) -> list[str]:
    """One line naming ``path`` when it is missing, unparseable, or lacks ``key``."""
    if not path.is_file():
        return [f"{path.name}: missing"]
    try:
        doc = json.loads(path.read_text())
    except ValueError as exc:
        return [f"{path.name}: {exc}"]
    if key is not None and key not in doc:
        return [f"{path.name}: no {key!r} key"]
    return []


def check_files(data_dir: Path) -> list[str]:
    """Every file the loader opens exists, parses, and carries the key the loader reads."""
    problems = [line for name in DOCUMENTS for line in _file_problems(data_dir / name)]
    for key, stem in OVERLAYS:
        problems += _file_problems(data_dir / f"{stem}-plain-names.json", key)
    return problems


def _row_problems(name: str, entry: dict[str, Any] | None, fields: tuple[str, ...], db_key: str) -> list[str]:
    """Name the fields an engine-reported shaper's row lacks, or the missing row itself."""
    if entry is None:
        return [f"shapers.json: engine {db_key} {name!r} has no entry"]
    required = (*fields, "description")
    return [f"shapers.json: {db_key} {name!r} missing {field}" for field in required if field not in entry]


def check_shapers(enums: dict[str, Any], shapers: dict[str, Any]) -> list[str]:
    """Every shaper the snapshot names has a row carrying its rate fields and a description."""
    problems: list[str] = []
    for list_key, db_key, fields in SHAPER_TABLES:
        db: dict[str, Any] = shapers.get(db_key, {})
        for item in enums.get(list_key, []):
            problems += _row_problems(item["name"], db.get(item["name"]), fields, db_key)
    return problems


def check_filters(enums: dict[str, Any], static: StaticMetadata) -> list[str]:
    """Every filter the snapshot names resolves through the production join."""
    return [
        f"filters.json: engine filter {item['name']!r} unresolved"
        for list_key in FILTER_LISTS
        for item in enums.get(list_key, [])
        if static.filter_entry(item["name"]) is None
    ]


def check_settings(settings: dict[str, Any]) -> list[str]:
    """Every exposed control carries label, tooltip and source."""
    return [
        f"settings.json: {group}.{key} missing {field}"
        for group in SETTINGS_GROUPS
        for key, entry in settings.get(group, {}).items()
        for field in PROSE_FIELDS
        if not entry.get(field)
    ]


def check(data_dir: Path) -> list[str]:
    """Every problem with the metadata under ``data_dir``; empty when it is sound.

    File problems return alone: the loader cannot construct over them, and the
    coverage checks would only restate the same missing file.
    """
    problems = check_files(data_dir)
    if problems:
        return problems
    static = StaticMetadata(data_dir)
    enums: dict[str, Any] = json.loads((data_dir / "engine-enums.json").read_text())
    raw = static.raw
    return check_shapers(enums, raw["shapers"]) + check_filters(enums, static) + check_settings(raw["settings"])


def main(argv: list[str] | None = None) -> int:
    """Print every problem under the given (or shipped) data dir; 1 when there is any."""
    args = sys.argv[1:] if argv is None else argv
    data_dir = Path(args[0]) if args else DATA
    problems = check(data_dir)
    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} metadata problem(s) under {data_dir}.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
