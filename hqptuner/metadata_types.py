"""Types for the static metadata (data/*.json) and its merge with live engine enumerations.

This module is the vocabulary, ``metadata_json.py`` is the isinstance narrowing that builds it from parsed JSON, and
``metadata.py`` is the class and merge that use both.
"""

from dataclasses import dataclass
from typing import TypedDict

#: A value as it arrives out of parsed static-metadata JSON, below the level any loader in ``metadata_json.py``
#: destructures — prose blocks (``guidance``, Easy Mode's own tiles) that pass straight through to the frontend and
#: are never read key by key in this codebase.
type Json = bool | int | float | str | list["Json"] | dict[str, "Json"] | None


class FilterEntry(TypedDict, total=False):
    """One ``filters.json`` entry: the prose and taxonomy for one engine-reported filter name."""

    genre: list[str]
    quality: int
    focus: list[str]
    apodizing: str
    phase: str
    ratio: str
    ratio_pcm: str
    ratio_sdm: str
    upsample_only: bool
    length: str
    adaptive: bool
    description: str
    notes: str
    sdm_two_stage: bool
    sdm_two_stage_note: str


class ShaperEntry(TypedDict, total=False):
    """One ``shapers.json`` entry: the prose and rate guidance for one dither or modulator."""

    min_rate_hz: int | None
    max_rate_hz: int | None
    min_rate_label: str
    description: str
    notes: str
    order: int
    generation: int
    type: str


class SettingEntry(TypedDict, total=False):
    """One ``settings.json`` leaf: a control's tooltip prose, its source citation, and its own option glossary."""

    label: str
    tooltip: str
    source: str
    options: dict[str, str]


class FiltersDb(TypedDict, total=False):
    """``filters.json`` as loaded: the join tables ``filter_entry`` reads, plus the prose ``raw`` passes through."""

    _comment: str
    _join_rules: str
    _source: str
    aliases: dict[str, str]
    two_stage_note: str
    sdm_two_stage_note: str
    guidance: dict[str, Json]
    filters: dict[str, FilterEntry]


@dataclass(frozen=True)
class ShapersDb:
    """``shapers.json`` as loaded: the two per-mode tables ``shaper_entry`` reads, plus its guidance prose."""

    sdm_modulators: dict[str, ShaperEntry]
    pcm_dithers: dict[str, ShaperEntry]
    _comment: str | None = None
    _join_note: str | None = None
    _source: str | None = None
    guidance: dict[str, Json] | None = None


@dataclass(frozen=True)
class SettingsDb:
    """``settings.json`` as loaded: per-tab control tooltips, served whole and never read key by key here."""

    output: dict[str, SettingEntry]
    dsp: dict[str, SettingEntry]
    volume: dict[str, SettingEntry]
    system: dict[str, SettingEntry]
    _comment: str | None = None
    _unexposed_candidates: dict[str, Json] | None = None


#: ``easy-presets.json`` as loaded: Easy Mode's curated copy, one entry per preset id (a set this module never
#: enumerates) plus a handful of fixed sections (``help``, ``tips``, ``card``, ``notice``) — never read key by key
#: here, only served whole to the frontend.
type EasyDb = dict[str, Json]


class PlainNameEntry(TypedDict, total=False):
    """One ``*-plain-names.json`` entry: the family/variant/leaf breakdown of one engine-reported name."""

    family: str
    variant: str | None
    leaf: str
    short: str
    apod: str
    rec: bool


class PlainNamesOverlay(TypedDict):
    """One OVERLAYS document as ``StaticMetadata`` reassembles it: the per-name entries plus the two glossaries."""

    entries: dict[str, PlainNameEntry]
    families: dict[str, str]
    variants: dict[str, str]


@dataclass(frozen=True)
class StaticDb:
    """The four static databases plus the plain-names overlay, exactly as ``StaticMetadata.raw`` serves them."""

    filters: FiltersDb
    shapers: ShapersDb
    settings: SettingsDb
    plain_names: dict[str, PlainNamesOverlay]
    easy: EasyDb


class EnumFilterItem(TypedDict):
    """One live filter enumeration item merged with its static prose (protocol.md §6 ``FiltersItem``)."""

    index: str
    name: str
    value: str
    arg: str
    description: str
    apodizing: bool
    static: FilterEntry | None


class EnumShaperItem(TypedDict):
    """One live shaper enumeration item merged with its static prose (protocol.md §6 ``ShapersItem``)."""

    index: str
    name: str
    value: str
    static: ShaperEntry | None


class ModeInfo(TypedDict):
    """The active output mode, as the status route attaches it to ``MergedEnums`` after the merge."""

    index: str | None
    name: str


@dataclass(frozen=True)
class MergedEnums:
    """The live enumerations merged with static prose, as ``GET /api/enumerations`` serves them."""

    modes: list[dict[str, str]]
    filters: list[EnumFilterItem]
    shapers: list[EnumShaperItem]
    rates: list[dict[str, str]]
    junk_filters: list[dict[str, str]]
    mode: ModeInfo | None = None
