"""Static metadata (data/*.json) and its merge with live engine enumerations.

Join is by name only — the running engine is the sole authority for names,
IDs, ordering, and structural facets (architecture §2 enumeration volatility).
Filter join rules match data/validate.py: exact -> alias -> strip '-2s'.
"""

import json
from pathlib import Path
from typing import Any


class StaticMetadata:
    """The hand-written prose about filters, shapers and settings that the engine does not report."""

    def __init__(self, data_dir: Path):
        """Load the metadata JSON — filters, shapers, settings, plain names — from ``data_dir`` and hold it in memory.

        Read once at startup: the files ship with the application and never change under a running process.
        """
        self._filters_db: dict[str, Any] = json.loads((data_dir / "filters.json").read_text())
        self._shapers_db: dict[str, Any] = json.loads((data_dir / "shapers.json").read_text())
        self._settings_db: dict[str, Any] = json.loads((data_dir / "settings.json").read_text())
        self._plain_names: dict[str, Any] = {}
        overlays = (
            ("filters", "filter"),
            ("dithers", "dither"),
            ("modulators", "modulator"),
            ("sdm_conversion", "sdm-conversion"),
            ("sdm_integrator", "sdm-integrator"),
        )
        for key, stem in overlays:
            doc = json.loads((data_dir / f"{stem}-plain-names.json").read_text())
            self._plain_names[key] = {
                "entries": doc[key],
                "families": doc.get("families", {}),
                "variants": doc.get("variants", {}),
            }

    @property
    def raw(self) -> dict[str, Any]:
        """Return the three databases exactly as loaded, under ``filters``/``shapers``/``settings``.

        This is what ``/api/metadata`` serves, so the frontend can look up an entry the merge did not attach.
        """
        return {
            "filters": self._filters_db,
            "shapers": self._shapers_db,
            "settings": self._settings_db,
            "plain_names": self._plain_names,
        }

    def filter_entry(self, name: str) -> dict[str, Any] | None:
        """Return the static entry for a filter the engine named, or None when nothing in the database matches.

        Tries the name exactly, then as an alias, then with a ``-2s`` suffix stripped; a name that only resolved
        after stripping gets the shared two-stage note appended to its description.
        """
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
        """Return the static entry for a shaper, or None when the named mode's database does not carry it.

        ``mode_name`` picks the database: a PCM output mode reads the dithers, anything else the SDM modulators.
        The two are never searched together — the same name can mean different things across them.
        """
        key = "pcm_dithers" if "PCM" in (mode_name or "") else "sdm_modulators"
        db: dict[str, dict[str, Any]] = self._shapers_db[key]
        return db.get(name)


def merge_enumerations(
    enums: dict[str, list[dict[str, str]]], static: StaticMetadata, mode_name: str
) -> dict[str, Any]:
    """Attach static prose to live enumeration items.

    Unmatched engine entries still render (static: null). Live facets (quality/focus/ratio in the description,
    apodizing in arg bit 0) stay on the engine item.
    """
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
