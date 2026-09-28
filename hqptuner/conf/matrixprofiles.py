"""Saved ``<matrix_profile>`` persistence for a config-snapshot XML.

Saved profiles (``<matrix_profile name="...">``, readme §1.12) are written
here because **hqplayerd does not persist them itself**: ``POST /matrix/save``
registers a name in daemon memory, and the config file the daemon rewrites in
the same breath carries no such element, so the profile is gone at the next
daemon start. HQPTuner owns the element, which makes a save or a delete an
ordinary staged config edit on the restore lane and gives the daemon the
profiles back when it reads its config. Both verbs stage atomically, one field
each, same shape as the row set.

Profiles are written with the live pipeline table's row serializer, so a
profile and the matrix it was saved from are byte-identical — which is what
lets the apply's verify diff prove the element landed instead of trusting an
HTTP 200.
"""

from __future__ import annotations

import json
import re
from typing import TypedDict

from hqptuner.conf.matrixconf import PLUGIN_MAP, live_post_process, pipeline_tag, rows_of
from hqptuner.conf.matrixpayload import parse_save, validate_name
from hqptuner.conf.matrixscope import attr_escape, attr_unescape
from hqptuner.conf.xmledit import GroundingError, ensure_element, in_comment


class MatrixAbsentError(GroundingError):
    """The live ``<matrix>`` element is absent from this snapshot."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("the matrix element is absent from this snapshot", code="matrix-absent")


# One staged field per profile verb. Save carries {"name", "rows"} so the rows
# are the ones the user is looking at, not whatever the config happens to hold.
MATRIX_PROFILE_SAVE = "matrix_profile_save"
MATRIX_PROFILE_DELETE = "matrix_profile_delete"
# Readback field: every profile in the snapshot, as canonical JSON.
MATRIX_PROFILES = "matrix_profiles"

#: (plugin type, attribute) -> form field, for reading a stored chain back.
_PLUGIN_FIELDS: dict[tuple[str, str], str] = {loc: field for field, loc in PLUGIN_MAP.items()}


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
        raise MatrixAbsentError()
    indent = m.group(1)
    return m.start(), b"" if indent is None else b"\n" + indent


def _profile_block(name: str, rows: list[dict[str, str]], lead: bytes, post: bytes) -> bytes:
    """Build a complete profile element, laid out like its ``<matrix>`` sibling.

    It carries the pipeline rows and the post-process chain that was live at save
    time.
    """
    open_tag = f'<matrix_profile name="{attr_escape(name)}">'.encode()
    row_lead = lead + b"\t" if lead else b""
    body = b"".join(row_lead + pipeline_tag(i, row) for i, row in enumerate(rows))
    if post:
        body += row_lead + post
    return lead + open_tag + body + lead + b"</matrix_profile>"


def save_targets(value: str) -> list[str]:
    """Return the fan-out preset names of a staged save payload."""
    return parse_save(value).presets


def write_profile(xml: bytes, value: str) -> bytes:
    """Insert — or replace, when the name is taken — one ``<matrix_profile>``.

    ``value`` is JSON ``{"name": str, "rows": [...]}`` plus an optional
    ``"presets"`` target list (validated here so a bad list refuses the whole
    apply, ignored for this edit): the rows travel with the name because a save
    captures the matrix the user is looking at, which may be staged edits rather
    than anything the config currently holds. Replacement is how overwrite-save
    works: the daemon's own ``/matrix/save`` silently no-ops on an existing name.

    The post-process chain comes from the config's own live ``<matrix>``, never
    from the payload: what the user is looking at is the running chain, and an
    apply writes its post-process edits before it places a save — including the
    active profile's chain, which the apply installs as the live one before any
    other edit.
    """
    payload = parse_save(value)
    post = live_post_process(xml)
    # profiles anchor off <matrix>; a config that never had matrix processing on
    # has none, so place it rather than refuse the save
    xml, _ = ensure_element(xml, "matrix")
    at, lead = _profile_anchor(xml)
    block = _profile_block(payload.name, payload.rows, lead, post)
    existing = _profile_re(payload.name).search(xml)
    if existing is not None:
        return xml[: existing.start()] + block + xml[existing.end() :]
    return xml[:at] + block + xml[at:]


def delete_profile(xml: bytes, name: str) -> bytes:
    """Remove one ``<matrix_profile>`` by name; every other byte preserved.

    A name that is not in the snapshot is a no-op rather than a GroundingError:
    the edit's whole intent is "this profile is not in the config", which such a
    snapshot already satisfies — and a profile the daemon holds in memory only
    (every profile saved through the daemon's own ``/matrix/save``) is exactly
    that case.
    """
    match = _profile_re(validate_name(name)).search(xml)
    return xml if match is None else xml[: match.start()] + xml[match.end() :]


def _post_of(body: bytes) -> dict[str, str]:
    """One stored profile's ``<post_process>`` chain in form-field terms.

    ``{}`` for a profile carrying no chain. Attributes outside ``PLUGIN_MAP`` are
    ignored here; they stay in the element because the write copies it verbatim,
    with no HQPTuner field to hand them back through.
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
    chain installs an EMPTY chain: crossfeed, DAC correction and loudness all
    drop in the running engine. Filling a chainless profile from the matrix the
    user is running makes it behave like one saved with a chain.

    A snapshot whose live ``<matrix>`` carries no chain comes back unchanged.
    Verbatim, for the same reason ``write_profile`` copies verbatim — the plugin
    attributes HQPTuner does not map are still the user's settings.
    """
    post = live_post_process(xml)
    if not post:
        return xml
    return _PROFILE_ELEMENT_RE.sub(lambda m: _with_chain(m.group(0), post), xml)


def profile_names(xml: bytes) -> set[str]:
    """Every saved profile's name, off the same regex ``read_profiles`` walks."""
    names: set[str] = set()
    for m in re.finditer(rb"<matrix_profile\b([^>]*)>(.*?)</matrix_profile>", xml, re.DOTALL):
        name_m = re.search(rb'name="([^"]*)"', m.group(1))
        if name_m is not None:
            names.add(attr_unescape(name_m.group(1).decode()))
    return names


class StoredProfile(TypedDict):
    """One saved profile as ``read_profiles`` serializes it: its pipeline rows and its post-process chain."""

    rows: list[dict[str, str]]
    post: dict[str, str]


def read_profiles(xml: bytes) -> str:
    """Every saved profile in the snapshot as canonical JSON.

    The shape is ``{name: {"rows": [...], "post": {field: value}}}``, sorted
    keys, compact separators. File truth for the picker, and the readback the
    apply's verify diff proves a save or a delete against.

    A profile is a whole matrix context, so ``post`` travels with ``rows``: it is
    the only plumbing carrying a stored chain to the browser, and a load has
    nothing to install without it.
    """
    out: dict[str, StoredProfile] = {}
    for m in re.finditer(rb"<matrix_profile\b([^>]*)>(.*?)</matrix_profile>", xml, re.DOTALL):
        name_m = re.search(rb'name="([^"]*)"', m.group(1))
        if name_m is not None:
            name = attr_unescape(name_m.group(1).decode())
            out[name] = {"rows": rows_of(m.group(2)), "post": _post_of(m.group(2))}
    return json.dumps(out, sort_keys=True, separators=(",", ":"))
