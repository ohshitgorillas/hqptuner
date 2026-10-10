"""Narrowing loaded static-metadata JSON into ``metadata_types``, isinstance-only, never with cast.

Every function here takes ``object`` — a value straight out of ``json.loads``, or one member of it — and returns the
best ``metadata_types`` value that value's own shape supports. A field this HQPTuner does not recognize, or one
holding the wrong shape, is dropped rather than trusted blind; the shipped files are held to their own schema
separately (``scripts/gates/check_metadata.py``), so a mismatch here means a hand-edited or foreign file, not a bug
worth crashing the loader over.
"""

from typing import TypeGuard

from hqptuner.metadata_types import (
    EasyDb,
    FilterEntry,
    FiltersDb,
    Json,
    PlainNameEntry,
    SettingEntry,
    SettingsDb,
    ShaperEntry,
    ShapersDb,
)


def _is_str(value: object) -> TypeGuard[str]:
    return isinstance(value, str)


def _is_opt_str(value: object) -> TypeGuard[str | None]:
    return value is None or isinstance(value, str)


def _is_bool(value: object) -> TypeGuard[bool]:
    return isinstance(value, bool)


def _is_int(value: object) -> TypeGuard[int]:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_opt_int(value: object) -> TypeGuard[int | None]:
    return value is None or (isinstance(value, int) and not isinstance(value, bool))


def _is_str_list(value: object) -> TypeGuard[list[str]]:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _is_str_map(value: object) -> TypeGuard[dict[str, str]]:
    return isinstance(value, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in value.items())


def _is_json(value: object) -> TypeGuard[Json]:
    if value is None or isinstance(value, bool | int | float | str):
        return True
    if isinstance(value, list):
        return all(_is_json(item) for item in value)
    if isinstance(value, dict):
        return all(isinstance(k, str) and _is_json(v) for k, v in value.items())
    return False


def _is_json_map(value: object) -> TypeGuard[dict[str, Json]]:
    return isinstance(value, dict) and all(isinstance(k, str) and _is_json(v) for k, v in value.items())


def str_map(value: object) -> dict[str, str]:
    """``value`` as a flat string map, empty when it is not one — the shared default for a missing overlay key."""
    return value if _is_str_map(value) else {}


def str_list(value: object) -> list[str]:
    """``value`` as a list of strings, empty when it is not one."""
    return value if _is_str_list(value) else []


def _filter_taxonomy(raw: dict[str, object]) -> FilterEntry:
    """Keep the character facets of one filter entry: genre, quality, focus, apodizing and phase."""
    entry: FilterEntry = {}
    genre = raw.get("genre")
    if _is_str_list(genre):
        entry["genre"] = genre
    quality = raw.get("quality")
    if _is_int(quality):
        entry["quality"] = quality
    focus = raw.get("focus")
    if _is_str_list(focus):
        entry["focus"] = focus
    apodizing = raw.get("apodizing")
    if _is_str(apodizing):
        entry["apodizing"] = apodizing
    phase = raw.get("phase")
    if _is_str(phase):
        entry["phase"] = phase
    return entry


def _filter_geometry(raw: dict[str, object]) -> FilterEntry:
    """Keep the rate and shape facets of one filter entry: the ratios, upsample-only, length and adaptive."""
    entry: FilterEntry = {}
    ratio = raw.get("ratio")
    if _is_str(ratio):
        entry["ratio"] = ratio
    ratio_pcm = raw.get("ratio_pcm")
    if _is_str(ratio_pcm):
        entry["ratio_pcm"] = ratio_pcm
    ratio_sdm = raw.get("ratio_sdm")
    if _is_str(ratio_sdm):
        entry["ratio_sdm"] = ratio_sdm
    upsample_only = raw.get("upsample_only")
    if _is_bool(upsample_only):
        entry["upsample_only"] = upsample_only
    length = raw.get("length")
    if _is_str(length):
        entry["length"] = length
    adaptive = raw.get("adaptive")
    if _is_bool(adaptive):
        entry["adaptive"] = adaptive
    return entry


