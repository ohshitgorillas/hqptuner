"""Preset lifecycle + filter parking + backup persistence (``manager.presetops``).

The preset store, the parked filter uploads, and the settings-archive
persistence (the pre-apply disk copy) form one self-contained collaborator.
The daemon-driving operations delegate to the preset lane with the manager;
this class owns the state.
"""

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from hqptuner.conf import matrixpayload, matrixprofiles, presetconf, xmledit
from hqptuner.errors import HQPTunerError
from hqptuner.lanes import settle
from hqptuner.lanes.http.restore import RestoreOutcome, RestoreResult
from hqptuner.presets import presetlane
from hqptuner.presets.store.autopilot import AutopilotStore
from hqptuner.presets.store.filterpark import PARK_DIR, FilterPark
from hqptuner.presets.store.matrixmode import MatrixModeStore
from hqptuner.presets.store.presets import PresetError, PresetStore

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.config import Config
    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)


class BackupFailedError(HQPTunerError):
    """The pre-apply settings backup could not be written to disk.

    The backup is taken before a destructive restore, so a caller that proceeds
    without it is writing over the only copy; a failed write therefore raises
    and the operation stops. Each subclass renders one sentence for its calling
    context: the tail ("Check free space and permissions on {dir}, then try
    again.") is shared, only the opening clause names what was being done when
    the write failed.
    """

    code = "backup_failed"


class BackupBeforeLoadFailedError(BackupFailedError):
    """The pre-apply backup failed while about to restore a stored preset onto the daemon."""

    def __init__(self, *, name: str, directory: Path) -> None:
        """Render the load-specific wording, naming the preset and the backup directory."""
        super().__init__(
            f"The backup before loading {name} failed, so nothing was changed. "
            f"Check free space and permissions on {directory}, then try again."
        )


class BackupBeforeApplyFailedError(BackupFailedError):
    """The pre-apply backup failed while about to apply hardware-acceleration engine attributes."""

    def __init__(self, *, directory: Path) -> None:
        """Render the apply-specific wording, naming the backup directory."""
        super().__init__(
            "The backup before applying engine settings failed, so nothing was changed. "
            f"Check free space and permissions on {directory}, then try again."
        )


class BackupBeforeRestoreFailedError(BackupFailedError):
    """The pre-apply backup failed while about to push a persistent-lane restore."""

    def __init__(self, *, directory: Path) -> None:
        """Render the restore-specific wording, naming the backup directory."""
        super().__init__(
            "The backup before restoring the configuration failed, so nothing was changed. "
            f"Check free space and permissions on {directory}, then try again."
        )


@dataclass(frozen=True)
class PresetAftermath:
    """What an applied restore did to the stored presets: the staged profile fan-out.

    Chain backfills run as part of the same restore but are not reported here. Maps a preset to "ok"
    or the code of the error that preset met; empty when nothing was targeted or the restore did not converge.
    """

    fanout: dict[str, str]


async def after_restore(
    mgr: "ConnectionManager", persistent: RestoreResult | None, http_fields: dict[str, str]
) -> PresetAftermath:
    """Settle what an applied restore leaves behind, and land its profile verbs in the stored presets.

    An empty fan-out unless the restore converged. It restarted the daemon, so every live reading
    belongs to the process it replaced — and the auto-save that follows reads exactly those.
    The parked filter files it carried live on the daemon now.
    Backfill runs BEFORE the fan-out: it migrates profiles saved earlier, and the user's own
    save is the write that should land last on any preset both touch. A refused apply fans out
    nothing.
    """
    if persistent is None or persistent.outcome is not RestoreOutcome.APPLIED:
        return PresetAftermath({})
    await settle.resync_engine_state(mgr)
    ops = mgr.presetops
    ops.clear_parked_filters()
    ops.backfill_profiles()
    return PresetAftermath(ops.fanout_profiles(http_fields))


def _failure_code(exc: Exception) -> str:
    """Return the stable code for one preset's fan-out or backfill failure.

    The error's own code for an ``HQPTunerError``, ``invalid_input`` for an edit with no place in that preset's
    XML, and ``store_unwritable`` for a read or write the filesystem refused.
    """
    if isinstance(exc, HQPTunerError):
        return exc.code
    if isinstance(exc, xmledit.GroundingError):
        return "invalid_input"
    return "store_unwritable"


