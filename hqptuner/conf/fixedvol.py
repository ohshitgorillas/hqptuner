"""Fixed-volume reconciliation onto the snapshot's ``<fixed>`` element."""

from __future__ import annotations

import re

from hqptuner.conf.xmledit import GroundingError, find_element, get_attr, open_tag_re

# Fixed volume is a top-level ``<fixed volume="X"/>`` element whose PRESENCE means
# "enabled" — there is no ``enabled`` attribute (readme §1.13 + live config). The
# two form fields fold onto that one element, reconciled together (reconcile_fixed).
FIXED_ENABLED = "fixed_volume_enabled"
FIXED_LEVEL = "fixed_volume"
_TRUTHY = frozenset({"1", "on", "true", "yes"})


# the daemon's parked memory for a disabled fixed volume, and now ours too
_COMMENTED_FIXED_RE = re.compile(rb"\n?[ \t]*<!--\s*<fixed\b[^>]*/>\s*-->")


def find_active_fixed(xml: bytes) -> re.Match[bytes] | None:
    """The live ``<fixed .../>`` element, or None — the daemon parks the
    remembered level in a commented one when the feature is off."""
    return find_element(xml, "fixed")


def fixed_level_of(tag: bytes) -> str | None:
    return get_attr(tag, "volume")


def any_fixed_level(xml: bytes) -> str | None:
    """The level off the first ``<fixed>`` tag anywhere — the active element, or
    the commented-out one a disabled level is parked in. None when this config has
    never carried a fixed volume at all, which is different from carrying 0 dBFS."""
    for m in open_tag_re("fixed").finditer(xml):
        lvl = fixed_level_of(m.group(0))
        if lvl is not None:
            return lvl
    return None


def _remembered_level(xml: bytes) -> str:
    """Last-known fixed-volume level — the active element, else a commented one
    (the daemon's memory when off), else 0 dBFS."""
    return any_fixed_level(xml) or "0"


def _fixed_target(xml: bytes, fixed_edits: dict[str, str], active: re.Match[bytes] | None) -> tuple[bool, str]:
    """Desired (enabled, level) for ``<fixed>``: an unstaged half falls back to the
    snapshot's current state, so editing one field never clobbers the other."""
    if FIXED_ENABLED in fixed_edits:
        enabled = fixed_edits[FIXED_ENABLED].strip().lower() in _TRUTHY
    else:
        # Staging the LEVEL alone switches the feature ON. Presence of <fixed> IS
        # the enabled flag, so there is nowhere to park a level while the feature
        # is off — a level edit that left it off was silently discarded, and the
        # apply reported success because read_config then omits the field it just
        # dropped. An explicit fixed_volume_enabled=0 still wins: it is handled
        # above, so "turn it off" never resurrects the feature.
        enabled = FIXED_LEVEL in fixed_edits or active is not None
    current = fixed_level_of(active.group(0)) if active is not None else None
    return enabled, fixed_edits.get(FIXED_LEVEL) or current or _remembered_level(xml)


def _strip_active_fixed(xml: bytes, active: re.Match[bytes]) -> bytes:
    """Remove the active ``<fixed/>`` element plus its own indentation, so toggling
    the feature doesn't accrete blank lines."""
    start = active.start()
    while start > 0 and xml[start - 1 : start] in (b" ", b"\t"):
        start -= 1
    if start > 0 and xml[start - 1 : start] == b"\n":
        start -= 1
    return xml[:start] + xml[active.end() :]


def _insert_root_child(xml: bytes, tag: bytes) -> bytes:
    """Insert ``tag`` as the first child of ``<hqplayerd>``, where the daemon
    itself writes the fixed-volume line."""
    open_tag = re.search(rb"<hqplayerd\b[^>]*>", xml)
    if open_tag is None:
        raise GroundingError("<hqplayerd> root element absent from this snapshot")
    cut = open_tag.end()
    return xml[:cut] + b"\n\t" + tag + xml[cut:]


def _insert_fixed(xml: bytes, level: str) -> bytes:
    """The live ``<fixed volume="level"/>`` — its presence is what "enabled" means."""
    return _insert_root_child(xml, f'<fixed volume="{level}"/>'.encode())


def _remember_fixed(xml: bytes, level: str) -> bytes:
    """Park the level in a COMMENTED ``<fixed>`` line rather than dropping it.

    This is the daemon's own convention, not an invention: a real 6.0.4 config
    whose fixed volume is off carries ``<!--<fixed volume="-3"/>-->``, and
    ``_remembered_level`` reads it back. Deleting the element outright instead
    destroys a level typed before the feature was switched off, and the box then
    shows the daemon's own remembered value instead of the user's — a disable
    lossier than hqplayerd's."""
    return _insert_root_child(xml, f'<!--<fixed volume="{level}"/>-->'.encode())


def reconcile_fixed(xml: bytes, fixed_edits: dict[str, str]) -> bytes:
    """Fold the ``fixed_volume_enabled`` / ``fixed_volume`` pair onto the top-level
    ``<fixed>`` element: enabled ⇒ ``<fixed volume="level"/>`` live, disabled ⇒ the
    same line commented out so the level survives. Every other byte is preserved."""
    active = find_active_fixed(xml)
    enabled, level = _fixed_target(xml, fixed_edits, active)  # reads the old memory, so run it first
    if active is not None:
        xml = _strip_active_fixed(xml, active)
    # whichever way this goes, the previous memory is superseded — leaving it would
    # stack a fresh comment on every toggle and give _remembered_level a stale first hit
    xml = _COMMENTED_FIXED_RE.sub(b"", xml)
    return _insert_fixed(xml, level) if enabled else _remember_fixed(xml, level)
