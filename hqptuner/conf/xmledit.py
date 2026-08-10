r"""Byte-faithful primitives for editing hqplayerd's config XML in place.

Two axes — element vs plugin, read vs write — are four operations built from
two locators and two attribute primitives, not four hand-written regex pairs.
The open-tag and
attribute patterns are spelled ONCE here; retyping ``rb"<TAG\b[^>]*?/?>"`` per
call site is how one copy quietly stops matching a self-closing tag while its
siblings still do.

Nothing here parses XML properly, and that is deliberate: a full re-serialize
(lxml/ElementTree) reorders attributes and drops formatting, which is not a
thing to do to a live production config. Every edit replaces exactly the bytes
of one open tag.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterator


class GroundingError(ValueError):
    """An edit that cannot be placed in this snapshot at all.

    A merely *absent* target is no longer one of these — it is created (see
    ``PARENT``). What remains are the cases with no defensible answer: a snapshot
    with no root element, a tag with no known schema position, an unknown form
    field, a malformed value.

    Lives here, at the bottom of the layering, because both editing modules raise
    it and the locators are shared. Message text is user-facing (it reaches the
    pending bar) and must therefore carry no angle-bracketed token: a browser —
    or a chat client the user pastes into — eats ``<alsa>`` as markup and leaves
    the reader the half of the sentence that says nothing.
    """


ROOT = "hqplayerd"

# Where each element hqptuner writes sits in hqplayerd's config tree, transcribed
# from a live 6.0.4 config (/etc/hqplayer/hqplayerd.xml) and the daemon readme.
#
# This map exists because hqplayerd writes only what it has had reason to write:
# a config that never had loudness configured carries no <plugin type="loudness">,
# and one that never had matrix processing on carries no <matrix> body. The daemon
# fills none of it back in on load — it just runs with its documented defaults. So
# a write path that can only edit what already exists cannot reach roughly half
# of its own form on a config like that.
PARENT: dict[str, str] = {
    "title": ROOT,
    "output": ROOT,
    "mode": ROOT,
    "pcm": ROOT,
    "sdm": ROOT,
    "log": ROOT,
    "upnp": ROOT,
    "engine": ROOT,
    "defaults": "engine",
    "alsa": "engine",
    "network": "engine",
    "matrix": "engine",
    "post_process": "matrix",
}


def open_tag_re(tag_name: str) -> re.Pattern[bytes]:
    """Match an element's open tag, self-closing or not."""
    return re.compile(rb"<" + re.escape(tag_name.encode()) + rb"\b[^>]*?/?>")


def attr_re(attr: str) -> re.Pattern[bytes]:
    """Match ``attr="value"`` within an open tag, capturing the value."""
    return re.compile(rb"\b" + re.escape(attr.encode()) + rb'="([^"]*)"')


def in_comment(xml: bytes, pos: int) -> bool:
    """Report whether byte offset ``pos`` sits inside an XML ``<!-- -->`` comment."""
    return xml.rfind(b"<!--", 0, pos) > xml.rfind(b"-->", 0, pos)


#: A whole stored ``<matrix_profile>`` element (readme §1.12), self-closing or
#: not. A profile is a stored matrix, so it carries ``<pipeline>`` rows and a
#: ``<post_process>`` chain of its own — elements that share their tag names
#: with the live matrix's.
_STORED_PROFILE_RE = re.compile(
    rb"<matrix_profile\b(?:[^>]*/>|[^>]*>.*?</matrix_profile>)",
    re.DOTALL,
)


def _stored_profile_spans(xml: bytes) -> list[tuple[int, int]]:
    return [m.span() for m in _STORED_PROFILE_RE.finditer(xml)]


def live_tags(xml: bytes, tag_name: str) -> Iterator[re.Match[bytes]]:
    """Every live ``<tag_name ...>`` open tag in the document.

    Live means NOT inside an XML comment and NOT inside a stored
    ``<matrix_profile>``.

    hqplayerd parks superseded elements in comments and leaves them ABOVE the
    live one (a real config carries a commented ``<alsa .../>`` from a previous
    device). A first-match locator lands in that comment: the read reports a dead
    device, the write edits dead bytes, and since the readback re-reads the same
    comment the apply verifies as converged while nothing changed.

    A stored profile is the same trap without the comment. Profiles are written
    AHEAD of ``<matrix>``, so once one carries its own ``<post_process>`` the
    first live ``<plugin>`` in the document belongs to the profile, not to the
    matrix that is playing — every plugin read and every plugin write would land
    in the stored copy.
    """
    spans = _stored_profile_spans(xml)
    return (
        m
        for m in open_tag_re(tag_name).finditer(xml)
        if not in_comment(xml, m.start()) and not any(s <= m.start() < e for s, e in spans)
    )


def find_element(xml: bytes, tag_name: str) -> re.Match[bytes] | None:
    """Find the single live ``<tag_name ...>`` open tag."""
    return next(live_tags(xml, tag_name), None)


