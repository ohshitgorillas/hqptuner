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

from dataclasses import dataclass
from typing import TYPE_CHECKING

from hqptuner.conf import engineconf, presetconf
from hqptuner.lanes import presetfields, settle

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.core.manager import ConnectionManager

# readback window after the restore, before reporting the apply unconfirmed —
# the restore restarts the daemon, so the window has to outlast that restart.
# Deliberately its own deadline rather than the alarm threshold or the shared
# settle helper: this lane's restart cost is known.
_VERIFY_WINDOW = 10.0
_VERIFY_INTERVAL = 0.5


@dataclass(frozen=True)
class EngineVerification:
    """An engine-attribute readback: whether every override landed, and the ``<engine>`` attributes last read."""

    applied: bool
    engine: dict[str, str]


@dataclass(frozen=True)
class EngineAttrsResult:
    """An engine-attribute restore: its readback, the archive members edited, and the size of the backup it edited."""

    verified: EngineVerification
    members: list[str]
    backup_bytes: int


async def verify(mgr: ConnectionManager, overrides: dict[str, str]) -> EngineVerification:
    """Poll a fresh backup until every override is reflected in its base config's ``<engine>`` tag, or the window ends.

    Returns the last-read attributes either way, so a caller can report what actually landed.
    """
    got: dict[str, str] = {}

    async def probe() -> dict[str, str] | None:
        nonlocal got
        fresh = await settle.fresh_backup(mgr)
        try:
            xml = None if fresh is None else engineconf.base_config_xml(fresh, mgr.readings.active_config)
        except engineconf.UnreadableArchiveError:
            xml = None
        if xml is None:
            return None
        got = engineconf.read_engine_attrs(xml)
        return got if all(got.get(key) == want for key, want in overrides.items()) else None

    # the restore just restarted the daemon — spend the first interval waiting
    await mgr.clock.sleep(_VERIFY_INTERVAL)
    applied = await settle.poll_until(mgr, probe, interval=_VERIFY_INTERVAL, deadline=_VERIFY_WINDOW)
    return EngineVerification(applied=applied is not None, engine=got)


def _with_carried_live_fields(mgr: ConnectionManager, backup: bytes, active: str | None) -> bytes:
    """``backup`` with the running live-domain settings (store as fallback) written into its working config member.

    This restore restarts the daemon onto that member, and a live edit never wrote
    those settings to any file — so without this the engine-attribute apply costs
    the user the mode, filters and shapers they saved (``presetfields``).
    """
    stored = presetfields.carried_live_fields(mgr)
    working = engineconf.base_config_xml(backup, active or None)
    member = engineconf.working_member_name(backup, active or None)
    if not stored or not working or member is None:
        return backup
    return engineconf.rewrite_zip(backup, {member: presetconf.apply_edits(working, stored)})


async def apply(
    mgr: ConnectionManager,
    backup: bytes,
    overrides: dict[str, str],
    active: str | None,
    *,
    all_presets: bool,
) -> EngineAttrsResult:
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
    backup = _with_carried_live_fields(mgr, engineconf.with_boot_member(backup, active or None), active)
    members = engineconf.config_members(backup, active or None, all_presets=all_presets)
    modified = engineconf.edit_config_zip(backup, members, overrides)
    mark = settle.mark_connect(mgr)
    await settle.restore(mgr, modified, mark=mark, scope="system")
    verified = await verify(mgr, overrides)
    # `verify` reads the 8088 lane back and cannot speak for the 4321 control connection,
    # which is still the dead one the restart left behind. After it rather than before,
    # so verify's own window is unchanged and this only adds the lane it cannot see.
    await settle.await_ready(mgr, mark)
    return EngineAttrsResult(verified=verified, members=members, backup_bytes=len(backup))
