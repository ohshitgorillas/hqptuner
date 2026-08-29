"""HQPTuner-owned preset lane (``store.presets`` + the daemon's restore primitive).

Presets live in a store HQPTuner owns (``store.presets``); the daemon
is driven only through ``POST /restore`` onto ``[default]`` with a ``data/cfgs``
mirror — never ``profile/load``/``profile/save``, which are unreliable
(docs/protocol.md §3.6). ``profile/delete`` is the one profile route kept, for
mirror removal (restore is additive and cannot delete a member).

Every function takes the ``ConnectionManager`` and reaches the daemon through its
public accessors, exactly like the other lanes. It lives under ``presets`` rather
than ``lanes`` because it depends on the store: the two readers that do not
(``carried_live_fields``, ``autosave_mirror``) stayed behind in
``lanes/presetfields.py``, where the engine and http lanes can still reach them.
"""

from __future__ import annotations

import contextlib
import logging
from typing import TYPE_CHECKING, Any

import httpx

from hqptuner.conf import engineconf, presetconf, presetzip, xmledit
from hqptuner.engine.control import ControlError
from hqptuner.lanes import settle
from hqptuner.lanes.live import overrides
from hqptuner.presets.store.autopilot import AutopilotError
from hqptuner.presets.store.presets import PresetError

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)

RECONNECT_FAST = 1.0


def listing(mgr: ConnectionManager) -> dict[str, Any]:
    """Preset list + active name for the API.

    Shaped like the daemon profile field the frontend already renders: an empty "(no preset)" option, then every
    stored preset. ``active`` is the store's truth (the daemon is always ``[default]``).

    The empty option is deliberately NOT labeled ``[default]``. hqplayerd's own UI
    uses that word for its unnamed base config — which, under our restore-only
    model, the daemon runs whether a preset is active or not — so the same word one
    browser tab apart meant two different things. Here it means "no preset
    bookmark", and "(no preset)" says that without promising a settings reset it
    cannot deliver.
    """
    options: list[dict[str, str]] = [{"value": "", "label": "(no preset)"}]
    options += [{"value": n, "label": n} for n in mgr.presetops.store.names()]
    active = mgr.presetops.store.active or ""
    return {"value": active, "options": options, "active": active, "autosave": mgr.presetops.store.autosave}


async def read(mgr: ConnectionManager, name: str) -> dict[str, str]:
    """Read a preset's saved settings in form-field terms for the editor preview — no daemon touch.

    A named preset reads from the store; the empty ("(no preset)") selection reads the current running config.
    """
    if not name:
        return dict(mgr.file_config or await mgr.load_file_config())
    return presetconf.read_config(mgr.presetops.store.read(name))


async def load(mgr: ConnectionManager, name: str) -> dict[str, Any]:
    """Load a stored preset.

    Restores its config as the ``[default]`` working config (the reliable primitive) and marks it active, mirroring
    it into the daemon's ``data/cfgs`` so the native UI stays populated. Never ``profile/load``.
    """
    xml = mgr.presetops.store.read(name)
    previous = mgr.presetops.store.active  # the load below overwrites the pointer
    await mgr.await_http_ready()  # a prior load/save may have restarted the daemon
    backup = await mgr.presetops.backup_or_cached(for_write=True)
    mgr.presetops.persist_backup(backup)
    archive = presetzip.restore_zip_with_working(backup, xml, mirror_name=name, mirror_xml=xml)
    await mgr.require_http().restore(archive, scope="system")
    mgr.presetops.store.set_active(name)
    mgr.audit.preset_load(name, previous)
    await mgr.await_http_ready()
    # the restore restarted the daemon: every live reading we hold is the previous
    # engine's, and an auto-save riding this load would fold those into the preset
    # it just loaded (ConnectionManager.resync_engine_state)
    await mgr.resync_engine_state()
    await mgr.load_file_config()
    await mgr.refresh_http_forms()
    _restore_autopilot(mgr, name)
    return {"name": name, "active": True}


