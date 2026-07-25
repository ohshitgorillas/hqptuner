"""Static metadata (data/*.json) and its merge with live engine enumerations.

Join is by name only — the running engine is the sole authority for names,
IDs, ordering, and structural facets (architecture §2 enumeration volatility).
Filter join rules match data/validate.py: exact -> alias -> strip '-2s'.
"""

import json
from pathlib import Path
from typing import Any


class StaticMetadata:
    def __init__(self, data_dir: Path):
        self._filters_db: dict[str, Any] = json.loads((data_dir / "filters.json").read_text())
        self._shapers_db: dict[str, Any] = json.loads((data_dir / "shapers.json").read_text())
        self._settings_db: dict[str, Any] = json.loads((data_dir / "settings.json").read_text())

    @property
    def raw(self) -> dict[str, Any]:
        return {
            "filters": self._filters_db,
            "shapers": self._shapers_db,
            "settings": self._settings_db,
        }

    def filter_entry(self, name: str) -> dict[str, Any] | None:
        db: dict[str, dict[str, Any]] = self._filters_db["filters"]
        aliases: dict[str, str] = self._filters_db.get("aliases", {})
        two_stage = False
        while True:
            entry = db.get(name) or db.get(aliases.get(name, ""))
            if entry is not None:
                if not two_stage:
                    return entry
                note = self._filters_db.get("two_stage_note", "")
                desc = entry.get("description", "")
                return {**entry, "description": f"{desc} {note}".strip()}
            if name.endswith("-2s"):
                name = name[: -len("-2s")]
                two_stage = True
                continue
            return None

    def shaper_entry(self, name: str, mode_name: str) -> dict[str, Any] | None:
        key = "pcm_dithers" if "PCM" in (mode_name or "") else "sdm_modulators"
        db: dict[str, dict[str, Any]] = self._shapers_db[key]
        return db.get(name)


def merge_enumerations(
    enums: dict[str, list[dict[str, str]]], static: StaticMetadata, mode_name: str
) -> dict[str, Any]:
    """Attach static prose to live enumeration items. Unmatched engine
    entries still render (static: null). Live facets (quality/focus/ratio in
    the description, apodizing in arg bit 0) stay on the engine item."""
    merged: dict[str, Any] = dict(enums)
    merged["filters"] = [
        {
            **item,
            "apodizing": bool(int(item.get("arg", "0")) & 1),
            "static": static.filter_entry(item["name"]),
        }
        for item in enums.get("filters", [])
    ]
    merged["shapers"] = [
        {**item, "static": static.shaper_entry(item["name"], mode_name)} for item in enums.get("shapers", [])
    ]
    return merged