def find_plugin(xml: bytes, plugin_type: str) -> re.Match[bytes] | None:
    """Find the live ``<plugin type="plugin_type" ...>`` open tag inside ``<post_process>``.

    There are several plugins; match by type.
    """
    needle = f'type="{plugin_type}"'.encode()
    return next((m for m in live_tags(xml, "plugin") if needle in m.group(0)), None)


def get_attr(tag: bytes, attr: str) -> str | None:
    """Read ``attr`` off an element's open-tag bytes; None when absent."""
    m = attr_re(attr).search(tag)
    return m.group(1).decode() if m else None


def set_attr(tag: bytes, attr: str, value: str) -> bytes:
    """Set ``attr="value"`` on an element's open-tag bytes.

    Replaces in place when present, inserting right after the tag name otherwise.
    Byte-faithful: nothing else in the tag moves.
    """
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


def line_lead(xml: bytes, at: int) -> bytes:
    """Return the indentation of the line byte offset ``at`` sits on.

    Empty when that line holds anything but whitespace before ``at`` (a
    single-line config).
    """
    start = xml.rfind(b"\n", 0, at) + 1
    lead = xml[start:at]
    return lead if lead.strip() == b"" else b""


def _insert_child(xml: bytes, parent: str, child: bytes) -> bytes:
    """Append ``child`` as the last child of ``parent``, which must have a body.

    The child is indented one level in from the parent's own line.

    Last, not first: appending never splits a run the daemon wrote, and for the
    elements that actually go missing — ``matrix``, ``post_process``, a
    ``plugin`` — last IS where 6.0.4 puts them.
    """
    m = find_element(xml, parent)
    if m is None:  # unreachable: every caller runs ensure_body first
        raise GroundingError(f"the {parent} element is absent from this snapshot")
    close = xml.find(b"</" + parent.encode() + b">", m.end())
    bol = xml.rfind(b"\n", 0, close) + 1
    # when the closing tag sits on its own line, go in ahead of that line's break
    # so the child lands inside the body rather than wedged against `</parent>`
    at = bol - 1 if bol and xml[bol:close].strip() == b"" else close
    return xml[:at] + b"\n" + line_lead(xml, m.start()) + b"\t" + child + xml[at:]


def ensure_element(xml: bytes, tag_name: str) -> bytes:
    """Return ``xml`` guaranteed to hold a live ``<tag_name>``.

    The element — and any missing ancestor — is created at its schema position.

    The created element carries NO attributes. Every attribute hqplayerd omits is
    one it is already applying its own documented default for, so authoring a
    "complete" element would silently overwrite the user's daemon-side settings
    with our idea of them. Only the attribute the user actually set gets written,
    by the caller, immediately after.
    """
    if find_element(xml, tag_name) is not None:
        return xml
    if tag_name == ROOT:
        raise GroundingError("this snapshot has no hqplayerd root element")
    parent = PARENT.get(tag_name)
    if parent is None:
        raise GroundingError(f"there is no known place in the config for the {tag_name} element")
    return _insert_child(ensure_body(xml, parent), parent, b"<" + tag_name.encode() + b"/>")


def ensure_body(xml: bytes, tag_name: str) -> bytes:
    """As ``ensure_element``, and additionally give ``<tag_name>`` a body.

    A self-closing ``<tag_name/>`` is expanded into an open/close pair so
    children can be placed in it.
    """
    xml = ensure_element(xml, tag_name)
    m = find_element(xml, tag_name)
    if m is None or not m.group(0).endswith(b"/>"):
        return xml
    return splice(xml, m, m.group(0)[:-2] + b"></" + tag_name.encode() + b">")


def ensure_plugin(xml: bytes, plugin_type: str) -> bytes:
    """Return ``xml`` guaranteed to hold ``<plugin type="plugin_type">``.

    The plugin — and ``<post_process>``, and ``<matrix>`` — is created when absent.
    """
    if find_plugin(xml, plugin_type) is not None:
        return xml
    xml = ensure_body(xml, "post_process")
    return _insert_child(xml, "post_process", f'<plugin type="{plugin_type}"/>'.encode())


def edit_element(xml: bytes, tag_name: str, attr: str, value: str) -> bytes:
    """Apply one attribute edit to the single ``<tag_name ...>`` element.

    The element is created at its schema position when the snapshot lacks it.
    """
    xml = ensure_element(xml, tag_name)
    m = find_element(xml, tag_name)
    if m is None:  # unreachable: ensure_element either placed it or raised
        raise GroundingError(f"the {tag_name} element is absent from this snapshot")
    return splice(xml, m, set_attr(m.group(0), attr, value))


def edit_plugin(xml: bytes, plugin_type: str, attr: str, value: str) -> bytes:
    """Apply one attribute edit to the ``<plugin type="plugin_type" ...>``.

    The plugin (and its container) is created when the snapshot lacks it.
    """
    xml = ensure_plugin(xml, plugin_type)
    m = find_plugin(xml, plugin_type)
    if m is None:  # unreachable: ensure_plugin either placed it or raised
        raise GroundingError(f"the {plugin_type} plugin is absent from this snapshot")
    return splice(xml, m, set_attr(m.group(0), attr, value))
