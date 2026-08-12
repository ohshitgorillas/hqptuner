"""Matrix pipeline-table and saved-profile editing for a config-snapshot XML.

Covers matrix-spec §8 step 3 and profile persistence, round 5.

Sibling of ``engineconf``/``presetconf``: the ``<pipeline>`` children of
``<matrix>`` are the one multi-instance element HQPTuner writes, and rows are
added/removed as a set — the daemon accepts only complete pipeline tables
(matrix-spec probe findings) — so the whole set stages as ONE atomic field:
``matrix_pipelines``, a JSON array of {source, gain, gainunit, mixdown, process}
rows. Gain serializes bare = dB, ``L``-prefixed = linear (probe-verified;
negative linear = polarity inversion).

Saved profiles (``<matrix_profile name="...">``, readme §1.12) are written here
too, because **hqplayerd does not persist them itself**: ``POST /matrix/save``
registers a name in daemon memory, and the config file the daemon rewrites in
the same breath carries no such element — so the profile is gone at the next
daemon start (matrix-spec.md "Probe findings — saved"). HQPTuner owns the
element instead, which
makes a save or a delete an ordinary staged config edit on the restore lane and
gives the daemon the profiles back when it reads its config. Both verbs stage
atomically, one field each, same shape as the row set.

Profiles reuse the pipeline row serializer, so a profile and the matrix it was
saved from are byte-identical — which is what lets the apply's verify diff prove
the element landed instead of trusting an HTTP 200.

``GroundingError`` lives in ``xmledit`` (the lowest layer, where the shared
locators are).
"""

from __future__ import annotations

import json
import re
from typing import Any

from hqptuner.conf.matrixscope import (
    attr_escape,
    attr_unescape,
    matrix_body_span,
    matrix_scope,
)
from hqptuner.conf.xmledit import GroundingError, ensure_body, ensure_element, in_comment

MATRIX_PIPELINES = "matrix_pipelines"
# One staged field per profile verb. Save carries {"name", "rows"} so the rows
# are the ones the user is looking at, not whatever the config happens to hold.
MATRIX_PROFILE_SAVE = "matrix_profile_save"
MATRIX_PROFILE_DELETE = "matrix_profile_delete"
# Readback field: every profile in the snapshot, as canonical JSON.
MATRIX_PROFILES = "matrix_profiles"

# <post_process><plugin type="X" ...>. Field -> (plugin type, attribute).
#
# Lives here rather than in presetconf because a saved profile is a stored matrix
# and carries a chain of its own: naming a profile's post-process fields is this
# module's job. ``presetconf`` re-exports it, and imports it from here — the other
# direction is a cycle, since presetconf already imports this module.
PLUGIN_MAP: dict[str, tuple[str, str]] = {
    "post_bauer_enabled": ("bauer", "enabled"),
    "post_bauer_preset": ("bauer", "preset"),
    "post_bauer_frequency": ("bauer", "frequency"),
    "post_bauer_level": ("bauer", "level"),
    "post_correction_enabled": ("correction", "enabled"),
    "post_correction_dac0": ("correction", "dac0"),
    # loudness plugin — form field -> XML attr, grounded by value-correlation: the
    # live /matrix form defaults uniquely match the snapshot's <plugin
    # type="loudness"> attributes (lowfreq=80<->low_frequency, lowtype=lshelf<->
    # low_type, rangehigh=-20<->range_high, ...). readme §1.11.2.1 documents them.
    "post_loudness_enabled": ("loudness", "enabled"),
    "post_loudness_lowfreq": ("loudness", "low_frequency"),
    "post_loudness_lowlevel": ("loudness", "low_level"),
    "post_loudness_lowsteep": ("loudness", "low_steepness"),
    "post_loudness_lowtype": ("loudness", "low_type"),
    "post_loudness_highfreq": ("loudness", "high_frequency"),
    "post_loudness_highlevel": ("loudness", "high_level"),
    "post_loudness_highsteep": ("loudness", "high_steepness"),
    "post_loudness_hightype": ("loudness", "high_type"),
    "post_loudness_rangelow": ("loudness", "range_low"),
    "post_loudness_rangehigh": ("loudness", "range_high"),
}

#: (plugin type, attribute) -> form field, for reading a stored chain back.
_PLUGIN_FIELDS: dict[tuple[str, str], str] = {loc: field for field, loc in PLUGIN_MAP.items()}

_GAIN_RE = re.compile(r"^-?\d+(\.\d+)?$")
_MAX_CHANNELS = 128
_NAME_MAX = 128
_FIRST_PRINTABLE = 0x20  # anything below is a control character the config XML cannot carry


