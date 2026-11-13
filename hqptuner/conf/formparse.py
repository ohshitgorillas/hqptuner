"""Parses hqplayerd's HTML config/matrix/speakers forms into the ``httpforms`` types.

GET /config, /matrix and /speakers under Digest auth each return an HTML
settings form; ``parse_config_form``/``parse_matrix_form``/
``parse_speakers_form`` turn one into its ``httpforms`` shape (``ConfigForm``/
``MatrixForm``/``SpeakersForm``): every field with its current value and
constraints, grouped by the form's own section/label structure. This is the sole
persistent-config read path.
"""

import re
from collections.abc import Iterable, Iterator

from bs4 import BeautifulSoup, Tag

from hqptuner.conf.httpforms import (
    ConfigForm,
    FormField,
    MatrixForm,
    MatrixRow,
    ProfileSelect,
    SelectOption,
    SpeakerChannel,
    SpeakersForm,
)


def attr(el: Tag, name: str) -> str | None:
    """Return ``el``'s ``name`` attribute as a string, joining a multi-valued (list) attribute with spaces."""
    value = el.get(name)
    if isinstance(value, list):
        return " ".join(value)
    return value


_INT = re.compile(r"[+-]?\d+")
_FLOAT = re.compile(r"[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?")


def _number(raw: str | None) -> int | float | str | None:
    if raw is not None:
        text = raw.strip()
        if _INT.fullmatch(text):
            return int(text)
        if _FLOAT.fullmatch(text):
            return float(text)
    return raw


def _checkbox_value(el: Tag) -> FormField:
    return FormField(value=el.has_attr("checked"))


def _number_value(el: Tag) -> FormField:
    field = FormField(value=_number(attr(el, "value")))
    if el.has_attr("min"):
        field["min"] = _number(attr(el, "min"))
    if el.has_attr("max"):
        field["max"] = _number(attr(el, "max"))
    if el.has_attr("step"):
        field["step"] = _number(attr(el, "step"))
    return field


def _text_value(el: Tag) -> FormField:
    return FormField(value=attr(el, "value") or "")


_INPUT_VALUES = {"checkbox": _checkbox_value, "number": _number_value}
_VALUELESS_INPUTS = ("submit", "button", "hidden")


def _parse_input(el: Tag, section: str | None, label: str | None) -> FormField | None:
    itype = attr(el, "type") or "text"
    if itype in _VALUELESS_INPUTS:
        return None
    field = FormField(name=attr(el, "name"), type=itype, section=section, label=label)
    field.update(_INPUT_VALUES.get(itype, _text_value)(el))
    return field


def _parse_select(el: Tag, section: str | None, label: str | None) -> ProfileSelect:
    options: list[SelectOption] = [
        {
            "value": opt.get("value", ""),
            "label": opt.get_text(strip=True),
            "selected": opt.has_attr("selected"),
        }
        for opt in el.find_all("option")
    ]
    selected = next(
        (o["value"] for o in options if o["selected"]),
        options[0]["value"] if options else None,
    )
    return {
        "name": attr(el, "name"),
        "type": "select",
        "section": section,
        "label": label,
        "value": selected,
        "options": options,
    }


def parse_config_form(html: str) -> ConfigForm:
    """Parse a settings form page into ``{fields, profiles}``.

    ``fields`` is every value-bearing input and select across the page's POST forms, each with its current value,
    its number constraints and the ``<h2>``/``<h3>`` section+label it sits under; submit, button and hidden inputs
    are dropped. ``profiles`` is the preset ``profile`` select held apart from that list (the /config/profile/* CRUD
    form), or None on a page that carries no such select.
    """
    soup = BeautifulSoup(html, "html.parser")
    fields: list[FormField] = []
    profiles: ProfileSelect | None = None
    for section, label, el in _walk_forms(soup):
        if el.name == "select" and attr(el, "name") == "profile":
            # the profile CRUD form (POST /config/profile/*); [default]
            # is the empty-value unnamed base configuration
            profiles = _parse_select(el, section, label)
            continue
        field = _field_from(el, section, label)
        if field is not None:
            fields.append(field)
    return {"fields": fields, "profiles": profiles}


def _walk_forms(soup: BeautifulSoup) -> Iterator[tuple[str | None, str | None, Tag]]:
    """Yield every input and select across the page's POST forms with the ``<h2>``/``<h3>`` it sits under."""
    for form in soup.find_all("form", method="post"):
        section: str | None = None
        label: str | None = None
        for el in form.descendants:
            if not isinstance(el, Tag):
                continue
            if el.name == "h2":
                section = el.get_text(strip=True)
            elif el.name == "h3":
                label = el.get_text(strip=True)
            elif el.name in ("input", "select"):
                yield section, label, el


def _field_from(el: Tag, section: str | None, label: str | None) -> FormField | None:
    if el.name == "input":
        return _parse_input(el, section, label)
    select = _parse_select(el, section, label)
    return FormField(
        name=select["name"],
        type=select["type"],
        section=select["section"],
        label=select["label"],
        value=select["value"],
        options=select["options"],
    )


