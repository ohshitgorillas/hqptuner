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
import enum
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx

from hqptuner import voltrace
from hqptuner.conf import engineconf, presetconf, presetiface, presetzip
from hqptuner.engine.controlerrors import ControlError
from hqptuner.lanes import settle
from hqptuner.lanes.live import overrides
from hqptuner.presets import fileconfig
from hqptuner.presets.store.autopilot import AutopilotError
from hqptuner.presets.store.live import LivePresetSchemaError
from hqptuner.presets.store.matrixmode import MatrixModeSchemaError
from hqptuner.presets.store.presets import canonical_name

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)

RECONNECT_FAST = 1.0


class MirrorOutcome(enum.Enum):
    """Whether a save's ``data/cfgs`` mirror reached the daemon; a mirror that did not land leaves the save standing."""

    LANDED = "landed"
    NOT_LANDED = "not_landed"


@dataclass(frozen=True)
class PresetSaveResult:
    """A save or auto-save that reached the store, and how its daemon mirror went.

    An auto-save never mirrors, so it has no failed mirror to report and reads ``LANDED``.
    """

    name: str
    mirror: MirrorOutcome = MirrorOutcome.LANDED


@dataclass(frozen=True)
class PresetOption:
    """One entry of the preset picker: the preset name it selects, and the label it shows."""

    value: str
    label: str


@dataclass(frozen=True)
class PresetListing:
    """The preset picker's contents: the selected name, every option, the active preset, and the auto-save flag."""

    value: str
    options: list[PresetOption]
    active: str
    autosave: bool


@dataclass(frozen=True)
class PresetActivation:
    """A preset load, unload or switch: the preset now active ("" for the unnamed default)."""

    name: str


@dataclass(frozen=True)
class PresetDeleted:
    """A preset removed from the store, under the trimmed name it was stored as."""

    name: str


class NoRunningConfigToSaveError(ControlError):
    """``save`` found no running config in the backup archive to fold the current settings into."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("no running config to save")


class NoRunningConfigToAutosaveError(ControlError):
    """``autosave`` found no running config in the backup archive to fold the current settings into."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("no running config to auto-save")


def listing(mgr: ConnectionManager) -> PresetListing:
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
    options = [PresetOption("", "(no preset)")]
    options += [PresetOption(n, n) for n in mgr.presetops.store.names()]
    active = mgr.presetops.store.active or ""
    return PresetListing(value=active, options=options, active=active, autosave=mgr.presetops.store.autosave)


async def read(mgr: ConnectionManager, name: str) -> dict[str, str]:
    """Read a preset's saved settings in form-field terms for the editor preview — no daemon touch.

    A named preset reads from the store; the empty ("(no preset)") selection reads the current running config.
    """
    if not name:
        return dict(mgr.readings.file_config or await fileconfig.load_file_config(mgr))
    return presetconf.read_config(mgr.presetops.store.read(name))


async def load(mgr: ConnectionManager, name: str) -> PresetActivation:
    """Load a stored preset.

    Restores its config as the ``[default]`` working config (the reliable primitive) and marks it active, mirroring
    it into the daemon's ``data/cfgs`` so the native UI stays populated. Never ``profile/load``.
    """
    name = canonical_name(name)  # the store keys on the trimmed name; so must the mirror, the pointer and the audit
    xml = mgr.presetops.store.read(name)
    # what the preset actually carries, off the same XML the restore is about to
    # push — the first of three checkpoints under one name, and the only one taken
    # before the daemon has been told anything
    voltrace.observe(mgr, "preset.stored", voltrace.subset(presetconf.read_config(xml)), name=name)
    previous = mgr.presetops.store.active  # the load below overwrites the pointer
    await settle.await_http_ready(mgr)  # the daemon restarts on every load and restore; backup() needs HTTP serving
    backup = await mgr.require_http().backup()
    mgr.presetops.persist_backup_for_load(backup, name)
    xml = presetiface.keep_interfaces(xml, engineconf.base_config_xml(backup, mgr.readings.active_config))
    archive = presetzip.restore_zip_with_working(backup, xml, mirror_name=name, mirror_xml=xml)
    mark = settle.mark_connect(mgr)
    await settle.restore(mgr, archive, mark=mark, scope="system")
    mgr.presetops.store.set_active(name)
    mgr.audit.preset_load(name, previous)
    reconnected = await settle.await_ready(mgr, mark)
    # the restore restarted the daemon: every live reading we hold is the previous
    # engine's, and an auto-save riding this load would fold those into the preset
    # it just loaded (settle.resync_engine_state)
    await settle.resync_engine_state(mgr)
    # what the daemon came back on. Null means resync could not reach the engine,
    # which is itself the answer to "what was it running after the restart".
    voltrace.observe(mgr, "post_restart_state", voltrace.live_volume(mgr), name=name)
    if not reconnected:
        # A reconnect's connect body has already refilled the file config, the
        # forms and the device capability from the restarted daemon; only a wait
        # that gave up leaves them to be read here.
        await fileconfig.load_file_config(mgr)
        await mgr.refresh_http_forms()
    # and what the config file says once the restart settled — the pair that
    # answers which of the two came back wrong
    voltrace.observe(mgr, "post_restart_file", voltrace.subset(mgr.readings.file_config), name=name)
    _restore_autopilot(mgr, name)
    return PresetActivation(name)


