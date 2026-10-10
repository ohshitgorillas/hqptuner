"""Static metadata (data/*.json) and its merge with live engine enumerations.

Join is by name only — the running engine is the sole authority for names,
IDs, ordering, and structural facets (architecture §3.1 enumeration volatility).
Filter join rules: exact -> alias -> strip '-2s' (filters.json ``_join_rules``);
``scripts/gates/check_metadata.py`` holds the shipped files to them.

Types live in ``metadata_types``, the isinstance narrowing that builds them from parsed JSON in ``metadata_json``
(filepawl's length gate on this module) — both re-exported here so a caller does not have to know the split.
"""

import json
import weakref
from pathlib import Path

from hqptuner import metadata_json
from hqptuner.metadata_types import (
    EasyDb,
    EnumFilterItem,
    EnumShaperItem,
    FilterEntry,
    FiltersDb,
    Json,
    MergedEnums,
    ModeInfo,
    PlainNameEntry,
    PlainNamesOverlay,
    SettingEntry,
    SettingsDb,
    ShaperEntry,
    ShapersDb,
    StaticDb,
)

__all__ = [
    "OVERLAYS",
    "EasyDb",
    "EnumFilterItem",
    "EnumShaperItem",
    "FilterEntry",
    "FiltersDb",
    "Json",
    "MergedEnums",
    "ModeInfo",
    "PlainNameEntry",
    "PlainNamesOverlay",
    "SettingEntry",
    "SettingsDb",
    "ShaperEntry",
    "ShapersDb",
    "StaticDb",
    "StaticMetadata",
    "merge_enumerations",
]

#: The plain-names overlays: the key each document carries, and the stem of the
#: ``<stem>-plain-names.json`` file that carries it.
OVERLAYS: tuple[tuple[str, str], ...] = (
    ("filters", "filter"),
    ("dithers", "dither"),
    ("modulators", "modulator"),
    ("sdm_conversion", "sdm-conversion"),
    ("sdm_integrator", "sdm-integrator"),
    ("noise_filter", "noise-filter"),
    ("pcm_conversion", "pcm-conversion"),
)


class StaticMetadata:
    """The hand-written prose about filters, shapers and settings that the engine does not report."""

    def __init__(self, data_dir: Path):
        """Load the metadata JSON — filters, shapers, settings, plain names, Easy Mode copy — from ``data_dir``.

        Read once at startup: the files ship with the application and never change under a running process. Every
        document is narrowed from parsed JSON with isinstance checks as it is loaded (``metadata_json``) — a field
        this HQPTuner does not recognize, or one holding the wrong shape, is dropped rather than trusted blind.
        """
        self._filters_db: FiltersDb = metadata_json.filters_db(json.loads((data_dir / "filters.json").read_text()))
        self._shapers_db: ShapersDb = metadata_json.shapers_db(json.loads((data_dir / "shapers.json").read_text()))
        self._settings_db: SettingsDb = metadata_json.settings_db(json.loads((data_dir / "settings.json").read_text()))
        self._easy_db: EasyDb = metadata_json.easy_db(json.loads((data_dir / "easy-presets.json").read_text()))
        self._plain_names: dict[str, PlainNamesOverlay] = {}
        for key, stem in OVERLAYS:
            doc: object = json.loads((data_dir / f"{stem}-plain-names.json").read_text())
            entries = doc.get(key) if isinstance(doc, dict) else None
            families = doc.get("families") if isinstance(doc, dict) else None
            variants = doc.get("variants") if isinstance(doc, dict) else None
            self._plain_names[key] = PlainNamesOverlay(
                entries=metadata_json.plain_name_entry_map(entries),
                families=metadata_json.str_map(families),
                variants=metadata_json.str_map(variants),
            )
        # The hqplayerd releases a green live run has passed against; no file means none.
        record = data_dir / "tested-releases.json"
        self._tested_releases = frozenset(
            metadata_json.str_list(json.loads(record.read_text())) if record.exists() else ()
        )

    @property
    def raw(self) -> StaticDb:
        """Return the databases exactly as loaded, under ``filters``/``shapers``/``settings``/``plain_names``/``easy``.

        This is what ``/api/metadata`` serves, so the frontend can look up an entry the merge did not attach.
        Easy Mode's copy joins no enumeration at all — its tiles are curated, not engine-reported — so it reaches
        the frontend only through here.
        """
        return StaticDb(
            filters=self._filters_db,
            shapers=self._shapers_db,
            settings=self._settings_db,
            plain_names=self._plain_names,
            easy=self._easy_db,
        )

    def release_tested(self, release: str) -> bool:
        """Return whether ``release`` is an hqplayerd release the live suite has passed against."""
        return release in self._tested_releases

    def filter_entry(self, name: str) -> FilterEntry | None:
        """Return the static entry for a filter the engine named, or None when nothing in the database matches.

        Tries the name exactly, then as an alias, then with a ``-2s`` suffix stripped; a name that only resolved
        after stripping gets the shared two-stage note appended to its description.
        """
        db = self._filters_db.get("filters", {})
        aliases = self._filters_db.get("aliases", {})
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

    def shaper_entry(self, name: str, mode_name: str) -> ShaperEntry | None:
        """Return the static entry for a shaper, or None when the named mode's database does not carry it.

        ``mode_name`` picks the database: a PCM output mode reads the dithers, anything else the SDM modulators.
        The two are never searched together — the same name can mean different things across them.
        """
        if "PCM" in (mode_name or ""):
            return self._shapers_db.pcm_dithers.get(name)
        return self._shapers_db.sdm_modulators.get(name)


Enums = dict[str, list[dict[str, str]]]

#: Each ``StaticMetadata``'s last merge: the very ``enums`` object it read (held, so its id cannot be reused by
#: another), the mode name, and the result.
_LAST_MERGE: weakref.WeakKeyDictionary[StaticMetadata, tuple[Enums, str, MergedEnums]] = weakref.WeakKeyDictionary()


def merge_enumerations(enums: Enums, static: StaticMetadata, mode_name: str) -> MergedEnums:
    """Attach static prose to live enumeration items.

    Unmatched engine entries still render (static: null). Live facets (quality/focus/ratio in the description,
    apodizing in arg bit 0) stay on the engine item. The live enumerations are only ever replaced whole, never edited
    in place, so the same ``enums`` object under the same mode returns the merge already built for it.
    """
    last = _LAST_MERGE.get(static)
    if last is not None and last[0] is enums and last[1] == mode_name:
        return last[2]
    merged = _merge(enums, static, mode_name)
    _LAST_MERGE[static] = (enums, mode_name, merged)
    return merged


def _merge(enums: Enums, static: StaticMetadata, mode_name: str) -> MergedEnums:
    """Build the merged lists ``merge_enumerations`` serves."""
    filters: list[EnumFilterItem] = [
        {
            "index": item.get("index", ""),
            "name": item["name"],
            "value": item.get("value", ""),
            "arg": item.get("arg", "0"),
            "description": item.get("description", ""),
            "apodizing": bool(int(item.get("arg", "0")) & 1),
            "static": static.filter_entry(item["name"]),
        }
        for item in enums.get("filters", [])
    ]
    shapers: list[EnumShaperItem] = [
        {
            "index": item.get("index", ""),
            "name": item["name"],
            "value": item.get("value", ""),
            "static": static.shaper_entry(item["name"], mode_name),
        }
        for item in enums.get("shapers", [])
    ]
    return MergedEnums(
        modes=enums.get("modes", []),
        filters=filters,
        shapers=shapers,
        rates=enums.get("rates", []),
        junk_filters=enums.get("junk_filters", []),
    )
