"""HQPTuner-owned preset lane (``store.presets`` + the daemon's restore primitive).

Presets live in a store HQPTuner owns (``store.presets``); the daemon
is driven only through ``POST /restore`` onto ``[default]`` — never
``profile/load``/``profile/save``, which are unreliable. A load's restore
carries the loaded preset's ``data/cfgs`` mirror; a save only stores, and its mirror rides the next restore that happens
anyway.

Every function takes the ``ConnectionManager`` and reaches the daemon through its
public accessors, exactly like the other lanes. It lives under ``presets`` rather
than ``lanes`` because it depends on the store, as do ``restore_hooks`` and
``preset_mirror`` in ``presets/presetfields.py``, which the http lanes are
handed by their callers.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from hqptuner import voltrace
from hqptuner.conf import engineconf, presetconf, presetiface, presetzip
from hqptuner.engine.controlerrors import ControlError
from hqptuner.lanes import settle
from hqptuner.presets import fileconfig
from hqptuner.presets.realized import realized_config
from hqptuner.presets.store.autopilot import AutopilotError
from hqptuner.presets.store.presets import canonical_name

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.presets import PresetManager

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class PresetSaveResult:
    """A save that reached the store, under the name it was stored as."""

    name: str


@dataclass(frozen=True)
class PresetOption:
    """One entry of the preset picker: the preset name it selects, and the label it shows."""

    value: str
    label: str


@dataclass(frozen=True)
class PresetListing:
    """The preset picker's contents: the selected name, every option, and the active preset."""

    value: str
    options: list[PresetOption]
    active: str


@dataclass(frozen=True)
class PresetActivation:
    """A preset load, unload or switch: the preset now active ("" for the unnamed default)."""

    name: str