def _validate_row(row: Any) -> dict[str, str]:
    if not isinstance(row, dict):
        raise GroundingError("matrix_pipelines: each row must be an object")
    try:
        source, mixdown = int(row["source"]), int(row["mixdown"])
    except (KeyError, TypeError, ValueError) as exc:
        raise GroundingError("matrix_pipelines: source/mixdown must be integers") from exc
    if not (0 <= source < _MAX_CHANNELS and 0 <= mixdown < _MAX_CHANNELS):
        raise GroundingError("matrix_pipelines: source/mixdown out of range 0..127")
    gain = str(row.get("gain", "0"))
    if not _GAIN_RE.match(gain):
        raise GroundingError(f"matrix_pipelines: bad gain {gain!r}")
    unit = str(row.get("gainunit", "dB"))
    if unit not in ("dB", "Lin"):
        raise GroundingError(f"matrix_pipelines: bad gainunit {unit!r}")
    process = str(row.get("process", ""))
    if any(ord(c) < _FIRST_PRINTABLE for c in process):
        raise GroundingError("matrix_pipelines: control characters in process string")
    return {"source": str(source), "gain": gain, "gainunit": unit, "mixdown": str(mixdown), "process": process}


def _rows_from_list(raw: Any, field: str) -> list[dict[str, str]]:
    """Build a validated row set from an already-parsed list.

    Shared by the pipeline table and a saved profile — one row contract, so a
    profile can never hold a row the live table would have refused.
    """
    if not isinstance(raw, list) or not 1 <= len(raw) <= _MAX_CHANNELS:
        raise GroundingError(f"{field}: must be a list of 1..128 rows")
    return [_validate_row(r) for r in raw]


def _validate_rows(value: str) -> list[dict[str, str]]:
    try:
        raw = json.loads(value)
    except ValueError as exc:
        raise GroundingError(f"{MATRIX_PIPELINES}: not valid JSON: {exc}") from exc
    return _rows_from_list(raw, MATRIX_PIPELINES)


def _pipeline_tag(channel: int, row: dict[str, str]) -> bytes:
    """One ``<pipeline/>`` element, attributes in the daemon's alphabetical order.

    That ordering keeps a readback diff against the daemon's own serialization
    byte-clean.
    """
    gain = f"L{row['gain']}" if row["gainunit"] == "Lin" else row["gain"]
    return (
        f'<pipeline channel="{channel}" gain="{gain}" mixdown="{row["mixdown"]}" '
        f'process="{attr_escape(row["process"])}" source="{row["source"]}"/>'
    ).encode()


def _rows_of(body: bytes) -> list[dict[str, str]]:
    """Read the ``<pipeline>`` rows of one element body, in form-field terms.

    One parser for the live table and for a saved profile.
    """
    rows = []
    for pm in re.finditer(rb"<pipeline\b[^>]*/>", body):
        attrs = {k.decode(): v.decode() for k, v in re.findall(rb'(\w+)="([^"]*)"', pm.group(0))}
        gain, unit = attrs.get("gain", "0"), "dB"
        if gain.startswith("L"):
            gain, unit = gain[1:], "Lin"
        rows.append(
            {
                "source": attrs.get("source", "0"),
                "gain": gain,
                "gainunit": unit,
                "mixdown": attrs.get("mixdown", "0"),
                "process": attr_unescape(attrs.get("process", "")),
            }
        )
    return rows


def replace_pipelines(xml: bytes, value: str) -> bytes:
    """Replace the ``<matrix>`` element's ``<pipeline>`` children wholesale with the staged row set.

    Everything else in the matrix body (``<post_process>``) and every byte
    outside it are preserved; indentation is taken from the existing rows so the
    daemon's own formatting survives.
    """
    return _replace_pipelines_here(xml, _validate_rows(value))


def _replace_pipelines_here(xml: bytes, rows: list[dict[str, str]]) -> bytes:
    """``replace_pipelines`` past validation, against the live matrix."""
    # a config whose matrix was never configured carries no <matrix> body at all;
    # the rows the user just built are what puts one there
    xml = ensure_body(xml, "matrix")
    start, close = matrix_body_span(xml)
    body = xml[start:close]
    indent_m = re.search(rb"\n([ \t]*)<pipeline\b", body)
    indent = indent_m.group(1) if indent_m else b"\t\t\t"
    stripped = re.sub(rb"\n?[ \t]*<pipeline\b[^>]*/>", b"", body)
    block = b"".join(b"\n" + indent + _pipeline_tag(i, row) for i, row in enumerate(rows))
    return xml[:start] + block + stripped + xml[close:]