def switch_autopilot(mgr: ConnectionManager, source: str, *, enabled: bool) -> None:
    """Move auto-pilot's switch and record which ``source`` moved it.

    Every path that writes the switch comes through here. The store keeps only the resulting value, so a user who
    finds auto-pilot off can otherwise not tell the switch itself from a manual filter write or a config-preset
    load. The previous value is read before the write, because the write is what erases it.

    Lives in the presets package rather than beside the callers so the api routes and ``core.autopilotops`` share one
    copy without either importing the other (the import layering in ``pyproject.toml``).

    With the advisor off (``Config.advisor_enabled``) nothing is written and nothing is audited: the store keeps what
    it holds for the build that offers auto-pilot again, and no path can move it meanwhile.
    """
    if not mgr.cfg.advisor_enabled:
        return
    previous = mgr.presetops.autopilot.enabled
    if enabled:
        mgr.presetops.autopilot.enable()
    else:
        mgr.presetops.autopilot.disable()
    mgr.audit.autopilot_set(source, enabled=enabled, previous=previous)


def stamp_autopilot_on_active(mgr: ConnectionManager) -> None:
    """Fold auto-pilot's current state into the active preset, when auto-save is armed to do that.

    The switch writes only the top-level flag, and the per-preset copy was written by a save or an auto-save alone.
    So flipping the switch and loading a preset restored the copy as it stood before the flip, switching auto-pilot
    back off with nothing to reconcile the two. Gated on the same pair auto-save itself is gated on, because folding
    a change into the active preset unasked is exactly what auto-save is the user's permission for.
    """
    name = mgr.presetops.store.active
    if not name or not mgr.presetops.store.autosave:
        return
    _record_autopilot(mgr, name)


def _restore_autopilot(mgr: ConnectionManager, name: str) -> None:
    """Put auto-pilot back to what this preset carries.

    hqplayerd's config has no junk-filter field, so a config preset carries auto-pilot's state and nothing about the
    filter itself; auto-pilot settles the filter on its own from the next tick.
    """
    try:
        switch_autopilot(mgr, "preset.load", enabled=mgr.presetops.autopilot.for_preset(name))
    except AutopilotError as exc:
        log.warning("auto-pilot state not restored for preset %r: %s", name, exc)


async def switch(mgr: ConnectionManager, name: str) -> PresetActivation:
    """Make ``name`` the active preset as the first step of an apply.

    A named preset loads (restore + mirror); the empty name is the picker's "(no preset)" and only drops the
    bookmark. Never hqplayerd's ``profile/load``.
    """
    if not name:
        return unload(mgr)
    return await load(mgr, name)


def unload(mgr: ConnectionManager) -> PresetActivation:
    """Select "(no preset)".

    Drops HQPTuner's active-preset bookmark and leaves the running config exactly as it is.

    Nothing loads and nothing restarts. HQPlayer runs one settings file either way; the active preset is a label
    HQPTuner keeps on that file, not a second copy of its contents. Unload restores nothing: it only stops attributing
    the current settings to a preset. Answers the same ``PresetActivation`` ``load`` does, so the apply report reads
    the same either way.
    """
    mgr.presetops.store.set_active(None)
    return PresetActivation("")


async def save(mgr: ConnectionManager, name: str) -> PresetSaveResult:
    """Persist the current running config as preset ``name``.

    Stores our copy and mirrors it into the daemon's ``data/cfgs``. Called after a successful apply, so the running
    config already carries the user's edits.

    The store write is the save; the daemon mirror is a convenience for
    hqplayerd's own profile list. So the mirror runs AFTER the store commits and
    reports a warning rather than a failure: a save that reached disk is a save.
    A daemon, store or grounding failure before the commit raises to the caller, the way ``load`` does.
    """
    name = canonical_name(name)  # everything after keys on the trimmed name
    await settle.await_http_ready(mgr)  # the daemon restarts on every load and restore; backup() needs HTTP serving
    backup = await mgr.require_http().backup()
    working = engineconf.base_config_xml(backup, mgr.readings.active_config)
    if not working:
        raise NoRunningConfigToSaveError()
    # Live-routed edits (filters, dither/modulator, mode) never touched the
    # file, so the working config is stale for exactly those settings. Fold
    # the engine's current values in first — a save stores what the user is
    # hearing, not what happens to be on disk.
    working = presetconf.apply_edits(working, overrides.live_overrides(mgr))
    mgr.presetops.store.save(name, working, trigger="save")
    mgr.presetops.store.set_active(name)
    _record_autopilot(mgr, name)
    return PresetSaveResult(name, mirror=await _mirror(mgr, name, working, backup))


