"""HQPTuner-owned preset lane (``presetstore`` + the daemon's restore primitive).

Extracted from ``manager`` for the same reason ``httplane``/``enginelane`` were:
the preset operations are a self-contained lane, and the manager had grown past
the file cap. Presets live in a store HQPTuner owns (``presetstore``); the daemon
is driven only through ``POST /restore`` onto ``[default]`` with a ``data/cfgs``
mirror — never ``profile/load``/``profile/save``, which are unreliable
(docs/protocol.md §3.6). ``profile/delete`` is the one profile route kept, for
mirror removal (restore is additive and cannot delete a member).

Every function takes the ``ConnectionManager`` and reaches the daemon through its
public accessors, exactly like the other lanes.
"""

from __future__ import annotations

import contextlib
import logging
from typing import TYPE_CHECKING, Any

import httpx

from ..conf import engineconf, presetconf
from ..control import ControlError
from ..presetstore import PresetError
from . import livemap, settle

if TYPE_CHECKING:  # avoid a circular import at runtime
    from ..manager import ConnectionManager

log = logging.getLogger(__name__)

RECONNECT_FAST = 1.0


def listing(mgr: ConnectionManager) -> dict[str, Any]:
    """Preset list + active name for the API, shaped like the daemon profile field
    the frontend already renders: an empty ``[default]`` option, then every stored
    preset. ``active`` is the store's truth (the daemon is always ``[default]``)."""
    options: list[dict[str, str]] = [{"value": "", "label": "[default]"}]
    options += [{"value": n, "label": n} for n in mgr.store.names()]
    active = mgr.store.active or ""
    return {"value": active, "options": options, "active": active}


async def read(mgr: ConnectionManager, name: str) -> dict[str, str]:
    """A preset's saved settings in form-field terms for the editor preview — no
    daemon touch. A named preset reads from the store; the empty (``[default]``)
    selection reads the current running config."""
    if not name:
        return dict(mgr.file_config or await mgr.load_file_config())
    return presetconf.read_config(mgr.store.read(name))


async def load(mgr: ConnectionManager, name: str) -> dict[str, Any]:
    """Load a stored preset: restore its config as the ``[default]`` working config
    (the reliable primitive) and mark it active, mirroring it into the daemon's
    ``data/cfgs`` so the native UI stays populated. Never ``profile/load``."""
    xml = mgr.store.read(name)
    await mgr.await_http_ready()  # a prior load/save may have restarted the daemon
    backup = await mgr.backup_or_cached(for_write=True)
    mgr.persist_backup(backup)
    archive = presetconf.restore_zip_with_working(backup, xml, mirror_name=name, mirror_xml=xml)
    await mgr.require_http().restore(archive, scope="system")
    mgr.store.set_active(name)
    await mgr.await_http_ready()
    await mgr.load_file_config()
    await mgr.refresh_http_forms()
    return {"name": name, "active": True}


async def save(mgr: ConnectionManager, name: str) -> dict[str, Any]:
    """Persist the current running config as preset ``name`` — store our copy and
    mirror it into the daemon's ``data/cfgs``. Called after a successful apply, so
    the running config already carries the user's edits.

    The store write is the save; the daemon mirror is a convenience for
    hqplayerd's own profile list. So the mirror runs AFTER the store commits and
    reports a warning rather than a failure — a save that reached disk must never
    come back as ``ok: False``, which is what sent a user looking for a preset
    that was already there."""
    try:
        await mgr.await_http_ready()  # a prior load/save may have restarted the daemon
        backup = await mgr.backup_or_cached(for_write=True)
        working = engineconf.base_config_xml(backup, mgr.active_config)
        if not working:
            raise ControlError("no running config to save")
        # Live-routed edits (filters, dither/modulator, mode) never touched the
        # file, so the working config is stale for exactly those settings. Fold
        # the engine's current values in first — a save stores what the user is
        # hearing, not what happens to be on disk.
        working = presetconf.apply_edits(working, livemap.live_overrides(mgr))
        mgr.store.save(name, working)
        mgr.store.set_active(name)
    except (ControlError, PresetError, httpx.HTTPError, presetconf.GroundingError) as exc:
        return {"name": name, "ok": False, "error": str(exc)}
    warning = await _mirror(mgr, name, working, backup)
    if warning is None:
        return {"name": name, "ok": True}
    return {"name": name, "ok": True, "warning": warning}


async def _mirror(mgr: ConnectionManager, name: str, working: bytes, backup: bytes) -> str | None:
    """Plant ``data/cfgs/<name>.xml`` on the daemon so hqplayerd's native profile
    list mirrors our store. Returns None when it landed, else a user-facing
    warning.

    Retries through the shared settle loop instead of firing once: this runs
    right after an apply's own restore, so the daemon is routinely still
    restarting and a single-shot POST reports a failure the next second would
    not have seen. Re-sending is safe — the archive is the same bytes either
    way."""
    archive = presetconf.restore_zip_with_working(backup, working, mirror_name=name, mirror_xml=working)

    async def push() -> bool:
        await mgr.require_http().restore(archive, scope="system")
        return True

    if await settle.poll_until(mgr, push, interval=RECONNECT_FAST):
        await mgr.await_http_ready()
        return None
    log.warning("preset %r saved, but its daemon mirror did not land", name)
    return "hqplayerd's own profile list was not updated"


async def delete(mgr: ConnectionManager, name: str) -> dict[str, Any]:
    """Delete a preset from the store and remove its daemon mirror via
    ``profile/delete`` — restore is additive and cannot remove a member."""
    mgr.store.delete(name)
    with contextlib.suppress(httpx.HTTPError, ControlError):
        await mgr.require_http().post_profile("delete", profile=name)
    return {"name": name, "ok": True}


async def migrate(mgr: ConnectionManager, active_hint: str | None) -> list[str]:
    """One-time import of hqplayerd's existing ``data/cfgs`` presets into the store
    so nothing is orphaned. Idempotent — existing store presets win. Seeds the
    active pointer from the daemon's reported active config when the store has
    none. Returns the imported names."""
    snapshots = presetconf.snapshot_members(await mgr.backup_or_cached())
    imported = mgr.store.import_missing(snapshots)
    if mgr.store.active is None and active_hint and mgr.store.exists(active_hint):
        mgr.store.set_active(active_hint)
    return imported