class PresetOps:
    """The manager's preset store, filter park, and settings-archive persistence as one collaborator."""

    def __init__(self, cfg: "Config", mgr: "ConnectionManager") -> None:
        """Open the store and filter park from ``cfg``'s directories, with no migration run."""
        self._cfg = cfg
        self._mgr = mgr
        # HQPTuner-owned preset store (store.presets) — the source of truth for
        # presets. hqplayerd's own named-profile subsystem is unreliable, so we
        # drive it only through restore-onto-[default] and keep data/cfgs mirrored.
        self.store = PresetStore(cfg.preset_dir, mgr.audit)
        # The high-frequency filter's auto-pilot (store.autopilot). It lives here
        # because half of what it stores is per-preset — which saved preset carries
        # it — and a preset save and load are what put that half in and take it out.
        self.autopilot = AutopilotStore(cfg.autopilot_file)
        # Which half of the Matrix tab each preset is listened through
        # (store.matrixmode). Here for the same reason auto-pilot's state is: it
        # is keyed by preset name, so a preset delete is what takes an entry out.
        self.matrix_modes = MatrixModeStore(cfg.matrix_mode_file)
        self._filters = FilterPark(cfg.backup_dir / PARK_DIR, cfg.hqp_home)
        self._migrated = False

    # --- convolution uploads (store.filterpark, matrix-spec.md "Filter upload") --

    @property
    def filter_max_bytes(self) -> int:
        """Per-file byte limit an upload must not exceed (``Config.filter_max_bytes``), read by the upload route."""
        return self._cfg.filter_max_bytes

    def park_filter(self, name: str, data: bytes) -> dict[str, str]:
        """Park one uploaded filter, returning its stored name and the daemon-side path a process string should use."""
        return self._filters.park(name, data)

    def parked_filter_members(self) -> dict[str, bytes]:
        """Return the parked uploads as ``data/<name>`` members to fold into a restore archive."""
        return self._filters.members()

    def clear_parked_filters(self) -> None:
        """Discard every parked upload, called once an apply has shipped them to the daemon."""
        self._filters.clear()

    # --- matrix-profile fan-out (matrix-spec.md "Profiles") ----------------

    def fanout_profiles(self, edits: dict[str, str]) -> dict[str, str]:
        """Apply the staged profile verbs' fan-out targets to stored presets.

        A save or delete staged with a ``presets`` list also lands in those
        stored preset XMLs — a pure file edit reusing the same element writers
        as the config edit, so every copy is byte-identical. The daemon is never
        touched: it sees a preset only when that preset is loaded. Returns
        {preset: "ok" | error code}, empty when nothing was targeted; one bad
        target never blocks another. Delete runs before save per preset, the
        same rename ordering the config edit uses.
        """
        save_value = edits.get(matrixprofiles.MATRIX_PROFILE_SAVE)
        delete_value = edits.get(matrixprofiles.MATRIX_PROFILE_DELETE)
        save_to = matrixprofiles.save_targets(save_value) if save_value else []
        delete_name, delete_from = matrixpayload.parse_delete(delete_value) if delete_value else ("", [])
        results: dict[str, str] = {}
        for preset in dict.fromkeys(delete_from + save_to):
            try:
                xml = self.store.read(preset)
                # target names WHICH copy the element landed in — a fan-out write
                # is otherwise indistinguishable from the running-config one
                before, target = xml, f"preset:{preset}"
                if preset in delete_from:
                    presetconf.audit_profile_delete(self._mgr.audit, before, delete_name, target)
                    xml = matrixprofiles.delete_profile(xml, delete_name)
                if save_value is not None and preset in save_to:
                    presetconf.audit_profile_write(self._mgr.audit, before, save_value, target)
                    xml = matrixprofiles.write_profile(xml, save_value)
                self.store.save(preset, xml, trigger="fanout")
                results[preset] = "ok"
            except (PresetError, xmledit.GroundingError, OSError) as exc:
                results[preset] = _failure_code(exc)
        return results

    def backfill_profiles(self) -> dict[str, str]:
        """Backfill every stored preset's chain-less profiles from that preset's own live matrix.

        The applied config gets this in ``presetconf.apply_edits``; a stored
        preset is a config the daemon has not read yet, carrying its own copies
        of the same profiles, so without this the bug comes back the next time
        the preset is loaded.

        Each preset is filled from ITS OWN ``<matrix>`` — a speaker preset must
        never inherit a headphone preset's chain. Returns {preset: "ok" | error
        code}, carrying only the presets actually written; a preset that needed
        no change is absent, and one bad preset never blocks another.
        """
        results: dict[str, str] = {}
        for preset in self.store.names():
            try:
                xml = self.store.read(preset)
                filled = matrixprofiles.backfill_profile_chains(xml)
                if filled != xml:
                    self.store.save(preset, filled, trigger="backfill")
                    results[preset] = "ok"
            except (PresetError, xmledit.GroundingError, OSError) as exc:
                results[preset] = _failure_code(exc)
        return results

    def preset_profiles(self) -> dict[str, list[str]]:
        """Each stored preset's saved matrix-profile names, sorted.

        This is the read model behind the save/delete target pickers.
        """
        out: dict[str, list[str]] = {}
        for name in self.store.names():
            try:
                profiles = json.loads(matrixprofiles.read_profiles(self.store.read(name)))
            except (PresetError, OSError, ValueError):
                profiles = {}
            out[name] = sorted(profiles)
        return out

    # --- backup persistence ------------------------------------------------

    def persist_backup_for_load(self, data: bytes, name: str) -> Path:
        """Write the pre-apply settings backup to disk ahead of loading preset ``name`` onto the daemon.

        Raises ``BackupBeforeLoadFailedError`` on a write failure — see ``_write_backup``.
        """
        try:
            return self._write_backup(data)
        except OSError as exc:
            raise BackupBeforeLoadFailedError(name=name, directory=self._cfg.backup_dir) from exc

    def persist_backup_for_apply(self, data: bytes) -> Path:
        """Write the pre-apply settings backup to disk ahead of applying hardware-acceleration engine attributes.

        Raises ``BackupBeforeApplyFailedError`` on a write failure — see ``_write_backup``.
        """
        try:
            return self._write_backup(data)
        except OSError as exc:
            raise BackupBeforeApplyFailedError(directory=self._cfg.backup_dir) from exc

    def persist_backup_for_restore(self, data: bytes) -> Path:
        """Write the pre-apply settings backup to disk ahead of pushing a persistent-lane restore.

        Raises ``BackupBeforeRestoreFailedError`` on a write failure — see ``_write_backup``.
        """
        try:
            return self._write_backup(data)
        except OSError as exc:
            raise BackupBeforeRestoreFailedError(directory=self._cfg.backup_dir) from exc

    def _write_backup(self, data: bytes) -> Path:
        """Write the pre-apply settings backup to disk, returning its path.

        A crash mid-apply then still leaves a recoverable copy (memory-only last_backup does not survive one). The
        backup is taken before a destructive restore, so a caller that proceeded on a failed write would be writing
        over the only copy — a failed write here must stop the restore, not merely log it. Raises ``OSError`` on a
        failed write; each public caller turns that into its own ``BackupFailedError`` subclass, naming the backup
        directory.
        """
        path = self._cfg.backup_dir / "pre-apply-settings.zip"
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        except OSError as exc:
            log.warning("could not persist pre-apply backup to %s: %s", path, exc)
            raise
        return path

    async def backup(self) -> bytes:
        """Return the daemon's current settings archive (a zip) for download."""
        return await self._mgr.require_http().backup()

    # --- preset lane (presetlane) — thin delegators over the store + restore ---

    def presets(self) -> presetlane.PresetListing:
        """Return the stored preset options plus the active name, shaped for the frontend's preset field."""
        return presetlane.listing(self._mgr)

    async def load_preset(self, name: str) -> presetlane.PresetActivation:
        """Restore the stored preset ``name`` onto the daemon's working config and mark it active."""
        return await presetlane.load(self._mgr, name)

    async def save_preset(self, name: str) -> presetlane.PresetSaveResult:
        """Snapshot the daemon's running config into the store as preset ``name`` and mirror it to ``data/cfgs``."""
        return await presetlane.save(self._mgr, name)

    async def delete_preset(self, name: str) -> presetlane.PresetDeleted:
        """Remove preset ``name`` from the store and drop its mirror on the daemon."""
        return await presetlane.delete(self._mgr, name)

    async def migrate_once(self, active_hint: str | None = None) -> None:
        """Import the daemon's own ``data/cfgs`` presets into the store, at most once per process and only over HTTP."""
        if self._migrated or self._mgr.http_client is None:
            return
        self._migrated = True
        imported = await presetlane.migrate(self._mgr, active_hint)
        if imported:
            log.info("migrated presets into store: %s", ", ".join(imported))