def grouped_fields(fields: Iterable[FormField], pattern: re.Pattern[str]) -> dict[int, dict[str, FormField]]:
    """Group the fields whose name matches ``pattern`` by its index group.

    ``pattern`` captures a column name and a decimal index (``source_0``); the
    result maps each index to that row's fields keyed by column, in field order.
    Fields whose name does not match are left out.
    """
    groups: dict[int, dict[str, FormField]] = {}
    for field in fields:
        m = pattern.match(field.get("name") or "")
        if m is not None:
            groups.setdefault(int(m.group(2)), {})[m.group(1)] = field
    return groups


# /matrix pipeline-table fields are indexed per row: source_0, gain_0, ... The
# `plot` checkbox is a client-side toggle and `filter` the upload slot — neither
# carries config state, so rows keep only the five value-bearing columns.
MATRIX_ROW_RE = re.compile(r"^(source|gain|gainunit|mixdown|process|plot|filter)_(\d+)$")
_MATRIX_ROW_SKIP = ("plot", "filter")


def _matrix_active(soup: BeautifulSoup) -> str:
    """Read the active matrix profile name, printed as ``<b>Active: </b>NAME`` on the form.

    ``[Default]`` = the unnamed default.
    """
    for b in soup.find_all("b"):
        if b.get_text(strip=True).startswith("Active:"):
            text = b.next_sibling
            if isinstance(text, str):
                return text.strip()
    return ""


def _matrix_profiles(soup: BeautifulSoup, profile_field: FormField | None) -> ProfileSelect | None:
    """Join the profile text input with its ``<datalist>`` options, the saved matrix profiles.

    The generic parser sees only a bare text input — the options live in a
    datalist the input references by id.
    """
    if profile_field is None:
        return None
    datalist = soup.find("datalist")
    options: list[SelectOption] = [
        {"value": opt.get("value", ""), "label": opt.get_text(strip=True), "selected": False}
        for opt in (datalist.find_all("option") if isinstance(datalist, Tag) else [])
    ]
    value = profile_field.get("value")
    return ProfileSelect(
        name=profile_field.get("name"),
        type=profile_field.get("type", "text"),
        section=profile_field.get("section"),
        label=profile_field.get("label"),
        value=value if isinstance(value, str) else None,
        options=options,
    )


def _matrix_rows(groups: dict[int, dict[str, FormField]]) -> list[MatrixRow]:
    rows: list[MatrixRow] = []
    for idx in sorted(groups):
        row: MatrixRow = {"index": idx}
        row.update({col: f.get("value") for col, f in groups[idx].items() if col not in _MATRIX_ROW_SKIP})
        if len(row) > 1:
            rows.append(row)
    return rows


def parse_matrix_form(html: str) -> MatrixForm:
    """Parse the /matrix form into ``{fields, rows, profiles, active}``.

    ``fields`` are the flat controls (enabled/engine/expand_hf/iir2fir + the
    post-process plugin table); ``rows`` groups the indexed pipeline-table fields
    (``source_N``/``gain_N``/``gainunit_N``/``mixdown_N``/``process_N``) into one
    dict per pipeline; ``profiles`` is the profile input with its datalist
    options; ``active`` the printed active-profile name. Tolerates the daemon's
    malformed gainunit markup (``value="dB""`` — stray quote), which the HTML
    parser reads as a normal value plus a junk attribute.
    """
    base = parse_config_form(html)
    soup = BeautifulSoup(html, "html.parser")
    fields: list[FormField] = []
    profile_field: FormField | None = None
    for f in base["fields"]:
        if MATRIX_ROW_RE.match(f.get("name") or ""):
            continue
        if f.get("name") == "profile":
            profile_field = f
            continue
        fields.append(f)
    return {
        "fields": fields,
        "rows": _matrix_rows(grouped_fields(base["fields"], MATRIX_ROW_RE)),
        "profiles": _matrix_profiles(soup, profile_field),
        "active": _matrix_active(soup),
    }


_SPEAKER_FIELD_RE = re.compile(r"^(level|distance)_(\d+)$")


def parse_speakers_form(html: str) -> SpeakersForm:
    """Parse the /speakers form into ``{enabled, channels}``.

    Speaker processing is a top-level config element (readme §1.9), absent from
    /config — this is its only read surface. Each channel is ``{index, label, level, distance}`` plus the
    input min/max/step constraints; ``label`` is the daemon's own channel name (the
    ``<h2>`` above each pair: Left, Right, Center, LFE, Left rear, ...).
    """
    fields = parse_config_form(html)["fields"]
    enabled = next((bool(f.get("value")) for f in reversed(fields) if f.get("name") == "enabled"), False)
    groups = grouped_fields(fields, _SPEAKER_FIELD_RE)
    return {"enabled": enabled, "channels": [_speaker_channel(idx, groups[idx]) for idx in sorted(groups)]}


def _speaker_channel(idx: int, columns: dict[str, FormField]) -> SpeakerChannel:
    first = next(iter(columns.values()))
    ch: SpeakerChannel = {"index": idx, "label": first.get("section")}
    for kind, f in columns.items():
        ch[kind] = f.get("value")
        for attr in ("min", "max", "step"):
            if attr in f:
                ch[f"{kind}_{attr}"] = f.get(attr)
    return ch
