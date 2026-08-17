"""Write orchestration for the config-file-only engine attributes.

``engineconf`` holds the pure XML/zip editing; this module is the IO around it —
fetch a ``/backup`` archive, edit the ``<engine>`` tag of the right members, push
it through ``POST /restore``, and confirm by reading the attributes back after
the daemon's self-restart. The connection manager owns reachability and
polling, not this lane's retry loop.

The hardware-acceleration attributes (``cuda``, ``multicore``, ``ecores``,
``nblocks``, ``cuda_dev``, ``cuda_cdev``) have no ``/config`` form field and no
Control API setter, so this is their only write path (manual §1.2). The restore
restarts the daemon and interrupts playback; nothing here or above refuses
it for that reason — the user decides when.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from hqptuner.conf import engineconf, presetconf
from hqptuner.lanes import presetfields, settle

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.core.manager import ConnectionManager

# readback window after the restore, before reporting the apply unconfirmed —
# the restore restart measures ~5.6 s on 6.0.4. Deliberately its own deadline
# rather than the alarm threshold or the shared settle helper: this lane's
# restart cost is known.
_VERIFY_WINDOW = 10.0
_VERIFY_INTERVAL = 0.5


async def verify(mgr: ConnectionManager, overrides: dict[str, str]) -> dict[str, Any]:
    """Poll a fresh backup until every override is reflected in its base config's ``<engine>`` tag, or the window ends.

    Returns the last-read attributes either way, so a caller can report what actually landed.
    """
    got: dict[str, str] = {}

    async def probe() -> dict[str, str] | None:
        nonlocal got
        fresh = await settle.fresh_backup(mgr)
        if fresh is None:
            return None
        got = engineconf.read_engine_attrs(engineconf.base_config_xml(fresh, mgr.active_config))
        return got if all(got.get(key) == want for key, want in overrides.items()) else None

    # the restore just restarted the daemon — spend the first interval waiting
    await mgr.sleep(_VERIFY_INTERVAL)
    applied = await settle.poll_until(mgr, probe, interval=_VERIFY_INTERVAL, deadline=_VERIFY_WINDOW)
    return {"applied": applied is not None, "engine": got}


def _with_carried_live_fields(mgr: ConnectionManager, backup: bytes, active: str | None) -> bytes:
    """``backup`` with the running live-domain settings (store as fallback) written into its working config member.

    This restore restarts the daemon onto that member, and a live edit never wrote
    those settings to any file — so without this the engine-attribute apply costs
    the user the mode, filters and shapers they saved (``presetfields``).
    """
    stored = presetfields.carried_live_fields(mgr)
    working = engineconf.base_config_xml(backup, active or None)
    if not stored or not working:
        return backup
    member = engineconf.working_member_name(backup, active or None)
    if member is None:
        return backup
    return engineconf.rewrite_zip(backup, {member: presetconf.apply_edits(working, stored)})


async def apply(
    mgr: ConnectionManager,
    backup: bytes,
    overrides: dict[str, str],
    active: str | None,
    *,
    all_presets: bool,
) -> dict[str, Any]:
    """Edit ``overrides`` into ``backup``'s ``<engine>`` tags and restore it.

    ``all_presets`` edits every snapshot in the archive; otherwise just the base
    config plus the active preset's snapshot. Raises ``httpx.HTTPError`` if the
    restore itself fails; the caller decides how to report that.
    """
    # under auto-save the active preset's data/cfgs mirror catches up on any
    # restore that happens anyway — swap in the store's copy before editing, so
    # the overrides land on the auto-saved state rather than a stale mirror
    mirror = presetfields.autosave_mirror(mgr)
    if mirror:
        backup = engineconf.rewrite_zip(backup, mirror)
    backup = _with_carried_live_fields(mgr, backup, active)
    members = engineconf.config_members(backup, active or None, all_presets=all_presets)
    modified = engineconf.edit_config_zip(backup, members, overrides)
    await mgr.require_http().restore(modified, scope="system")
    verified = await verify(mgr, overrides)
    return {"submitted": True, "verified": verified, "members": members, "backup_bytes": len(backup)}