async def autosave(mgr: ConnectionManager) -> PresetSaveResult | None:
    """Fold the current audible state back into the active preset's store file.

    This is the auto-save checkbox's whole write path. Store only, never the daemon
    mirror: the mirror costs a restore restart, so it catches up by riding the
    next restore that happens anyway (``lanes/presetfields.autosave_mirror``).
    Returns None when
    auto-save is off or no preset is active. A failed auto-save raises to the
    caller, the same failure a standalone ``save`` raises.
    """
    name = mgr.presetops.store.active
    if not name or not mgr.presetops.store.autosave:
        return None
    backup = await mgr.require_http().backup()
    working = engineconf.base_config_xml(backup, mgr.readings.active_config)
    if not working:
        raise NoRunningConfigToAutosaveError()
    working = presetconf.apply_edits(working, overrides.live_overrides(mgr))
    mgr.presetops.store.save(name, working, trigger="autosave")
    _record_autopilot(mgr, name)
    return PresetSaveResult(name)


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


async def _mirror(mgr: ConnectionManager, name: str, working: bytes, backup: bytes) -> MirrorOutcome:
    """Plant ``data/cfgs/<name>.xml`` on the daemon so hqplayerd's native profile list mirrors our store.

    Retries through the shared settle loop instead of firing once: this runs
    right after an apply's own restore, so the daemon is routinely still
    restarting and a single-shot POST reports a failure the next second would
    not have seen. Re-sending is safe — the archive is the same bytes either
    way.
    """
    archive = presetzip.restore_zip_with_working(backup, working, mirror_name=name, mirror_xml=working)

    mark = settle.mark_connect(mgr)

    async def push() -> bool:
        await settle.restore(mgr, archive, mark=mark, scope="system")
        return True

    if await settle.poll_until(mgr, push, interval=RECONNECT_FAST):
        await settle.await_ready(mgr, mark)
        return MirrorOutcome.LANDED
    log.warning("preset %r saved, but its daemon mirror did not land", name)
    return MirrorOutcome.NOT_LANDED


async def delete(mgr: ConnectionManager, name: str) -> PresetDeleted:
    """Delete a preset from the store and remove its daemon mirror via ``profile/delete``.

    Restore is additive and cannot remove a member.

    Takes the preset's Matrix-tab mode and its station's live snapshots with it, after the store delete has
    succeeded: an entry keyed to a preset that is gone is read by nothing, and the next preset saved under the same
    name would otherwise inherit it.
    """
    name = canonical_name(name)  # the mirror was written under the trimmed name
    mgr.presetops.store.delete(name)
    # A store stamped by a newer HQPTuner must not stop a preset delete: one orphaned entry is cheaper than
    # that. A corrupt store is a different matter: it refuses rather than reading empty, and that refusal
    # propagates here too.
    with contextlib.suppress(MatrixModeSchemaError):
        mgr.presetops.matrix_modes.forget(name)
    with contextlib.suppress(LivePresetSchemaError):
        mgr.presetops.live_presets.forget(name)
    with contextlib.suppress(httpx.HTTPError, ControlError):
        await mgr.require_http().post_profile("delete", profile=name)
    return PresetDeleted(name)


async def migrate(mgr: ConnectionManager, active_hint: str | None, *, backup: bytes | None = None) -> list[str]:
    """One-time import of hqplayerd's existing ``data/cfgs`` presets into the store so nothing is orphaned.

    Idempotent — existing store presets win. Seeds the active pointer from the daemon's reported active config when
    the store has none. Returns the imported names. ``backup`` is a settings archive the caller already fetched;
    without one it is fetched here.
    """
    if backup is None:
        backup = await mgr.require_http().backup()
    snapshots = presetzip.snapshot_members(backup)
    imported = mgr.presetops.store.import_missing(snapshots)
    if mgr.presetops.store.active is None and active_hint and mgr.presetops.store.exists(active_hint):
        mgr.presetops.store.set_active(active_hint)
    return imported
