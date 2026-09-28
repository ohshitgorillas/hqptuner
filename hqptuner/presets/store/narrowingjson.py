"""Narrowing's wire shape: the facet map as it arrives on the wire, and the type guards that narrow it.

``FacetInput`` and the narrowing functions below judge only *shape* — is this a string, an int, a list of strings —
never a facet's own domain, which the narrowing store judges.
"""

from __future__ import annotations

from typing import TypedDict, TypeGuard


class FacetInput(TypedDict, total=False):
    """A facet map as it arrives on the wire: each facet's name to a value not yet checked.

    The store judges each value against its facet's own check, on a write and on a read, so every value here is
    typed ``object`` on purpose. A facet key this map does not name is refused, so a bad token comes back as a plain
    shape complaint rather than the store pretending the field does not exist.
    """

    genre: list[str]
    genre_mode: str
    quality: int
    focus: list[str]
    focus_mode: str
    phase: list[str]
    length: list[str]
    hide_limited: str
    odd_rate_only: bool
    downsafe_only: bool
    apod_1x: str
    apod_nx: str
    lossy_1x: str
    src_format: str


def _is_str(value: object) -> TypeGuard[str]:
    return isinstance(value, str)


def _is_int(value: object) -> TypeGuard[int]:
    """Return whether ``value`` is a real ``int``, excluding ``bool``: ``True`` is an ``int``, not a quality step."""
    return isinstance(value, int) and not isinstance(value, bool)


def _is_bool(value: object) -> TypeGuard[bool]:
    return isinstance(value, bool)


def _is_str_list(value: object) -> TypeGuard[list[str]]:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _facet_input_selects(raw: dict[object, object]) -> FacetInput:
    """Narrow the first half of ``FacetInput``'s members: genre through length.

    A value of the wrong shape is dropped rather than kept as a lie the field's real type does not allow; a missing
    key reads as its facet's default, so a wrong-shaped stored value reads as that default.
    """
    facets: FacetInput = {}
    genre = raw.get("genre")
    if _is_str_list(genre):
        facets["genre"] = genre
    genre_mode = raw.get("genre_mode")
    if _is_str(genre_mode):
        facets["genre_mode"] = genre_mode
    quality = raw.get("quality")
    if _is_int(quality):
        facets["quality"] = quality
    focus = raw.get("focus")
    if _is_str_list(focus):
        facets["focus"] = focus
    focus_mode = raw.get("focus_mode")
    if _is_str(focus_mode):
        facets["focus_mode"] = focus_mode
    phase = raw.get("phase")
    if _is_str_list(phase):
        facets["phase"] = phase
    length = raw.get("length")
    if _is_str_list(length):
        facets["length"] = length
    return facets


def _facet_input_toggles(raw: dict[object, object]) -> FacetInput:
    """Narrow the second half of ``FacetInput``'s members: hide_limited through src_format.

    A value of the wrong shape is dropped, the same defense ``_facet_input_selects`` takes.
    """
    facets: FacetInput = {}
    hide_limited = raw.get("hide_limited")
    if _is_str(hide_limited):
        facets["hide_limited"] = hide_limited
    odd_rate_only = raw.get("odd_rate_only")
    if _is_bool(odd_rate_only):
        facets["odd_rate_only"] = odd_rate_only
    downsafe_only = raw.get("downsafe_only")
    if _is_bool(downsafe_only):
        facets["downsafe_only"] = downsafe_only
    apod_1x = raw.get("apod_1x")
    if _is_str(apod_1x):
        facets["apod_1x"] = apod_1x
    apod_nx = raw.get("apod_nx")
    if _is_str(apod_nx):
        facets["apod_nx"] = apod_nx
    lossy_1x = raw.get("lossy_1x")
    if _is_str(lossy_1x):
        facets["lossy_1x"] = lossy_1x
    src_format = raw.get("src_format")
    if _is_str(src_format):
        facets["src_format"] = src_format
    return facets


def facet_input(raw: dict[object, object]) -> FacetInput:
    """Narrow ``raw`` to the members ``FacetInput`` names."""
    facets: FacetInput = {}
    facets.update(_facet_input_selects(raw))
    facets.update(_facet_input_toggles(raw))
    return facets
