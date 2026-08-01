"""Preset lifecycle + filter parking + backup persistence (``manager.presetops``).

Extracted from ``manager`` for the file cap: the preset store, the parked filter
uploads, and the settings-archive persistence (pre-apply disk copy plus the
empty-``/backup`` workaround cache) form one self-contained collaborator. The
daemon-driving operations delegate to ``lanes/presetlane`` with the manager,
exactly as before — this class owns the state, not a second wire lane.
"""

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..conf import engineconf, xmledit
from .filterpark import FilterPark
from ..lanes import presetlane
from .presetstore import PresetStore

if TYPE_CHECKING:  # avoid a circular import at runtime
    from ..config import Config
    from ..core.manager import ConnectionManager

log = logging.getLogger(__name__)


class PresetOps:
    def __init__(self, cfg: "Config", mgr: "ConnectionManager") -> None:
        self._cfg = cfg
        self._mgr = mgr
        # HQPTuner-owned preset store (presetstore) — the source of truth for
        # presets. hqplayerd's own named-profile subsystem is unreliable, so we
        # drive it only through restore-onto-[default] and keep data/cfgs mirrored.
        self.store = PresetStore(cfg.preset_dir)
        self._filters = FilterPark(cfg.backup_dir / "pending-filters", cfg.hqp_home)
        self._migrated = False
        self.last_healthy_backup: bytes | None = None  # workaround for the profile-load backup bug

    # --- convolution uploads (filterpark, matrix-spec.md "Filter upload") --

    def park_filter(self, name: str, data: bytes) -> dict[str, str]:
        return self._filters.park(name, data)

    def parked_filter_members(self) -> dict[str, bytes]:
        return self._filters.members()

    def clear_parked_filters(self) -> None:
        self._filters.clear()

    # --- backup persistence ------------------------------------------------

    def persist_backup(self, data: bytes) -> Path | None:
        """Write the pre-apply settings backup to disk so a crash mid-apply still
        leaves a recoverable copy (memory-only last_backup does not survive one).
        Best-effort: a write failure must not block the apply itself."""
        path = self._cfg.backup_dir / "pre-apply-settings.zip"
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        except OSError as exc:
            log.warning("could not persist pre-apply backup to %s: %s", path, exc)
            return None
        return path

    async def backup_or_cached(self, *, for_write: bool = False) -> bytes:
        """Fetch ``/backup``, caching it whenever it's a usable archive. WORKAROUND
        (docs/protocol.md): hqplayerd 6.0.4 serves an EMPTY ``settings.zip`` after a
        named ``profile/load`` (and after ``profile/save`` — observed live) until
        the service is restarted. When that happens, fall back to the last healthy
        archive we saw.

        ``for_write=True`` refuses that fallback. The cached archive carries a
        stale working config, and a restore built on it silently resurrects
        whatever the user changed since it was cached — writing old values back
        over new ones. A read may be stale; a write may not."""
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
        """The daemon's current settings archive (a zip) for download."""
        return await self._mgr.require_http().backup()

    # --- preset lane (presetlane) — thin delegators over the store + restore ---

    def presets(self) -> dict[str, Any]:
        return presetlane.listing(self._mgr)

    async def load_preset(self, name: str) -> dict[str, Any]:
        return await presetlane.load(self._mgr, name)

    async def save_preset(self, name: str) -> dict[str, Any]:
        return await presetlane.save(self._mgr, name)

    async def delete_preset(self, name: str) -> dict[str, Any]:
        return await presetlane.delete(self._mgr, name)

    async def migrate_once(self, active_hint: str | None = None) -> None:
        if self._migrated or self._mgr.http_client is None:
            return
        self._migrated = True
        imported = await presetlane.migrate(self._mgr, active_hint)
        if imported:
            log.info("migrated presets into store: %s", ", ".join(imported))