def _restore_autopilot(mgr: ConnectionManager, name: str) -> None:
    """Put auto-pilot back to what this preset carries.

    hqplayerd's config has no junk-filter field, so a config preset carries auto-pilot's state and nothing about the
    filter itself; auto-pilot settles the filter on its own from the next tick.
    """
    try:
        if mgr.presetops.autopilot.for_preset(name):
            mgr.presetops.autopilot.enable()
        else:
            mgr.presetops.autopilot.disable()
    except AutopilotError as exc:
        log.warning("auto-pilot state not restored for preset %r: %s", name, exc)


async def switch(mgr: ConnectionManager, name: str) -> dict[str, Any]:
    """Make ``name`` the active preset as the first step of an apply.

    A named preset loads (restore + mirror); the empty name is the picker's "(no preset)" and only drops the
    bookmark. Never hqplayerd's ``profile/load``.
    """
    if not name:
        return await unload(mgr)
    # cache a healthy backup BEFORE the load — the load bug empties /backup, and
    # the persistent apply that follows needs the archive (docs/protocol.md)
    with contextlib.suppress(httpx.HTTPError):
        await mgr.presetops.backup_or_cached()
    return await load(mgr, name)


async def unload(mgr: ConnectionManager) -> dict[str, Any]:
    """Select "(no preset)".

    Drops HQPTuner's active-preset bookmark and leaves the running config exactly as it is.

    There is nothing to load and nothing to restart. HQPlayer runs one settings
    file either way; an active preset is a note we keep about where that file's
    contents came from, not a second place they live. Nobody stored the
    before-the-preset version, so "unload" cannot mean "put the old settings
    back" — it means we stop claiming the current settings belong to a preset.
    Shaped like ``load``'s return so the apply report reads the same either way.
    """
    mgr.presetops.store.set_active(None)
    return {"name": "", "active": True}


async def save(mgr: ConnectionManager, name: str) -> dict[str, Any]:
    """Persist the current running config as preset ``name``.

    Stores our copy and mirrors it into the daemon's ``data/cfgs``. Called after a successful apply, so the running
    config already carries the user's edits.

    The store write is the save; the daemon mirror is a convenience for
    hqplayerd's own profile list. So the mirror runs AFTER the store commits and
    reports a warning rather than a failure — a save that reached disk must never
    come back as ``ok: False``, which is what sent a user looking for a preset
    that was already there.
    """
    try:
        await mgr.await_http_ready()  # a prior load/save may have restarted the daemon
        backup = await mgr.presetops.backup_or_cached(for_write=True)
        working = engineconf.base_config_xml(backup, mgr.active_config)
        if not working:
            raise ControlError("no running config to save")
        # Live-routed edits (filters, dither/modulator, mode) never touched the
        # file, so the working config is stale for exactly those settings. Fold
        # the engine's current values in first — a save stores what the user is
        # hearing, not what happens to be on disk.
        working = presetconf.apply_edits(working, overrides.live_overrides(mgr))
        mgr.presetops.store.save(name, working, trigger="save")
        mgr.presetops.store.set_active(name)
    except (ControlError, PresetError, httpx.HTTPError, xmledit.GroundingError) as exc:
        return {"name": name, "ok": False, "error": str(exc)}
    _record_autopilot(mgr, name)
    warning = await _mirror(mgr, name, working, backup)
    if warning is None:
        return {"name": name, "ok": True}
    return {"name": name, "ok": True, "warning": warning}