def materialize_profile(xml: bytes, name: str) -> bytes:
    """Copy the named saved profile's rows and post-process chain INTO the live ``<matrix>``.

    The config then runs that profile's matrix with no switch.

    hqplayerd records the selected profile nowhere (readme §1.12 gives
    ``<matrix_profile>`` the one attribute ``name``), so a daemon restart always
    comes up on ``<matrix>``. Re-selecting the profile afterwards is not a
    substitute: the live switch is a playback-time operation, and a restart is
    exactly when nothing is playing. Making ``<matrix>`` *be* the profile's
    content is the only form of "keep what I was listening to" the config file
    can express.

    The stored profile element is left alone — it is a saved snapshot, and Save
    is what updates it.
    """
    scope = matrix_scope(xml, name)
    rows = _rows_of(scope)
    if rows:
        xml = _replace_pipelines_here(xml, rows)
    return _replace_post_process(xml, _live_post_process(scope))


def _replace_post_process(xml: bytes, post: bytes) -> bytes:
    """Put ``post`` in the live ``<matrix>``, replacing any chain already there.

    An empty ``post`` clears the chain, which is what a profile carrying none
    means: nothing of the previous matrix's processing should survive it.
    """
    xml = ensure_body(xml, "matrix")
    start, close = matrix_body_span(xml)
    body = xml[start:close]
    stripped = re.sub(rb"\n?[ \t]*<post_process\b[^>]*>.*?</post_process>", b"", body, flags=re.DOTALL)
    if not post:
        return xml[:start] + stripped + xml[close:]
    indent_m = re.search(rb"\n([ \t]*)<pipeline\b", stripped)
    indent = b"\n" + indent_m.group(1) if indent_m else b"\n\t\t\t"
    return xml[:start] + stripped + indent + post + xml[close:]


def read_pipelines(xml: bytes) -> str | None:
    """Read the ``<matrix>`` element's pipeline rows as canonical JSON, or None when there is no matrix body.

    Canonical means sorted keys and compact separators, on both sides of the
    verify diff — intended and realized configs run through this same
    serialization, so equality means the daemon accepted the rows.
    """
    try:
        start, close = matrix_body_span(xml)
    except GroundingError:
        return None
    return json.dumps(_rows_of(xml[start:close]), sort_keys=True, separators=(",", ":"))


# --- saved profiles (<matrix_profile name="...">, readme §1.12) --------------


def _validate_name(name: Any) -> str:
    """Return a profile name fit for an XML attribute.

    Escaping alone is not enough: the name is also this element's identity, so an
    empty or control-character name would produce a profile nothing can address
    again.
    """
    if not isinstance(name, str):
        raise GroundingError("matrix profile: name must be a string")
    cleaned: str = name.strip()
    if not cleaned:
        raise GroundingError("matrix profile: name must not be empty")
    if len(cleaned) > _NAME_MAX:
        raise GroundingError(f"matrix profile: name longer than {_NAME_MAX} characters")
    if any(ord(c) < _FIRST_PRINTABLE for c in cleaned):
        raise GroundingError("matrix profile: control characters in name")
    return cleaned


def _profile_re(name: str) -> re.Pattern[bytes]:
    """Match the whole ``<matrix_profile>`` element for one name, self-closing or not.

    The match includes the newline and indentation in front of the element so a
    delete leaves no blank line behind. The closing quote is part of the pattern,
    so ``Auteur`` never matches ``Auteur Classic``.
    """
    escaped = re.escape(attr_escape(name).encode())
    return re.compile(
        rb"\n?[ \t]*<matrix_profile\b[^>]*name=\"" + escaped + rb"\"(?:[^>]*/>|[^>]*>.*?</matrix_profile>)",
        re.DOTALL,
    )


def _profile_anchor(xml: bytes) -> tuple[int, bytes]:
    r"""(insert offset, the line lead of ``<matrix>``) for a new profile element.

    The offset is immediately before ``<matrix>``, where the daemon keeps its
    own. ``<matrix_profile>`` cannot be matched here — ``_`` is a word character,
    so ``\b`` excludes it.

    The lead is the newline plus indentation the matrix element sits on, so a
    written profile adopts the snapshot's own formatting; it is empty for a
    snapshot written on one line, which is then extended inline rather than
    refused.
    """
    m = next((c for c in re.finditer(rb"(?:\n([ \t]*))?<matrix\b", xml) if not in_comment(xml, c.end())), None)
    if m is None:  # pragma: no cover - unreachable: the caller runs ensure_element first
        raise GroundingError("the matrix element is absent from this snapshot")
    indent = m.group(1)
    return m.start(), b"" if indent is None else b"\n" + indent


