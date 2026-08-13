"""What a restore-shaped write owes the settings that never reach the config file.

Both readers here answer from the manager's cached engine state and the preset
store — never from the daemon, which is why they sit in ``lanes`` while the rest
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


def _stored_live_fields(mgr: ConnectionManager) -> dict[str, str]:
    """Return the active preset's stored values for the live domain, or empty when there is no store to read."""
    name = mgr.presetops.store.active
    if not name or not mgr.presetops.store.exists(name):
        return {}
    stored = presetconf.read_config(mgr.presetops.store.read(name))
    return {field: value for field, value in stored.items() if field in liveoverrides.LIVE_DOMAIN}


def carried_live_fields(mgr: ConnectionManager) -> dict[str, str]:
    """Return what a restore must carry for the settings a live edit never writes to the config file.

    Those settings are output mode, both chains' filters and shapers, adaptive
    volume, the per-family rate limits (``liveoverrides.LIVE_DOMAIN``).

    hqplayerd boots from its config file and a live edit reaches only the running
    engine, so a restore-shaped write that carries nothing from here boots the
    daemon onto a file that never learned those settings.

    **The running engine is the authority, the store is the fallback.** A restore
    re-asserts the RUNNING configuration (``presetzip.restore_zip_from_running``),
    and for this field set the engine is the only thing that knows what is running
    — so what the user is hearing is what the restart has to come back on. The
    store answers only for fields the engine cannot: a dormant chain it holds no
    enumeration for, or a daemon that has not reported ``State`` yet.

    Reading the store first and letting it win was a defect with no user-reachable
    workaround. A live-routed mode never reaches the config file, so a stored mode
    was re-asserted on every restore and the daemon restarted onto it; and because
    the config surface grounds those controls on live truth
    (``api/configapi.config``), re-selecting the mode the engine already held read
    as clean and staged nothing. The file could not be corrected from the UI at all.

    Deliberately NOT gated on the auto-save flag: auto-save decides whether the
    store is UPDATED, never whether it is honoured.
    """
    return {**_stored_live_fields(mgr), **liveoverrides.live_overrides(mgr)}


def _mirrored_preset(mgr: ConnectionManager) -> str | None:
    """Return the active preset's name when auto-save owes the daemon a mirror of it.

    None when auto-save is off, nothing is active, or it has no store file yet.
    """
    name = mgr.presetops.store.active
    if not name or not mgr.presetops.store.autosave or not mgr.presetops.store.exists(name):
        return None
    return name


def autosave_mirror(mgr: ConnectionManager, intended_xml: bytes | None = None) -> dict[str, bytes]:
    """Return the ``data/cfgs`` member a restore should carry.

    Carrying it is how the daemon's native profile list catches up with auto-save.

    Auto-save itself never restores, so the mirror rides restores that happen
    anyway. ``intended_xml`` is the working config that restore lands; folded with
    the live overrides it is exactly what the next auto-save will store. Without it
    (an engine-lane restore) the store file itself is the freshest mirror. Empty
    when auto-save is off, no preset is active, or the preset has no store file yet.
    """
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
