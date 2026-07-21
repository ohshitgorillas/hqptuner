"""Matrix pipeline-table editing for a config-snapshot XML (matrix-spec §8 step 3).

Sibling of ``engineconf``/``presetconf``: the ``<pipeline>`` children of
``<matrix>`` are the one multi-instance element HQPTuner writes, and rows are
added/removed as a set — the daemon accepts only complete pipeline tables
(matrix-spec probe findings) — so the whole set stages as ONE atomic field:
``matrix_pipelines``, a JSON array of {source, gain, gainunit, mixdown, process}
rows. Gain serializes bare = dB, ``L``-prefixed = linear (probe-verified;
negative linear = polarity inversion).

``GroundingError`` lives here (lowest layer) and is re-exported by ``presetconf``
for its existing importers.
"""

from __future__ import annotations

import json
import re
from typing import Any

MATRIX_PIPELINES = "matrix_pipelines"
_GAIN_RE = re.compile(r"^-?\d+(\.\d+)?$")
_MAX_CHANNELS = 128

# minimal XML attribute escaping for the process string (order matters on unescape)
_ATTR_ESCAPES = (("&", "&amp;"), ("<", "&lt;"), (">", "&gt;"), ('"', "&quot;"))


class GroundingError(ValueError):
    """An edit whose target element or plugin is absent from this snapshot — a
    guessed write is never attempted."""


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
    m = re.search(rb"<matrix\b[^>]*>", xml)
    if m is None or m.group(0).endswith(b"/>"):
        raise GroundingError("<matrix> element (with a body) absent from this snapshot")
    close = xml.find(b"</matrix>", m.end())
    if close == -1:
        raise GroundingError("<matrix> element (with a body) absent from this snapshot")
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


def _validate_rows(value: str) -> list[dict[str, str]]:
    try:
        raw = json.loads(value)
    except ValueError as exc:
        raise GroundingError(f"matrix_pipelines: not valid JSON: {exc}") from exc
    if not isinstance(raw, list) or not 1 <= len(raw) <= _MAX_CHANNELS:
        raise GroundingError("matrix_pipelines: must be a list of 1..128 rows")
    return [_validate_row(r) for r in raw]


def _pipeline_tag(channel: int, row: dict[str, str]) -> bytes:
    """One ``<pipeline/>`` element, attributes in the daemon's alphabetical order
    so a readback diff against the daemon's own serialization stays byte-clean."""
    gain = f"L{row['gain']}" if row["gainunit"] == "Lin" else row["gain"]
    return (
        f'<pipeline channel="{channel}" gain="{gain}" mixdown="{row["mixdown"]}" '
        f'process="{_attr_escape(row["process"])}" source="{row["source"]}"/>'
    ).encode()


def replace_pipelines(xml: bytes, value: str) -> bytes:
    """Replace the ``<matrix>`` element's ``<pipeline>`` children wholesale with
    the staged row set. Everything else in the matrix body (``<post_process>``)
    and every byte outside it are preserved; indentation is taken from the
    existing rows so the daemon's own formatting survives."""
    rows = _validate_rows(value)
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
    rows = []
    for pm in re.finditer(rb"<pipeline\b[^>]*/>", xml[start:close]):
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
    return json.dumps(rows, sort_keys=True, separators=(",", ":"))
