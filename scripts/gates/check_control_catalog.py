#!/usr/bin/env python3
"""Gate: the control catalog agrees across the three tables that describe it.

One knob is spelled out in three places, and nothing else checks that they
still agree:

- ``static/store/schema.js`` — UI key -> widget, lane, and the form field it writes
- ``conf/presetconf.py`` FIELD_MAP / PLUGIN_MAP — form field -> XML element + attribute
- ``data/settings.json`` — label and tooltip prose, keyed by tab group

Adding or renaming a control touches three files. Miss one and nothing fails:
the control ships with no tooltip, or the write path silently has nowhere to
persist it. Both are invisible until a user hits them.

The schema is read by *importing* schema.js through node, never by pattern
matching it: a regex sweep produces false hits (``output_mode`` reported as
unjoined when the join is clean) — the entries are a mix of multi-line and
single-line objects with computed values, so the only trustworthy reader is
the JS engine itself.

Reverse directions are reported, not failed. An XML target with no control is a
daemon setting HQPTuner deliberately does not expose; prose with no control is a
control not built yet (``settings.json`` carries an ``_unexposed_candidates``
group for exactly that). Failing on either would punish intent.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from hqptuner.conf import fixedvol, matrixconf, presetconf

ROOT = Path(__file__).resolve().parent.parent.parent
SCHEMA_JS = ROOT / "hqptuner" / "static" / "store" / "schema.js"
SETTINGS_JSON = ROOT / "hqptuner" / "data" / "settings.json"

#: tab groups settings.json is keyed by; anything else kills the tooltip join
GROUPS = ("output", "dsp", "volume", "system")

Schema = dict[str, dict[str, Any]]
Settings = dict[str, dict[str, Any]]


def load_schema() -> Schema:
    """Import schema.js through node and hand back its exported table.

    Functions (``grayWhen``) drop out of JSON.stringify; every field this gate
    reads is a string, so that loss is free.
    """
    src = f"import {{ schema }} from {json.dumps(SCHEMA_JS.as_uri())};\nprocess.stdout.write(JSON.stringify(schema));"
    proc = subprocess.run(  # noqa: S603
        ["node", "--input-type=module", "-e", src],  # noqa: S607
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    if proc.returncode != 0:
        sys.exit(f"could not import {SCHEMA_JS.name} through node:\n{proc.stderr.strip()}")
    parsed: Schema = json.loads(proc.stdout)
    return parsed


def write_targets() -> set[str]:
    """Every form field the persistent write path can actually place in the XML."""
    return (
        set(presetconf.FIELD_MAP)
        | set(presetconf.PLUGIN_MAP)
        | {
            presetconf.NET_DEVICE,
            fixedvol.FIXED_ENABLED,
            fixedvol.FIXED_LEVEL,
            matrixconf.MATRIX_PIPELINES,
            # atomic saved-profile verbs: routed by name like the pipeline set,
            # not through FIELD_MAP (they write a whole element, not an attribute)
            matrixconf.MATRIX_PROFILE_SAVE,
            matrixconf.MATRIX_PROFILE_DELETE,
        }
    )


def prose_key(key: str, entry: dict[str, Any]) -> str:
    """settings.json lookup for a control: its ``note`` override, else its own key."""
    note = entry.get("note")
    return str(note) if note else key


def check_groups(schema: Schema) -> list[str]:
    """Every control names a real tab group."""
    return [
        f"{key}: group {entry.get('group')!r} is not one of {', '.join(GROUPS)}"
        for key, entry in schema.items()
        if entry.get("group") not in GROUPS
    ]


def check_tooltips(schema: Schema, settings: Settings) -> list[str]:
    """Every control has prose in settings.json under its own group."""
    problems = []
    for key, entry in schema.items():
        group = entry.get("group")
        if group not in GROUPS:
            continue  # already reported by check_groups; one complaint per defect
        lookup = prose_key(key, entry)
        if lookup not in settings.get(str(group), {}):
            problems.append(f"{key}: no label/tooltip at settings.json {group}.{lookup}")
    return problems


def check_write_path(schema: Schema, targets: set[str]) -> list[str]:
    """Every persistent control writes a field presetconf can locate in the XML."""
    return [
        f"{key}: http field {entry.get('field')!r} has no XML target in presetconf"
        for key, entry in schema.items()
        if entry.get("lane") == "http" and entry.get("field") not in targets
    ]


def unexposed_targets(schema: Schema, targets: set[str]) -> list[str]:
    """XML targets no control writes — daemon settings the UI does not expose."""
    used = {str(entry["field"]) for entry in schema.values() if entry.get("field")}
    return sorted(targets - used)


def orphan_prose(schema: Schema, settings: Settings) -> list[str]:
    """settings.json entries no control reads — prose ahead of its control."""
    used = {(entry.get("group"), prose_key(key, entry)) for key, entry in schema.items()}
    return sorted(f"{group}.{key}" for group in GROUPS for key in settings.get(group, {}) if (group, key) not in used)


def report(title: str, lines: list[str]) -> None:
    """Print an informational block, or nothing when it is empty."""
    if not lines:
        return
    print(f"\n{title} ({len(lines)}):")
    for line in lines:
        print(f"  {line}")


def main() -> int:
    schema = load_schema()
    settings: Settings = json.loads(SETTINGS_JSON.read_text())
    targets = write_targets()

    problems = check_groups(schema) + check_tooltips(schema, settings) + check_write_path(schema, targets)
    for problem in problems:
        print(problem)

    report("not exposed by any control (informational)", unexposed_targets(schema, targets))
    report("prose with no control (informational)", orphan_prose(schema, settings))

    if problems:
        print(f"\n{len(problems)} catalog disagreement(s) across schema.js, presetconf.py and settings.json.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
