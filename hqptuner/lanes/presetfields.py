"""What the active preset's store file owes a restore-shaped write.

Both readers here answer the same question from the store and nothing else —
they never touch the daemon, which is why they sit in ``lanes`` while the rest
of the preset lane (``presets/presetlane.py``) drives it. The engine and http
lanes call them while assembling a restore, so they must stay reachable from
below the ``presets`` layer.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from hqptuner.conf import engineconf, presetconf, xmledit
from hqptuner.lanes import liveoverrides

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.core.manager import ConnectionManager


def stored_live_fields(mgr: ConnectionManager) -> dict[str, str]:
    """The active preset's stored values for the settings a live edit never writes
    to the config file — output mode, both chains' filters and shapers, adaptive
    volume, the per-family rate limits (``liveoverrides.LIVE_DOMAIN``).

    hqplayerd boots from its config file and a live edit reaches only the running
    engine, so a restore-shaped write that carries nothing from here boots the
    daemon onto a file that never learned those settings. The preset store is the
    record of what the user last saved, by explicit save or by auto-save, so it is
    what a restore carries.

    Deliberately NOT gated on the auto-save flag: auto-save decides whether the
    store is UPDATED, never whether it is honoured. Empty when no preset is active
    or the active one has no store file — nothing was saved, so nothing is owed."""
    name = mgr.presetops.store.active
    if not name or not mgr.presetops.store.exists(name):
        return {}
    stored = presetconf.read_config(mgr.presetops.store.read(name))
    return {field: value for field, value in stored.items() if field in liveoverrides.LIVE_DOMAIN}


def _mirrored_preset(mgr: ConnectionManager) -> str | None:
    """The active preset's name when auto-save owes the daemon a mirror of it —
    None when auto-save is off, nothing is active, or it has no store file yet."""
    name = mgr.presetops.store.active
    if not name or not mgr.presetops.store.autosave or not mgr.presetops.store.exists(name):
        return None
    return name


def autosave_mirror(mgr: ConnectionManager, intended_xml: bytes | None = None) -> dict[str, bytes]:
    """The ``data/cfgs`` member a restore should carry so the daemon's native
    profile list catches up with auto-save — auto-save itself never restores, so
    the mirror rides restores that happen anyway. ``intended_xml`` is the working
    config that restore lands; folded with the live overrides it is exactly what
    the next auto-save will store. Without it (an engine-lane restore) the store
    file itself is the freshest mirror. Empty when auto-save is off, no preset is
    active, or the preset has no store file yet."""
    name = _mirrored_preset(mgr)
    if name is None:
        return {}
    member = engineconf.snapshot_member_name(name)
    if intended_xml is None:
        return {member: mgr.presetops.store.read(name)}
    try:
        return {member: presetconf.apply_edits(intended_xml, liveoverrides.live_overrides(mgr))}
    except xmledit.GroundingError:
        return {member: mgr.presetops.store.read(name)}
