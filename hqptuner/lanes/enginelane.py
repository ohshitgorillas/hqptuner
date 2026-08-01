"""Write orchestration for the config-file-only engine attributes.

``engineconf`` holds the pure XML/zip editing; this module is the IO around it —
fetch a ``/backup`` archive, edit the ``<engine>`` tag of the right members, push
it through ``POST /restore``, and confirm by reading the attributes back after
the daemon's self-restart. Split out of ``manager`` because the connection
manager owns reachability and polling, not this lane's retry loop.

The hardware-acceleration attributes (``cuda``, ``multicore``, ``ecores``,
``nblocks``, ``cuda_dev``, ``cuda_cdev``) have no ``/config`` form field and no
Control API setter, so this is their only write path (manual §1.2). The restore
restarts the daemon and interrupts playback; nothing here or above refuses
it for that reason — the user decides when.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from ..conf import engineconf
from . import presetlane, settle

if TYPE_CHECKING:  # avoid a circular import at runtime
    from ..manager import ConnectionManager

# readback window after the restore, before reporting the apply unconfirmed —
# the restore restart measured ~5.6 s on 6.0.4. Deliberately its own deadline
# rather than the alarm threshold: this lane's restart cost is known, and the
# window predates the shared settle helper by design, not by accident.
_VERIFY_WINDOW = 10.0
_VERIFY_INTERVAL = 0.5


async def verify(mgr: ConnectionManager, overrides: dict[str, str]) -> dict[str, Any]:
    """Poll a fresh backup until every override is reflected in its base config's
    ``<engine>`` tag, or the window runs out. Returns the last-read attributes
    either way, so a caller can report what actually landed."""
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


async def apply(
    mgr: ConnectionManager,
    backup: bytes,
    overrides: dict[str, str],
    active: str | None,
    all_presets: bool,
) -> dict[str, Any]:
    """Edit ``overrides`` into ``backup``'s ``<engine>`` tags and restore it.

    ``all_presets`` edits every snapshot in the archive; otherwise just the base
    config plus the active preset's snapshot. Raises ``httpx.HTTPError`` if the
    restore itself fails; the caller decides how to report that."""
    # under auto-save the active preset's data/cfgs mirror catches up on any
    # restore that happens anyway — swap in the store's copy before editing, so
    # the overrides land on the auto-saved state rather than a stale mirror
    mirror = presetlane.autosave_mirror(mgr)
    if mirror:
        backup = engineconf.rewrite_zip(backup, mirror)
    members = engineconf.config_members(backup, active or None, all_presets)
    modified = engineconf.edit_config_zip(backup, members, overrides)
    await mgr.require_http().restore(modified, scope="system")
    verified = await verify(mgr, overrides)
    return {"submitted": True, "verified": verified, "members": members, "backup_bytes": len(backup)}