class NoRunningConfigToSaveError(ControlError):
    """``save`` found no running config in the backup archive to fold the current settings into."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("HQPlayer's settings backup has no running configuration, so there is nothing to save.")


def listing(mgr: PresetManager) -> PresetListing:
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
    return PresetListing(value=active, options=options, active=active)


async def read(mgr: PresetManager, name: str) -> dict[str, str]:
    """Read a preset's saved settings in form-field terms for the editor preview — no daemon touch.

    A named preset reads from the store; the empty ("(no preset)") selection reads the current running config.
    """
    if not name:
        return dict(mgr.readings.file_config or await fileconfig.load_file_config(mgr))
    return presetconf.read_config(mgr.presetops.store.read(name))


async def load(mgr: PresetManager, name: str) -> PresetActivation:
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
    await settle.await_serving(mgr)  # the daemon restarts on every load and restore; backup() needs HTTP serving
    backup = await mgr.require_http().backup()
    mgr.presetops.persist_backup_for_load(backup, name)
    xml = presetiface.keep_interfaces(xml, engineconf.base_config_xml(backup, mgr.readings.active_config))
    archive = presetzip.restore_zip_with_working(backup, xml, mirror_name=name, mirror_xml=xml)
    mark = await settle.restart(mgr, lambda: mgr.require_http().restore(archive, "system"))
    mgr.presetops.store.set_active(name)
    mgr.audit.preset_load(name, previous)
    reconnected = await settle.await_ready(mgr, mark)
    # what the daemon came back on. Null means no reading reached us from the engine,
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


def switch_autopilot(mgr: PresetManager, source: str, *, enabled: bool) -> None:
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


def _restore_autopilot(mgr: PresetManager, name: str) -> None:
    """Put auto-pilot back to what this preset carries.

    hqplayerd's config has no junk-filter field, so a config preset carries auto-pilot's state and nothing about the
    filter itself; auto-pilot settles the filter on its own from the next tick.
    """
    try:
        switch_autopilot(mgr, "preset.load", enabled=mgr.presetops.autopilot.for_preset(name))
    except AutopilotError as exc:
        log.warning("auto-pilot state not restored for preset %r: %s", name, exc)


async def switch(mgr: PresetManager, name: str) -> PresetActivation:
    """Make ``name`` the active preset as the first step of an apply.

    A named preset loads (restore + mirror); the empty name is the picker's "(no preset)" and only drops the
    bookmark. Never hqplayerd's ``profile/load``.
    """
    if not name:
        return unload(mgr)
    return await load(mgr, name)


def unload(mgr: PresetManager) -> PresetActivation:
    """Select "(no preset)".

    Drops HQPTuner's active-preset bookmark and leaves the running config exactly as it is.

    Nothing loads and nothing restarts. HQPlayer runs one settings file either way; the active preset is a label
    HQPTuner keeps on that file, not a second copy of its contents. Unload restores nothing: it only stops attributing
    the current settings to a preset. Answers the same ``PresetActivation`` ``load`` does, so the apply report reads
    the same either way.
    """
    mgr.presetops.store.set_active(None)
    return PresetActivation("")


async def save(mgr: PresetManager, name: str) -> PresetSaveResult:
    """Persist the current running config as preset ``name``.

    Called after a successful apply, so the running config already carries the user's edits.

    Store only: the store write is the save, and it never
    restores. hqplayerd's own profile list catches up through the mirror the
    restores that happen anyway carry (``presets/presetfields.preset_mirror``).
    An apply that restores has already stored this config under ``name`` before
    its restore carried the mirror, so this store write repeats it from the backup. A
    daemon, store or grounding failure raises to the caller, the way ``load`` does.
    """
    name = canonical_name(name)  # everything after keys on the trimmed name
    await settle.await_serving(mgr)  # the daemon restarts on every load and restore; backup() needs HTTP serving
    backup = await mgr.require_http().backup()
    working = engineconf.base_config_xml(backup, mgr.readings.active_config)
    if not working:
        raise NoRunningConfigToSaveError()
    # A save stores the realized config: the File with the Engine's stamped live-domain values written in.
    working = presetconf.apply_edits(working, realized_config({}, {}, mgr.readings.engine_snapshot()))
    mgr.presetops.store.save(name, working, trigger="save")
    mgr.presetops.store.set_active(name)
    _record_autopilot(mgr, name)
    return PresetSaveResult(name)


def _record_autopilot(mgr: PresetManager, name: str) -> None:
    """Record auto-pilot's current state as the one preset ``name`` carries.

    The high-frequency filter's auto-pilot has no home in the XML — hqplayerd's config carries no junk-filter field at
    all — so a preset's copy of it goes into HQPTuner's own store, keyed by the name just written.

    Runs after the store commit and is best-effort: the preset already reached disk, and a store we cannot write is not
    worth failing a good save over.
    """
    try:
        mgr.presetops.autopilot.set_for_preset(name, enabled=mgr.presetops.autopilot.enabled)
    except AutopilotError as exc:
        log.warning("auto-pilot state not recorded for preset %r: %s", name, exc)


def _migration_owed(mgr: PresetManager) -> bool:
    """Whether the import of the daemon's own presets is still owed: not yet run in this process, and HTTP is up."""
    return not mgr.presetops.migrated and mgr.http_client is not None


async def migrate_once(mgr: PresetManager, active_hint: str | None, *, backup: bytes | None = None) -> None:
    """Import hqplayerd's existing ``data/cfgs`` presets into the store, at most once per process and only over HTTP.

    Idempotent — existing store presets win. Seeds the active pointer from the daemon's reported active config when
    the store has none. ``backup`` is a settings archive the caller already fetched; without one it is fetched here.
    """
    if not _migration_owed(mgr):
        return
    mgr.presetops.migrated = True
    if backup is None:
        backup = await mgr.require_http().backup()
    imported = mgr.presetops.store.import_missing(presetzip.snapshot_members(backup))
    if mgr.presetops.store.active is None and active_hint and mgr.presetops.store.exists(active_hint):
        mgr.presetops.store.set_active(active_hint)
    if imported:
        log.info("migrated presets into store: %s", ", ".join(imported))
