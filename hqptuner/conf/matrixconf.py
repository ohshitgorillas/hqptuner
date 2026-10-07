"""Matrix pipeline-table and saved-profile editing for a config-snapshot XML.

Sibling of ``engineconf``/``presetconf``: the ``<pipeline>`` children of
``<matrix>`` are the one multi-instance element HQPTuner writes, and rows are
added/removed as a set — the daemon accepts only complete pipeline tables — so
the whole set stages as ONE atomic field: ``matrix_pipelines``, a JSON array of
{source, gain, gainunit, mixdown, process} rows. Gain serializes bare = dB,
``L``-prefixed = linear, and negative linear = polarity inversion
(``protocol.md`` "Matrix form fields").

This module edits the live ``<matrix>`` pipeline table and its post-process
chain. Its row serializer and live-chain reader also serve saved profiles
(``<matrix_profile name="...">``, readme §1.12), so a profile is
byte-identical to the matrix it was saved from.

``GroundingError`` lives in ``xmledit`` (the lowest layer, where the shared
locators are).
"""

from __future__ import annotations

import json
import re

from hqptuner.conf.matrixpayload import rows_from_list
from hqptuner.conf.matrixscope import (
    attr_escape,
    attr_unescape,
    find_matrix_body_span,
    matrix_body_span,
    matrix_scope,
)
from hqptuner.conf.xmledit import GroundingError, ensure_body


class PipelinesBadJsonError(GroundingError):
    """``matrix_pipelines`` did not parse as JSON at all."""

    def __init__(self, *, error: ValueError) -> None:
        """Render the wording naming the underlying JSON error."""
        super().__init__(f"{MATRIX_PIPELINES}: not valid JSON: {error}", code="rows-bad-json")


MATRIX_PIPELINES = "matrix_pipelines"

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


def _validate_rows(value: str) -> list[dict[str, str]]:
    try:
        raw = json.loads(value)
    except ValueError as exc:
        raise PipelinesBadJsonError(error=exc) from exc
    return rows_from_list(raw, MATRIX_PIPELINES)


def pipeline_tag(channel: int, row: dict[str, str]) -> bytes:
    """One ``<pipeline/>`` element, attributes in the daemon's alphabetical order.

    That ordering keeps a readback diff against the daemon's own serialization
    byte-clean.
    """
    gain = f"L{row['gain']}" if row["gainunit"] == "Lin" else row["gain"]
    return (
        f'<pipeline channel="{channel}" gain="{gain}" mixdown="{row["mixdown"]}" '
        f'process="{attr_escape(row["process"])}" source="{row["source"]}"/>'
    ).encode()


def rows_of(body: bytes) -> list[dict[str, str]]:
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
    xml, _ = ensure_body(xml, "matrix")
    start, close = matrix_body_span(xml)
    body = xml[start:close]
    indent_m = re.search(rb"\n([ \t]*)<pipeline\b", body)
    indent = indent_m.group(1) if indent_m else b"\t\t\t"
    stripped = re.sub(rb"\n?[ \t]*<pipeline\b[^>]*/>", b"", body)
    block = b"".join(b"\n" + indent + pipeline_tag(i, row) for i, row in enumerate(rows))
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
    rows = rows_of(scope)
    if rows:
        xml = _replace_pipelines_here(xml, rows)
    return _replace_post_process(xml, live_post_process(scope))


def _replace_post_process(xml: bytes, post: bytes) -> bytes:
    """Put ``post`` in the live ``<matrix>``, replacing any chain already there.

    An empty ``post`` clears the chain, which is what a profile carrying none
    means: nothing of the previous matrix's processing should survive it.
    """
    xml, _ = ensure_body(xml, "matrix")
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
    span = find_matrix_body_span(xml)
    if span is None:
        return None
    start, close = span
    return json.dumps(rows_of(xml[start:close]), sort_keys=True, separators=(",", ":"))


def live_post_process(xml: bytes) -> bytes:
    """Read the live ``<matrix>``'s ``<post_process>`` element, verbatim.

    b"" when the snapshot has no matrix body or the matrix carries no chain.

    Verbatim rather than re-serialized: the plugin attributes HQPTuner does not
    map are still the user's settings, and a profile that dropped them would hand
    back less than the matrix it was saved from.

    A saved profile carries this chain as its own.
    """
    span = find_matrix_body_span(xml)
    if span is None:
        return b""
    start, close = span
    m = re.search(rb"<post_process\b[^>]*>.*?</post_process>", xml[start:close], re.DOTALL)
    return m.group(0) if m is not None else b""