def _filter_prose(raw: dict[str, object]) -> FilterEntry:
    """Keep the prose of one filter entry: description, notes and the SDM two-stage pair."""
    entry: FilterEntry = {}
    description = raw.get("description")
    if _is_str(description):
        entry["description"] = description
    notes = raw.get("notes")
    if _is_str(notes):
        entry["notes"] = notes
    sdm_two_stage = raw.get("sdm_two_stage")
    if _is_bool(sdm_two_stage):
        entry["sdm_two_stage"] = sdm_two_stage
    sdm_two_stage_note = raw.get("sdm_two_stage_note")
    if _is_str(sdm_two_stage_note):
        entry["sdm_two_stage_note"] = sdm_two_stage_note
    return entry


def filter_entry(raw: object) -> FilterEntry:
    """One ``filters.json`` entry, keeping only the fields ``FilterEntry`` names and whose value fits."""
    entry: FilterEntry = {}
    if not isinstance(raw, dict):
        return entry
    entry.update(_filter_taxonomy(raw))
    entry.update(_filter_geometry(raw))
    entry.update(_filter_prose(raw))
    return entry


def filter_entry_map(value: object) -> dict[str, FilterEntry]:
    """Every ``filters.json`` ``filters`` entry, keyed by its engine-reported name."""
    if not isinstance(value, dict):
        return {}
    return {key: filter_entry(v) for key, v in value.items() if isinstance(key, str)}


def shaper_entry(raw: object) -> ShaperEntry:
    """One ``shapers.json`` entry, keeping only the fields ``ShaperEntry`` names and whose value fits."""
    entry: ShaperEntry = {}
    if not isinstance(raw, dict):
        return entry
    min_rate_hz = raw.get("min_rate_hz")
    if _is_opt_int(min_rate_hz):
        entry["min_rate_hz"] = min_rate_hz
    max_rate_hz = raw.get("max_rate_hz")
    if _is_opt_int(max_rate_hz):
        entry["max_rate_hz"] = max_rate_hz
    min_rate_label = raw.get("min_rate_label")
    if _is_str(min_rate_label):
        entry["min_rate_label"] = min_rate_label
    description = raw.get("description")
    if _is_str(description):
        entry["description"] = description
    notes = raw.get("notes")
    if _is_str(notes):
        entry["notes"] = notes
    order = raw.get("order")
    if _is_int(order):
        entry["order"] = order
    generation = raw.get("generation")
    if _is_int(generation):
        entry["generation"] = generation
    shaper_type = raw.get("type")
    if _is_str(shaper_type):
        entry["type"] = shaper_type
    return entry


def shaper_entry_map(value: object) -> dict[str, ShaperEntry]:
    """Every entry of one ``shapers.json`` per-mode table (``sdm_modulators`` or ``pcm_dithers``)."""
    if not isinstance(value, dict):
        return {}
    return {key: shaper_entry(v) for key, v in value.items() if isinstance(key, str)}


def _setting_entry(raw: object) -> SettingEntry:
    entry: SettingEntry = {}
    if not isinstance(raw, dict):
        return entry
    label = raw.get("label")
    if _is_str(label):
        entry["label"] = label
    tooltip = raw.get("tooltip")
    if _is_str(tooltip):
        entry["tooltip"] = tooltip
    more = raw.get("more")
    if _is_str(more):
        entry["more"] = more
    source = raw.get("source")
    if _is_str(source):
        entry["source"] = source
    options = raw.get("options")
    if _is_str_map(options):
        entry["options"] = options
    return entry


def _setting_entry_map(value: object) -> dict[str, SettingEntry]:
    if not isinstance(value, dict):
        return {}
    return {key: _setting_entry(v) for key, v in value.items() if isinstance(key, str)}