def _live_post_process(xml: bytes) -> bytes:
    """Read the live ``<matrix>``'s ``<post_process>`` element, verbatim.

    b"" when the snapshot has no matrix body or the matrix carries no chain.

    Verbatim rather than re-serialized: the plugin attributes HQPTuner does not
    map are still the user's settings, and a profile that dropped them would hand
    back less than the matrix it was saved from.
    """
    try:
        start, close = matrix_body_span(xml)
    except GroundingError:
        return b""
    m = re.search(rb"<post_process\b[^>]*>.*?</post_process>", xml[start:close], re.DOTALL)
    return m.group(0) if m is not None else b""


def _profile_block(name: str, rows: list[dict[str, str]], lead: bytes, post: bytes) -> bytes:
    """Build a complete profile element, laid out like its ``<matrix>`` sibling.

    It carries the pipeline rows and the post-process chain that was live at save
    time.
    """
    open_tag = f'<matrix_profile name="{attr_escape(name)}">'.encode()
    row_lead = lead + b"\t" if lead else b""
    body = b"".join(row_lead + _pipeline_tag(i, row) for i, row in enumerate(rows))
    if post:
        body += row_lead + post
    return lead + open_tag + body + lead + b"</matrix_profile>"


def _validate_targets(raw: dict[str, Any], field: str) -> list[str]:
    """Return the payload's fan-out preset names.

    These are the stored presets the profile verb also applies to, beyond the
    config being edited. Optional; [] when absent.
    """
    presets = raw.get("presets", [])
    if not isinstance(presets, list) or any(not isinstance(p, str) for p in presets):
        raise GroundingError(f"{field}: presets must be a list of preset names")
    return presets


