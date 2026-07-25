"""Byte-faithful primitives for editing hqplayerd's config XML in place.

Split out of ``presetconf`` when that file passed the 500-line gate. The seam is
the one the module's own header already argued for: two axes — element vs
plugin, read vs write — are four operations built from two locators and two
attribute primitives, not four hand-written regex pairs. The open-tag and
attribute patterns are spelled ONCE here; retyping ``rb"<TAG\\b[^>]*?/?>"`` per
call site is how one copy quietly stops matching a self-closing tag while its
siblings still do.

Nothing here parses XML properly, and that is deliberate: a full re-serialize
(lxml/ElementTree) reorders attributes and drops formatting, which is not a
thing to do to a live production config. Every edit replaces exactly the bytes
of one open tag.
"""

from __future__ import annotations

import re
from collections.abc import Iterator

from .matrixconf import GroundingError


def open_tag_re(tag_name: str) -> re.Pattern[bytes]:
    """Matches an element's open tag, self-closing or not."""
    return re.compile(rb"<" + re.escape(tag_name.encode()) + rb"\b[^>]*?/?>")


def attr_re(attr: str) -> re.Pattern[bytes]:
    """Matches ``attr="value"`` within an open tag, capturing the value."""
    return re.compile(rb"\b" + re.escape(attr.encode()) + rb'="([^"]*)"')


def in_comment(xml: bytes, pos: int) -> bool:
    """True when byte offset ``pos`` sits inside an XML ``<!-- -->`` comment."""
    return xml.rfind(b"<!--", 0, pos) > xml.rfind(b"-->", 0, pos)


def live_tags(xml: bytes, tag_name: str) -> Iterator[re.Match[bytes]]:
    """Every ``<tag_name ...>`` open tag that is NOT inside an XML comment.

    hqplayerd parks superseded elements in comments and leaves them ABOVE the
    live one (a real config carries a commented ``<alsa .../>`` from a previous
    device). A first-match locator lands in that comment: the read reports a dead
    device, the write edits dead bytes, and since the readback re-reads the same
    comment the apply verifies as converged while nothing changed."""
    return (m for m in open_tag_re(tag_name).finditer(xml) if not in_comment(xml, m.start()))


def find_element(xml: bytes, tag_name: str) -> re.Match[bytes] | None:
    """The single live ``<tag_name ...>`` open tag."""
    return next(live_tags(xml, tag_name), None)


def find_plugin(xml: bytes, plugin_type: str) -> re.Match[bytes] | None:
    """The live ``<plugin type="plugin_type" ...>`` open tag inside
    ``<post_process>`` (there are several plugins; match by type)."""
    needle = f'type="{plugin_type}"'.encode()
    return next((m for m in live_tags(xml, "plugin") if needle in m.group(0)), None)


def get_attr(tag: bytes, attr: str) -> str | None:
    """Read ``attr`` off an element's open-tag bytes; None when absent."""
    m = attr_re(attr).search(tag)
    return m.group(1).decode() if m else None


def set_attr(tag: bytes, attr: str, value: str) -> bytes:
    """Set ``attr="value"`` on an element's open-tag bytes — replacing in place
    when present, inserting right after the tag name otherwise. Byte-faithful:
    nothing else in the tag moves."""
    replacement = f'{attr}="{value}"'.encode()
    pat = attr_re(attr)
    if pat.search(tag):
        # a function replacement, never the bytes directly: re.sub reads escapes
        # (\1, \g<n>, \\) out of a template, and a config value legitimately
        # carries backslashes — a Windows-style log path would be corrupted or
        # raise "bad escape" mid-apply
        return pat.sub(lambda _: replacement, tag, count=1)
    name = re.match(rb"<[\w:.-]+", tag)
    if name is None:  # not an open tag — unreachable for the tags we match
        raise GroundingError("malformed element tag")
    cut = name.end()
    return tag[:cut] + b" " + replacement + tag[cut:]


def splice(xml: bytes, at: re.Match[bytes], tag: bytes) -> bytes:
    """Replace the matched open tag with ``tag``; every other byte preserved."""
    return xml[: at.start()] + tag + xml[at.end() :]


def edit_element(xml: bytes, tag_name: str, attr: str, value: str) -> bytes:
    """Apply one attribute edit to the single ``<tag_name ...>`` element."""
    m = find_element(xml, tag_name)
    if m is None:
        raise GroundingError(f"<{tag_name}> element absent from this snapshot")
    return splice(xml, m, set_attr(m.group(0), attr, value))


def edit_plugin(xml: bytes, plugin_type: str, attr: str, value: str) -> bytes:
    """Apply one attribute edit to the ``<plugin type="plugin_type" ...>``."""
    m = find_plugin(xml, plugin_type)
    if m is None:
        raise GroundingError(f'<plugin type="{plugin_type}"> absent from this snapshot')
    return splice(xml, m, set_attr(m.group(0), attr, value))