def plain_name_entry(raw: object) -> PlainNameEntry:
    """One ``*-plain-names.json`` entry, keeping only the fields ``PlainNameEntry`` names and whose value fits."""
    entry: PlainNameEntry = {}
    if not isinstance(raw, dict):
        return entry
    family = raw.get("family")
    if _is_str(family):
        entry["family"] = family
    variant = raw.get("variant")
    if _is_opt_str(variant):
        entry["variant"] = variant
    leaf = raw.get("leaf")
    if _is_str(leaf):
        entry["leaf"] = leaf
    short = raw.get("short")
    if _is_str(short):
        entry["short"] = short
    apod = raw.get("apod")
    if _is_str(apod):
        entry["apod"] = apod
    rec = raw.get("rec")
    if _is_bool(rec):
        entry["rec"] = rec
    return entry


def plain_name_entry_map(value: object) -> dict[str, PlainNameEntry]:
    """Every entry of one plain-names overlay document's named map (``filters``, ``dithers``, ...)."""
    if not isinstance(value, dict):
        return {}
    return {key: plain_name_entry(v) for key, v in value.items() if isinstance(key, str)}


def filters_db(raw: object) -> FiltersDb:
    """``filters.json`` as loaded, narrowed to ``FiltersDb``."""
    db: FiltersDb = {}
    if not isinstance(raw, dict):
        db["filters"] = {}
        return db
    comment = raw.get("_comment")
    if _is_str(comment):
        db["_comment"] = comment
    join_rules = raw.get("_join_rules")
    if _is_str(join_rules):
        db["_join_rules"] = join_rules
    source = raw.get("_source")
    if _is_str(source):
        db["_source"] = source
    aliases = raw.get("aliases")
    if _is_str_map(aliases):
        db["aliases"] = aliases
    two_stage_note = raw.get("two_stage_note")
    if _is_str(two_stage_note):
        db["two_stage_note"] = two_stage_note
    sdm_two_stage_note = raw.get("sdm_two_stage_note")
    if _is_str(sdm_two_stage_note):
        db["sdm_two_stage_note"] = sdm_two_stage_note
    guidance = raw.get("guidance")
    if _is_json_map(guidance):
        db["guidance"] = guidance
    db["filters"] = filter_entry_map(raw.get("filters"))
    return db


def shapers_db(raw: object) -> ShapersDb:
    """``shapers.json`` as loaded, narrowed to ``ShapersDb``."""
    if not isinstance(raw, dict):
        return ShapersDb(sdm_modulators={}, pcm_dithers={})
    comment = raw.get("_comment")
    join_note = raw.get("_join_note")
    source = raw.get("_source")
    guidance = raw.get("guidance")
    return ShapersDb(
        sdm_modulators=shaper_entry_map(raw.get("sdm_modulators")),
        pcm_dithers=shaper_entry_map(raw.get("pcm_dithers")),
        _comment=comment if _is_str(comment) else None,
        _join_note=join_note if _is_str(join_note) else None,
        _source=source if _is_str(source) else None,
        guidance=guidance if _is_json_map(guidance) else None,
    )


def settings_db(raw: object) -> SettingsDb:
    """``settings.json`` as loaded, narrowed to ``SettingsDb``."""
    root = raw if isinstance(raw, dict) else {}
    comment = root.get("_comment")
    unexposed = root.get("_unexposed_candidates")
    return SettingsDb(
        output=_setting_entry_map(root.get("output")),
        dsp=_setting_entry_map(root.get("dsp")),
        volume=_setting_entry_map(root.get("volume")),
        system=_setting_entry_map(root.get("system")),
        _comment=comment if _is_str(comment) else None,
        _unexposed_candidates=unexposed if _is_json_map(unexposed) else None,
    )


def easy_db(raw: object) -> EasyDb:
    """``easy-presets.json`` as loaded, narrowed to a flat JSON object — never read key by key here."""
    return raw if _is_json_map(raw) else {}
