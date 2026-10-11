#!/usr/bin/env python3
"""Gate: the control catalog agrees across the tables that describe it.

One knob is spelled out in three places, and nothing else checks that they
still agree:

- ``static/store/schema.js`` — UI key -> widget, lane, and the form field it writes
- ``conf/presetconf.py`` FIELD_MAP / PLUGIN_MAP — form field -> XML element + attribute
- ``data/settings.json`` — label and tooltip prose, keyed by tab group

Adding or renaming a control touches three files. Miss one and nothing fails:
the control ships with no tooltip, or the write path silently has nowhere to
persist it. Both are invisible until a user hits them.

The drawers draw those controls. Every drawer schema exported by a module under
``static/components/faceplate/drawers/`` or ``static/components/faceplate/settings/``
names each row (by its ``key``, in a tab body or a backend group), each field
(by its ``id``) and each choice (by its own ``id``) in one of two homes: a key
of the engine catalog (``store/schema.js``), or a key of ``local`` in
``store/schema/local.js``. An id in neither is a control nothing declares.

Every JS table is read by *importing* its module through node, never by pattern
matching it: a regex sweep produces false hits (``output_mode`` reported as
unjoined when the join is clean) — the entries are a mix of multi-line and
single-line objects with computed values, so the only trustworthy reader is
the JS engine itself. The drawer modules import the vendored preact bundles by
bare specifier, so node runs with ``tests/js/support/vendor-resolve.js``, the
importmap resolver the JS suite uses.

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

from hqptuner.conf import fixedvol, matrixconf, matrixprofiles, presetconf

ROOT = Path(__file__).resolve().parent.parent.parent
STATIC = ROOT / "hqptuner" / "static"
SCHEMA_JS = STATIC / "store" / "schema.js"
LOCAL_JS = STATIC / "store" / "schema" / "local.js"
SETTINGS_JSON = ROOT / "hqptuner" / "data" / "settings.json"
#: the node loader hook that resolves bare vendor specifiers through index.html's importmap
VENDOR_RESOLVE_JS = ROOT / "tests" / "js" / "support" / "vendor-resolve.js"
#: the directories whose modules export drawer schemas
DRAWER_DIRS = (
    STATIC / "components" / "faceplate" / "drawers",
    STATIC / "components" / "faceplate" / "settings",
)

#: tab groups settings.json is keyed by; anything else kills the tooltip join
GROUPS = ("output", "dsp", "volume", "system")

Schema = dict[str, dict[str, Any]]
Settings = dict[str, dict[str, Any]]
#: a drawer module's path under ``hqptuner/static/`` -> its exports as JSON
Modules = dict[str, dict[str, Any]]

#: run by node: import the catalog, ``local`` and every drawer module, and print them as one JSON object
IMPORT_JS = """
import { schema } from %(schema)s;
import { local } from %(local)s;
const drawers = {};
for (const path of %(paths)s) drawers[path] = { ...(await import(new URL(path, %(static)s).href)) };
process.stdout.write(JSON.stringify({ schema, local: Object.keys(local), drawers }));
"""


def drawer_paths() -> list[str]:
    """Every module under the drawer directories, as its path under ``hqptuner/static/``."""
    return sorted(path.relative_to(STATIC).as_posix() for folder in DRAWER_DIRS for path in folder.rglob("*.js"))


def load_tables() -> tuple[Schema, set[str], Modules]:
    """Import the catalog, ``local`` and the drawer modules through node and hand back what they export.

    Functions (``grayWhen``, a field's ``value``) drop out of JSON.stringify;
    every field this gate reads is a string, so that loss is free.
    """
    src = IMPORT_JS % {
        "schema": json.dumps(SCHEMA_JS.as_uri()),
        "local": json.dumps(LOCAL_JS.as_uri()),
        "paths": json.dumps(drawer_paths()),
        "static": json.dumps(STATIC.as_uri() + "/"),
    }
    proc = subprocess.run(  # noqa: S603
        ["node", "--import", VENDOR_RESOLVE_JS.as_uri(), "--input-type=module", "-e", src],  # noqa: S607
        capture_output=True,
        text=True,
        cwd=ROOT,
        check=False,
    )
    if proc.returncode != 0:
        sys.exit(f"could not import the catalog and drawer modules through node:\n{proc.stderr.strip()}")
    parsed: dict[str, Any] = json.loads(proc.stdout)
    return parsed["schema"], set(parsed["local"]), parsed["drawers"]


def write_targets() -> set[str]:
    """Every form field the persistent write path can actually place in the XML."""
    return (
        set(presetconf.FIELD_MAP)
        | set(presetconf.LOCAL_BACKEND_MAP)
        | set(matrixconf.PLUGIN_MAP)
        | {
            presetconf.NET_DEVICE,
            fixedvol.FIXED_ENABLED,
            fixedvol.FIXED_LEVEL,
            matrixconf.MATRIX_PIPELINES,
            # atomic saved-profile verbs: routed by name like the pipeline set,
            # not through FIELD_MAP (they write a whole element, not an attribute)
            matrixprofiles.MATRIX_PROFILE_SAVE,
            matrixprofiles.MATRIX_PROFILE_DELETE,
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


def item_ids(item: dict[str, Any]) -> list[tuple[str, Any]]:
    """Name the control ids one drawer body item draws, each beside the kind of item drawing it."""
    if "row" in item:
        return [("row", item["row"].get("key"))]
    if "field" in item:
        return [("field", item["field"].get("id"))]
    if "choice" in item:
        return [("choice", item["choice"].get("id"))]
    return [("row", row.get("key")) for row in item.get("rows", [])]


def drawers(exports: dict[str, Any]) -> list[dict[str, Any]]:
    """Pick the drawer schemas out of a module's exports: the objects carrying a list of tabs."""
    return [value for value in exports.values() if isinstance(value, dict) and isinstance(value.get("tabs"), list)]


def check_drawer_homes(modules: Modules, catalog: set[str], local: set[str]) -> list[str]:
    """Every row, field and choice a drawer draws names a catalog key or a declared local."""
    homes = catalog | local
    return [
        f"{path}: drawer {drawer.get('id')!r} tab {tab.get('id')!r}: {kind} {control_id!r}"
        " is neither a catalog key nor declared in store/schema/local.js"
        for path, exports in modules.items()
        for drawer in drawers(exports)
        for tab in drawer["tabs"]
        for item in tab.get("body", [])
        for kind, control_id in item_ids(item)
        if control_id not in homes
    ]


def report(title: str, lines: list[str]) -> None:
    """Print an informational block, or nothing when it is empty."""
    if not lines:
        return
    print(f"\n{title} ({len(lines)}):")
    for line in lines:
        print(f"  {line}")


def main() -> int:
    """Refuse a control missing its tab group, its prose, or its XML write target, and a drawer id with no home."""
    schema, local, modules = load_tables()
    settings: Settings = json.loads(SETTINGS_JSON.read_text())
    targets = write_targets()

    problems = (
        check_groups(schema)
        + check_tooltips(schema, settings)
        + check_write_path(schema, targets)
        + check_drawer_homes(modules, set(schema), local)
    )
    for problem in problems:
        print(problem)

    report("not exposed by any control (informational)", unexposed_targets(schema, targets))
    report("prose with no control (informational)", orphan_prose(schema, settings))

    if problems:
        tables = "schema.js, presetconf.py, settings.json and the drawers"
        print(f"\n{len(problems)} catalog disagreement(s) across {tables}.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
