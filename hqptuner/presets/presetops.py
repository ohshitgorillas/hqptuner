"""Preset lifecycle + filter parking + backup persistence (``manager.presetops``).

The preset store, the parked filter uploads, and the settings-archive
persistence (pre-apply disk copy plus the empty-``/backup`` workaround cache)
form one self-contained collaborator. The daemon-driving operations delegate
to ``presets/presetlane`` with the manager — this class owns the state, not a
second wire lane.
"""

import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

from hqptuner.conf import engineconf, matrixconf, presetconf, xmledit
from hqptuner.presets import presetlane
from hqptuner.presets.filterpark import FilterPark
from hqptuner.presets.presetstore import PresetError, PresetStore

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.config import Config
    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)


class PresetOps:
    """The manager's preset store, filter park, and settings-archive persistence as one collaborator."""

    def __init__(self, cfg: "Config", mgr: "ConnectionManager") -> None:
        """Open the store and filter park from ``cfg``'s directories, with no migration run and no cached backup."""
        self._cfg = cfg
        self._mgr = mgr
        # HQPTuner-owned preset store (presetstore) — the source of truth for
        # presets. hqplayerd's own named-profile subsystem is unreliable, so we
        # drive it only through restore-onto-[default] and keep data/cfgs mirrored.
        self.store = PresetStore(cfg.preset_dir, mgr.audit)
        self._filters = FilterPark(cfg.backup_dir / "pending-filters", cfg.hqp_home)
        self._migrated = False
        self.last_healthy_backup: bytes | None = None  # workaround for the profile-load backup bug

    # --- convolution uploads (filterpark, matrix-spec.md "Filter upload") --

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
        {preset: "ok" | error text}, empty when nothing was targeted; one bad
        target never blocks another. Delete runs before save per preset, the
        same rename ordering the config edit uses.
        """
        save_value = edits.get(matrixconf.MATRIX_PROFILE_SAVE)
        delete_value = edits.get(matrixconf.MATRIX_PROFILE_DELETE)
        save_to = matrixconf.save_targets(save_value) if save_value else []
        delete_name, delete_from = matrixconf.parse_delete(delete_value) if delete_value else ("", [])
        results: dict[str, str] = {}
        for preset in dict.fromkeys(delete_from + save_to):
            try:
                xml = self.store.read(preset)
                # target names WHICH copy the element landed in — a fan-out write
                # is otherwise indistinguishable from the running-config one
                before, target = xml, f"preset:{preset}"
                if preset in delete_from:
                    presetconf.audit_profile_delete(self._mgr.audit, before, delete_name, target)
                    xml = matrixconf.delete_profile(xml, delete_name)
                if save_value is not None and preset in save_to:
                    presetconf.audit_profile_write(self._mgr.audit, before, save_value, target)
                    xml = matrixconf.write_profile(xml, save_value)
                self.store.save(preset, xml, trigger="fanout")
                results[preset] = "ok"
            except (PresetError, xmledit.GroundingError, OSError) as exc:
                results[preset] = str(exc)
        return results

    def preset_profiles(self) -> dict[str, list[str]]:
        """Each stored preset's saved matrix-profile names, sorted.

        This is the read model behind the save/delete target pickers.
        """
        out: dict[str, list[str]] = {}
        for name in self.store.names():
            try:
                profiles = json.loads(matrixconf.read_profiles(self.store.read(name)))
            except (PresetError, OSError, ValueError):
                profiles = {}
            out[name] = sorted(profiles)
        return out

    # --- backup persistence ------------------------------------------------

    def persist_backup(self, data: bytes) -> Path | None:
        """Write the pre-apply settings backup to disk.

        A crash mid-apply then still leaves a recoverable copy (memory-only last_backup does not survive one).
        Best-effort: a write failure must not block the apply itself.
        """
        path = self._cfg.backup_dir / "pre-apply-settings.zip"
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        except OSError as exc:
            log.warning("could not persist pre-apply backup to %s: %s", path, exc)
            return None
        return path

    async def backup_or_cached(self, *, for_write: bool = False) -> bytes:
        """Fetch ``/backup``, caching it whenever it's a usable archive.

        WORKAROUND (docs/protocol.md): hqplayerd 6.0.4 serves an EMPTY ``settings.zip`` after a
        named ``profile/load`` (and after ``profile/save`` — observed live) until
        the service is restarted. When that happens, fall back to the last healthy
        archive we saw.

        ``for_write=True`` refuses that fallback. The cached archive carries a
        stale working config, and a restore built on it silently resurrects
        whatever the user changed since it was cached — writing old values back
        over new ones. A read may be stale; a write may not.
        """
        backup = await self._mgr.require_http().backup()
        if engineconf.base_config_xml(backup, self._mgr.active_config):  # working config resolved → usable
            self.last_healthy_backup = backup
            return backup
        summary = engineconf.archive_summary(backup)
        if for_write:
            # State the OBSERVATION, not a cause: an unresolvable archive reads
            # identically to the daemon's empty-backup bug, and asserting the bug
            # sent a reader chasing something a restart would not have cleared.
            log.warning("refusing to build a restore: unusable /backup — %s", summary)
            raise xmledit.GroundingError(
                "no working config in the daemon's /backup archive, so there is nothing to build a restore "
                "from. Either hqplayerd is serving an empty archive (a 6.0.4 bug after a profile load/save, "
                "cleared by restarting the service) or its working config is under a member name HQPTuner "
                f"could not resolve. The archive holds: {summary}"
            )
        if self.last_healthy_backup is not None:
            log.warning("unusable /backup from daemon (%s) — using cached archive", summary)
            return self.last_healthy_backup
        return backup  # no cache yet — let the caller fail with a clear message

    async def backup(self) -> bytes:
        """Return the daemon's current settings archive (a zip) for download."""
        return await self._mgr.require_http().backup()

    # --- preset lane (presetlane) — thin delegators over the store + restore ---

    def presets(self) -> dict[str, Any]:
        """Return the stored preset options plus the active name, shaped for the frontend's preset field."""
        return presetlane.listing(self._mgr)

    async def load_preset(self, name: str) -> dict[str, Any]:
        """Restore the stored preset ``name`` onto the daemon's working config and mark it active."""
        return await presetlane.load(self._mgr, name)

    async def save_preset(self, name: str) -> dict[str, Any]:
        """Snapshot the daemon's running config into the store as preset ``name`` and mirror it to ``data/cfgs``."""
        return await presetlane.save(self._mgr, name)

    async def delete_preset(self, name: str) -> dict[str, Any]:
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
