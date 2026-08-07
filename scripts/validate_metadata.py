#!/usr/bin/env python3
"""Static-metadata validation for HQPTuner static metadata.

Checks:
  1. Every engine-reported shaper has a name-keyed entry with a machine-readable
     rate-constraint field (min_rate_hz, nullable but present).
  2. Every engine-reported filter resolves through the join rules
     (exact -> alias -> strip '-2s' suffix).
  3. Every settings.json control has non-empty tooltip and source.
  4. No filter entry duplicates a live facet (quality/focus/ratio/apodizing/phase).

Engine lists come from engine-enums.json (reference snapshot). PCM-mode lists
are validated only if captured; a gap note is printed otherwise.
"""

import json
import sys
from pathlib import Path
from typing import Any

DATA = Path(__file__).parent
errors = []
warnings = []


def load(name: str) -> Any:
    with open(DATA / name) as f:
        return json.load(f)


enums = load("engine-enums.json")
shapers = load("shapers.json")
filters = load("filters.json")
settings = load("settings.json")

# 1. Shapers: engine name coverage + rate constraint presence
mods = shapers["sdm_modulators"]
for item in enums["shapers_sdm"]:
    name = item["name"]
    if name not in mods:
        errors.append(f"shapers.json: engine modulator {name!r} has no entry")
    elif "min_rate_hz" not in mods[name]:
        errors.append(f"shapers.json: {name!r} missing min_rate_hz")
for name, entry in mods.items():
    if not entry.get("description"):
        errors.append(f"shapers.json: {name!r} missing description")
for name, entry in shapers["pcm_dithers"].items():
    if "min_rate_hz" not in entry or "max_rate_hz" not in entry:
        errors.append(f"shapers.json: dither {name!r} missing rate fields")
    if not entry.get("description"):
        errors.append(f"shapers.json: dither {name!r} missing description")
if isinstance(enums.get("shapers_pcm"), str):
    warnings.append(
        "engine PCM dither list uncaptured — pcm_dithers keyed to manual names; "
        "re-validate when Phase 2 captures the PCM-mode list"
    )
else:
    errors.extend(
        f"shapers.json: engine dither {item['name']!r} has no entry"
        for item in enums["shapers_pcm"]
        if item["name"] not in shapers["pcm_dithers"]
    )

# 2. Filters: engine name coverage via join rules
fdb = filters["filters"]
aliases = filters.get("aliases", {})


def resolve_filter(name: str) -> str | None:
    if name in fdb:
        return name
    if name in aliases and aliases[name] in fdb:
        return str(aliases[name])
    if name.endswith("-2s"):
        return resolve_filter(name[: -len("-2s")])
    return None


errors.extend(
    f"filters.json: engine filter {item['name']!r} unresolved"
    for item in enums["filters_sdm"]
    if resolve_filter(item["name"]) is None
)
if isinstance(enums.get("filters_pcm"), str):
    warnings.append("engine PCM filter list uncaptured — re-validate when Phase 2 captures it")
else:
    errors.extend(
        f"filters.json: engine PCM filter {item['name']!r} unresolved"
        for item in enums["filters_pcm"]
        if resolve_filter(item["name"]) is None
    )

# 3. Settings: every control has tooltip + source
n_controls = 0
for section in ("output", "dsp", "volume", "system"):
    for key, entry in settings[section].items():
        n_controls += 1
        errors.extend(
            f"settings.json: {section}.{key} missing {field}"
            for field in ("label", "tooltip", "source")
            if not entry.get(field)
        )

# 4. No live-facet duplication in filters.json
LIVE_FACETS = {"quality", "focus", "ratio", "apodizing", "phase"}
for name, entry in fdb.items():
    dup = LIVE_FACETS & set(entry)
    if dup:
        errors.append(f"filters.json: {name!r} ships live facet(s) {sorted(dup)}")

print(f"engine SDM: {len(enums['filters_sdm'])} filters, {len(enums['shapers_sdm'])} shapers")
print(
    f"static: {len(fdb)} filter entries, {len(mods)} modulators, "
    f"{len(shapers['pcm_dithers'])} dithers, {n_controls} setting tooltips"
)
for w in warnings:
    print(f"WARN: {w}")
if errors:
    print(f"\nFAIL ({len(errors)}):")
    for e in errors:
        print(f"  {e}")
    sys.exit(1)
print("OK — all Phase 1 exit criteria pass")
