"""Matrix pipeline-table and saved-profile editing for a config-snapshot XML
(matrix-spec §8 step 3; profile persistence, round 5).

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

from .xmledit import GroundingError, ensure_body, ensure_element, in_comment

MATRIX_PIPELINES = "matrix_pipelines"
# One staged field per profile verb. Save carries {"name", "rows"} so the rows
# are the ones the user is looking at, not whatever the config happens to hold.
MATRIX_PROFILE_SAVE = "matrix_profile_save"
MATRIX_PROFILE_DELETE = "matrix_profile_delete"
# Readback field: every profile in the snapshot, as canonical JSON.
MATRIX_PROFILES = "matrix_profiles"

_GAIN_RE = re.compile(r"^-?\d+(\.\d+)?$")
_MAX_CHANNELS = 128
_NAME_MAX = 128

# minimal XML attribute escaping for the process string (order matters on unescape)
# ``&apos;`` is in the table because the DAEMON writes it: an apostrophe in a
# process string or a profile name comes back as the entity, and a table that
# cannot unescape it reads the literal "&apos;" as the value — which then never
# matches what was written, so the apply can never converge.
_ATTR_ESCAPES = (("&", "&amp;"), ("<", "&lt;"), (">", "&gt;"), ('"', "&quot;"), ("'", "&apos;"))


def _attr_escape(value: str) -> str:
    for ch, ent in _ATTR_ESCAPES:
        value = value.replace(ch, ent)
    return value


def _attr_unescape(value: str) -> str:
    for ch, ent in reversed(_ATTR_ESCAPES):
        value = value.replace(ent, ch)
    return value


def _matrix_body_span(xml: bytes) -> tuple[int, int]:
    """(start, end) byte offsets of the ``<matrix>`` element's body."""
    # a commented element is not the live one — same rule the shared locators
    # follow (xmledit.live_tags); hqplayerd parks superseded blocks in comments
    m = next((c for c in re.finditer(rb"<matrix\b[^>]*>", xml) if not in_comment(xml, c.start())), None)
    if m is None or m.group(0).endswith(b"/>"):
        raise GroundingError("the matrix element has no body in this snapshot")
    close = xml.find(b"</matrix>", m.end())
    if close == -1:
        raise GroundingError("the matrix element has no body in this snapshot")
    return m.end(), close


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
    if any(ord(c) < 0x20 for c in process):
        raise GroundingError("matrix_pipelines: control characters in process string")
    return {"source": str(source), "gain": gain, "gainunit": unit, "mixdown": str(mixdown), "process": process}


def _rows_from_list(raw: Any, field: str) -> list[dict[str, str]]:
    """A validated row set from an already-parsed list. Shared by the pipeline
    table and a saved profile — one row contract, so a profile can never hold a
    row the live table would have refused."""
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
    """One ``<pipeline/>`` element, attributes in the daemon's alphabetical order
    so a readback diff against the daemon's own serialization stays byte-clean."""
    gain = f"L{row['gain']}" if row["gainunit"] == "Lin" else row["gain"]
    return (
        f'<pipeline channel="{channel}" gain="{gain}" mixdown="{row["mixdown"]}" '
        f'process="{_attr_escape(row["process"])}" source="{row["source"]}"/>'
    ).encode()


def _rows_of(body: bytes) -> list[dict[str, str]]:
    """The ``<pipeline>`` rows of one element body, in form-field terms. One
    parser for the live table and for a saved profile."""
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
                "process": _attr_unescape(attrs.get("process", "")),
            }
        )
    return rows


def replace_pipelines(xml: bytes, value: str) -> bytes:
    """Replace the ``<matrix>`` element's ``<pipeline>`` children wholesale with
    the staged row set. Everything else in the matrix body (``<post_process>``)
    and every byte outside it are preserved; indentation is taken from the
    existing rows so the daemon's own formatting survives."""
    rows = _validate_rows(value)
    # a config whose matrix was never configured carries no <matrix> body at all;
    # the rows the user just built are what puts one there
    xml = ensure_body(xml, "matrix")
    start, close = _matrix_body_span(xml)
    body = xml[start:close]
    indent_m = re.search(rb"\n([ \t]*)<pipeline\b", body)
    indent = indent_m.group(1) if indent_m else b"\t\t\t"
    stripped = re.sub(rb"\n?[ \t]*<pipeline\b[^>]*/>", b"", body)
    block = b"".join(b"\n" + indent + _pipeline_tag(i, row) for i, row in enumerate(rows))
    return xml[:start] + block + stripped + xml[close:]


def read_pipelines(xml: bytes) -> str | None:
    """The ``<matrix>`` element's pipeline rows as canonical JSON (sorted keys,
    compact separators), or None when the snapshot has no matrix body. Canonical
    on both sides of the verify diff — intended and realized configs run through
    this same serialization, so equality means the daemon accepted the rows."""
    try:
        start, close = _matrix_body_span(xml)
    except GroundingError:
        return None
    return json.dumps(_rows_of(xml[start:close]), sort_keys=True, separators=(",", ":"))


# --- saved profiles (<matrix_profile name="...">, readme §1.12) --------------