def _parse_save(value: str) -> dict[str, Any]:
    try:
        raw = json.loads(value)
    except ValueError as exc:
        raise GroundingError(f"{MATRIX_PROFILE_SAVE}: not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise GroundingError(f"{MATRIX_PROFILE_SAVE}: must be an object with name and rows")
    return raw


def parse_delete(value: str) -> tuple[str, list[str]]:
    """(name, fan-out targets) of a staged delete.

    The value is either the plain profile name (the original shape) or JSON
    ``{"name": ..., "presets": [...]}``; a value that does not parse as a JSON
    object is a plain name.
    """
    try:
        raw = json.loads(value)
    except ValueError:
        return _validate_name(value), []
    if isinstance(raw, dict) and "name" in raw:
        return _validate_name(raw.get("name")), _validate_targets(raw, MATRIX_PROFILE_DELETE)
    return _validate_name(value), []


def save_targets(value: str) -> list[str]:
    """Return the fan-out preset names of a staged save payload."""
    return _validate_targets(_parse_save(value), MATRIX_PROFILE_SAVE)


def write_profile(xml: bytes, value: str) -> bytes:
    """Insert — or replace, when the name is taken — one ``<matrix_profile>``.

    ``value`` is JSON ``{"name": str, "rows": [...]}`` plus an optional
    ``"presets"`` target list (validated here so a bad list refuses the whole
    apply, honoured by the fan-out in ``presetops``, ignored for this edit): the
    rows travel with the name because a save captures the matrix the user is
    looking at, which may be staged edits rather than anything the config
    currently holds. Replacement is how overwrite-save works at all; the
    daemon's own ``/matrix/save`` silently no-ops on an existing name (probe
    finding), ours does not.

    The post-process chain comes from the config's own live ``<matrix>``, never
    from the payload: what the user is looking at is the running chain, and the
    apply has already written its own post-process edits by the time a save is
    placed (``presetconf.apply_edits``) — including the active profile's chain,
    which that apply installed as the live one before touching anything.
    """
    raw = _parse_save(value)
    name = _validate_name(raw.get("name"))
    rows = _rows_from_list(raw.get("rows"), MATRIX_PROFILE_SAVE)
    _validate_targets(raw, MATRIX_PROFILE_SAVE)
    post = _live_post_process(xml)
    # profiles anchor off <matrix>; a config that never had matrix processing on
    # has none, so place it rather than refuse the save
    xml = ensure_element(xml, "matrix")
    at, lead = _profile_anchor(xml)
    block = _profile_block(name, rows, lead, post)
    existing = _profile_re(name).search(xml)
    if existing is not None:
        return xml[: existing.start()] + block + xml[existing.end() :]
    return xml[:at] + block + xml[at:]


def delete_profile(xml: bytes, name: str) -> bytes:
    """Remove one ``<matrix_profile>`` by name; every other byte preserved.

    A name that is not in the snapshot is a no-op rather than a GroundingError:
    the edit's whole intent is "this profile is not in the config", which such a
    snapshot already satisfies — and a profile the daemon holds in memory only
    (every profile saved through its own route, round 5) is exactly that case.
    """
    match = _profile_re(_validate_name(name)).search(xml)
    return xml if match is None else xml[: match.start()] + xml[match.end() :]


def _post_of(body: bytes) -> dict[str, str]:
    """One stored profile's ``<post_process>`` chain in form-field terms.

    ``{}`` for a profile carrying no chain, which is every profile saved before
    profiles stored one. Attributes outside ``PLUGIN_MAP`` are ignored here: they
    stay in the element (the write copies it verbatim) but HQPTuner has no field
    to hand them back through.
    """
    out: dict[str, str] = {}
    chain = re.search(rb"<post_process\b[^>]*>(.*?)</post_process>", body, re.DOTALL)
    if chain is None:
        return out
    for pm in re.finditer(rb"<plugin\b[^>]*?>", chain.group(1)):
        attrs = {k.decode(): v.decode() for k, v in re.findall(rb'(\w+)="([^"]*)"', pm.group(0))}
        ptype = attrs.get("type", "")
        for attr, value in attrs.items():
            field = _PLUGIN_FIELDS.get((ptype, attr))
            if field is not None:
                out[field] = attr_unescape(value)
    return out


_PROFILE_ELEMENT_RE = re.compile(rb"<matrix_profile\b[^>]*>.*?</matrix_profile>", re.DOTALL)


def _with_chain(element: bytes, post: bytes) -> bytes:
    """One profile element carrying ``post``, or itself unchanged when it already carries a chain.

    A profile that has one is the user's saved choice and never overwritten; the
    chain goes in ahead of the closing tag, indented like the rows it joins.
    """
    if b"<post_process" in element:
        return element
    close = element.rfind(b"</matrix_profile>")
    indent_m = re.search(rb"\n([ \t]*)<pipeline\b", element)
    lead = b"\n" + indent_m.group(1) if indent_m is not None else b"\n\t\t\t\t"
    return element[:close] + lead + post + element[close:]


def backfill_profile_chains(xml: bytes) -> bytes:
    """Give every saved profile carrying no ``<post_process>`` a verbatim copy of the live ``<matrix>``'s chain.

    A live switch installs a profile's whole matrix context, and one carrying no
    chain installs an EMPTY chain — crossfeed / DAC correction / loudness all
    drop in the running engine (measured, matrix-spec.md "Probe findings — form
    lane, checkbox encoding and the live lane"). Every profile saved before
    HQPTuner stored a chain is in that state; filling them from the matrix the
    user is running makes them behave like the ones saved since.

    A snapshot whose live ``<matrix>`` carries no chain comes back unchanged.
    Verbatim, for the same reason ``write_profile`` copies verbatim — the plugin
    attributes HQPTuner does not map are still the user's settings.
    """
    post = _live_post_process(xml)
    if not post:
        return xml
    return _PROFILE_ELEMENT_RE.sub(lambda m: _with_chain(m.group(0), post), xml)


def read_profiles(xml: bytes) -> str:
    """Every saved profile in the snapshot as canonical JSON.

    The shape is ``{name: {"rows": [...], "post": {field: value}}}``, sorted
    keys, compact separators. File truth for the picker, and the readback the
    apply's verify diff proves a save or a delete against.

    A profile is a whole matrix context, so ``post`` travels with ``rows``: it is
    the only plumbing carrying a stored chain to the browser, and a load has
    nothing to install without it.
    """
    out: dict[str, dict[str, Any]] = {}
    for m in re.finditer(rb"<matrix_profile\b([^>]*)>(.*?)</matrix_profile>", xml, re.DOTALL):
        name_m = re.search(rb'name="([^"]*)"', m.group(1))
        if name_m is not None:
            name = attr_unescape(name_m.group(1).decode())
            out[name] = {"rows": _rows_of(m.group(2)), "post": _post_of(m.group(2))}
    return json.dumps(out, sort_keys=True, separators=(",", ":"))
