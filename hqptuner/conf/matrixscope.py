"""Locating and scoping a matrix context inside a config snapshot.

Split out of ``matrixconf`` at the file-length gate, and a clean seam: everything
here answers "which bytes are the matrix in question", nothing here knows what a
pipeline row or a saved profile *is*. Depends on ``xmledit`` alone, so
``matrixconf`` imports it and never the other way round.

Two matrix contexts exist in one document — the live ``<matrix>`` the daemon runs
from at startup, and each stored ``<matrix_profile>``. They share their child tag
names, so "the post-process chain" is not a question with one answer; it is a
question per scope, which is what this module supplies.
"""

from __future__ import annotations

import re

from hqptuner.conf.xmledit import GroundingError, in_comment

# minimal XML attribute escaping for the process string (order matters on unescape)
# ``&apos;`` is in the table because the DAEMON writes it: an apostrophe in a
# process string or a profile name comes back as the entity, and a table that
# cannot unescape it reads the literal "&apos;" as the value — which then never
# matches what was written, so the apply can never converge.
_ATTR_ESCAPES = (("&", "&amp;"), ("<", "&lt;"), (">", "&gt;"), ('"', "&quot;"), ("'", "&apos;"))


def attr_escape(value: str) -> str:
    for ch, ent in _ATTR_ESCAPES:
        value = value.replace(ch, ent)
    return value


def attr_unescape(value: str) -> str:
    for ch, ent in reversed(_ATTR_ESCAPES):
        value = value.replace(ent, ch)
    return value


def matrix_body_span(xml: bytes) -> tuple[int, int]:
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


# Reading a stored profile's matrix runs against a FRAGMENT: the profile's body
# wrapped in a synthetic ancestor chain, so every locator in ``xmledit`` — which
# grounds elements by their schema position — resolves inside the profile exactly
# as it does inside the live matrix. Reusing the locators is the point: a second
# set of profile-aware ones is a second set to drift.
#
# ``xmledit.live_tags`` excludes stored profiles by span, so the fragment must NOT
# carry the ``<matrix_profile>`` tag itself — only its body. Inside the fragment
# the profile's own chain is the live one, which is precisely the scope wanted.
_SCOPE_OPEN = b"<hqplayerd><engine><matrix>"
_SCOPE_CLOSE = b"</matrix></engine></hqplayerd>"


def _profile_open(xml: bytes, name: str) -> re.Match[bytes]:
    """The named profile's open tag. Raises when the snapshot has no such profile
    — never a fallback to the live matrix: writing the Default context while the
    caller believes it is editing a profile is the whole defect being fixed.
    """
    escaped = re.escape(attr_escape(name).encode())
    pattern = re.compile(rb"<matrix_profile\b[^>]*name=\"" + escaped + rb"\"[^>]*?/?>")
    m = next((c for c in pattern.finditer(xml) if not in_comment(xml, c.start())), None)
    if m is None:
        raise GroundingError(f"the matrix profile {name} is absent from this snapshot")
    return m


def has_profile(xml: bytes, name: str) -> bool:
    """Whether this snapshot carries the named profile — the lane's guard before
    it scopes an apply. A profile the daemon holds in memory only (saved through
    its own route, never persisted) is live but absent from the file, and scoping
    to it would refuse every apply the user makes while it is selected.
    """
    try:
        _profile_open(xml, name)
    except GroundingError:
        return False
    return True


def _profile_body_span(xml: bytes, name: str) -> tuple[int, int]:
    """(start, end) byte offsets of the named profile element's body."""
    m = _profile_open(xml, name)
    close = xml.find(b"</matrix_profile>", m.end())
    if m.group(0).endswith(b"/>") or close == -1:
        raise GroundingError(f"the matrix profile {name} has no body in this snapshot")
    return m.end(), close


def matrix_scope(xml: bytes, profile: str | None) -> bytes:
    """The bytes a matrix-scoped reader should read: the named profile's body in
    its synthetic wrapper, or ``xml`` whole when no profile is active.

    The read side of ``scoped_edit``, and the reason a verify diff compares like
    with like — intended and realized both run through this, so a profile-scoped
    write is proven where it actually landed rather than against the matrix it
    deliberately did not touch.
    """
    if not profile:
        return xml
    start, close = _profile_body_span(xml, profile)
    return _SCOPE_OPEN + xml[start:close] + _SCOPE_CLOSE