def _validate_name(name: Any) -> str:
    """A profile name fit for an XML attribute. Escaping alone is not enough:
    the name is also this element's identity, so an empty or control-character
    name would produce a profile nothing can address again."""
    if not isinstance(name, str):
        raise GroundingError("matrix profile: name must be a string")
    cleaned: str = name.strip()
    if not cleaned:
        raise GroundingError("matrix profile: name must not be empty")
    if len(cleaned) > _NAME_MAX:
        raise GroundingError(f"matrix profile: name longer than {_NAME_MAX} characters")
    if any(ord(c) < 0x20 for c in cleaned):
        raise GroundingError("matrix profile: control characters in name")
    return cleaned


def _profile_re(name: str) -> re.Pattern[bytes]:
    """The whole ``<matrix_profile>`` element for one name, self-closing or not,
    including the newline and indentation in front of it so a delete leaves no
    blank line behind. The closing quote is part of the pattern, so ``Auteur``
    never matches ``Auteur Classic``."""
    escaped = re.escape(_attr_escape(name).encode())
    return re.compile(
        rb"\n?[ \t]*<matrix_profile\b[^>]*name=\"" + escaped + rb"\"(?:[^>]*/>|[^>]*>.*?</matrix_profile>)",
        re.DOTALL,
    )


def _profile_anchor(xml: bytes) -> tuple[int, bytes]:
    """(insert offset, the line lead of ``<matrix>``) for a new profile element:
    immediately before ``<matrix>``, where the daemon keeps its own.
    ``<matrix_profile>`` cannot be matched here — ``_`` is a word character, so
    ``\\b`` excludes it.

    The lead is the newline plus indentation the matrix element sits on, so a
    written profile adopts the snapshot's own formatting; it is empty for a
    snapshot written on one line, which is then extended inline rather than
    refused."""
    m = next((c for c in re.finditer(rb"(?:\n([ \t]*))?<matrix\b", xml) if not in_comment(xml, c.end())), None)
    if m is None:
        raise GroundingError("the matrix element is absent from this snapshot")
    indent = m.group(1)
    return m.start(), b"" if indent is None else b"\n" + indent


def _profile_block(name: str, rows: list[dict[str, str]], lead: bytes) -> bytes:
    """A complete profile element, laid out like its ``<matrix>`` sibling."""
    open_tag = f'<matrix_profile name="{_attr_escape(name)}">'.encode()
    row_lead = lead + b"\t" if lead else b""
    body = b"".join(row_lead + _pipeline_tag(i, row) for i, row in enumerate(rows))
    return lead + open_tag + body + lead + b"</matrix_profile>"


def write_profile(xml: bytes, value: str) -> bytes:
    """Insert — or replace, when the name is taken — one ``<matrix_profile>``.

    ``value`` is JSON ``{"name": str, "rows": [...]}``: the rows travel with the
    name because a save captures the matrix the user is looking at, which may be
    staged edits rather than anything the config currently holds. Replacement is
    how overwrite-save works at all; the daemon's own ``/matrix/save`` silently
    no-ops on an existing name (probe finding), ours does not."""
    try:
        raw = json.loads(value)
    except ValueError as exc:
        raise GroundingError(f"{MATRIX_PROFILE_SAVE}: not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise GroundingError(f"{MATRIX_PROFILE_SAVE}: must be an object with name and rows")
    name = _validate_name(raw.get("name"))
    rows = _rows_from_list(raw.get("rows"), MATRIX_PROFILE_SAVE)
    # profiles anchor off <matrix>; a config that never had matrix processing on
    # has none, so place it rather than refuse the save
    xml = ensure_element(xml, "matrix")
    at, lead = _profile_anchor(xml)
    block = _profile_block(name, rows, lead)
    existing = _profile_re(name).search(xml)
    if existing is not None:
        return xml[: existing.start()] + block + xml[existing.end() :]
    return xml[:at] + block + xml[at:]


def delete_profile(xml: bytes, name: str) -> bytes:
    """Remove one ``<matrix_profile>`` by name; every other byte preserved.

    A name that is not in the snapshot is a no-op rather than a GroundingError:
    the edit's whole intent is "this profile is not in the config", which such a
    snapshot already satisfies — and a profile the daemon holds in memory only
    (every profile saved through its own route, round 5) is exactly that case."""
    match = _profile_re(_validate_name(name)).search(xml)
    return xml if match is None else xml[: match.start()] + xml[match.end() :]


def read_profiles(xml: bytes) -> str:
    """Every saved profile in the snapshot as canonical JSON — ``{name: rows}``,
    sorted keys, compact separators. File truth for the picker, and the readback
    the apply's verify diff proves a save or a delete against."""
    out: dict[str, list[dict[str, str]]] = {}
    for m in re.finditer(rb"<matrix_profile\b([^>]*)>(.*?)</matrix_profile>", xml, re.DOTALL):
        name_m = re.search(rb'name="([^"]*)"', m.group(1))
        if name_m is not None:
            out[_attr_unescape(name_m.group(1).decode())] = _rows_of(m.group(2))
    return json.dumps(out, sort_keys=True, separators=(",", ":"))