async def autosave(mgr: ConnectionManager) -> dict[str, Any] | None:
    """Fold the current audible state back into the active preset's store file.

    This is the auto-save checkbox's whole write path. Store only, never the daemon
    mirror: the mirror costs a restore restart, so it catches up by riding the
    next restore that happens anyway (``lanes/presetfields.autosave_mirror``).
    Returns None when
    auto-save is off or no preset is active; best-effort otherwise — a failed
    auto-save reports itself and never fails the write it followed.
    """
    name = mgr.presetops.store.active
    if not name or not mgr.presetops.store.autosave:
        return None
    try:
        backup = await mgr.presetops.backup_or_cached(for_write=True)
        working = engineconf.base_config_xml(backup, mgr.active_config)
        if not working:
            raise ControlError("no running config to auto-save")
        working = presetconf.apply_edits(working, overrides.live_overrides(mgr))
        mgr.presetops.store.save(name, working, trigger="autosave")
    except (ControlError, PresetError, httpx.HTTPError, xmledit.GroundingError) as exc:
        log.warning("auto-save into preset %r failed: %s", name, exc)
        return {"name": name, "ok": False, "error": str(exc)}
    _record_autopilot(mgr, name)
    return {"name": name, "ok": True}


def _record_autopilot(mgr: ConnectionManager, name: str) -> None:
    """Record auto-pilot's current state as the one preset ``name`` carries.

    The high-frequency filter's auto-pilot has no home in the XML — hqplayerd's config carries no junk-filter field at
    all — so a preset's copy of it goes into HQPTuner's own store, keyed by the name just written. Both write paths run
    it: a save and an auto-save fold the same audible state into the same preset, and one of them skipping this leaves
    the flag frozen at whatever the other last wrote.

    Runs after the store commit and is best-effort for the same reason the daemon mirror is: the preset already reached
    disk, and a store we cannot write is not worth failing a good save over.
    """
    try:
        mgr.presetops.autopilot.set_for_preset(name, enabled=mgr.presetops.autopilot.enabled)
    except AutopilotError as exc:
        log.warning("auto-pilot state not recorded for preset %r: %s", name, exc)


async def _mirror(mgr: ConnectionManager, name: str, working: bytes, backup: bytes) -> str | None:
    """Plant ``data/cfgs/<name>.xml`` on the daemon so hqplayerd's native profile list mirrors our store.

    Returns None when it landed, else a user-facing warning.

    Retries through the shared settle loop instead of firing once: this runs
    right after an apply's own restore, so the daemon is routinely still
    restarting and a single-shot POST reports a failure the next second would
    not have seen. Re-sending is safe — the archive is the same bytes either
    way.
    """
    archive = presetzip.restore_zip_with_working(backup, working, mirror_name=name, mirror_xml=working)

    async def push() -> bool:
        await mgr.require_http().restore(archive, scope="system")
        return True

    if await settle.poll_until(mgr, push, interval=RECONNECT_FAST):
        await mgr.await_http_ready()
        return None
    log.warning("preset %r saved, but its daemon mirror did not land", name)
    return "hqplayerd's own profile list was not updated"


async def delete(mgr: ConnectionManager, name: str) -> dict[str, Any]:
    """Delete a preset from the store and remove its daemon mirror via ``profile/delete``.

    Restore is additive and cannot remove a member.
    """
    mgr.presetops.store.delete(name)
    with contextlib.suppress(httpx.HTTPError, ControlError):
        await mgr.require_http().post_profile("delete", profile=name)
    return {"name": name, "ok": True}


async def migrate(mgr: ConnectionManager, active_hint: str | None) -> list[str]:
    """One-time import of hqplayerd's existing ``data/cfgs`` presets into the store so nothing is orphaned.

    Idempotent — existing store presets win. Seeds the active pointer from the daemon's reported active config when
    the store has none. Returns the imported names.
    """
    snapshots = presetzip.snapshot_members(await mgr.presetops.backup_or_cached())
    imported = mgr.presetops.store.import_missing(snapshots)
    if mgr.presetops.store.active is None and active_hint and mgr.presetops.store.exists(active_hint):
        mgr.presetops.store.set_active(active_hint)
    return imported
