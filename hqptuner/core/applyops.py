"""Apply/dispatch operations (``manager.applyops``).

The staged-config apply, the engine-attribute apply, and the live volume write
form one self-contained collaborator. Each delegates to its lane with the
manager — this class owns the dispatch, not a second wire lane.

Operations that had nothing to add over their lane are not here: the matrix
profile switch and the speaker apply were one-line pass-throughs, so their
routes call ``lanes.matrixlane`` and ``lanes.http.speakerprocessing`` directly.
"""

from typing import TYPE_CHECKING, Any

import httpx

from hqptuner.conf import engineconf, httpconf
from hqptuner.engine.control import ControlError
from hqptuner.lanes.http import engineattrs, restore
from hqptuner.lanes.live import lane
from hqptuner.lanes.writer import apply_live
from hqptuner.presets import presetlane

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.core.manager import ConnectionManager


class ApplyOps:
    """Dispatch the manager's three write operations to their lanes."""

    def __init__(self, mgr: "ConnectionManager") -> None:
        """Bind the operations to the manager whose clients, caches and lanes they write through."""
        self._mgr = mgr

    async def set_volume(self, db: str) -> dict[str, Any]:
        """Write the playback volume live, immediately, outside the staged-config apply flow.

        Raises CommandError when volume control is disabled (fixed volume / no-volume path;
        VolumeRange enabled=0). Returns the readback level so the caller echoes the applied value.
        """
        client = self._mgr.control
        if client is None:
            raise ControlError("daemon not connected")
        await client.set_volume(db)
        self._mgr.readings.state = await client.get_state()
        return {"volume": self._mgr.readings.state.get("volume")}

    # --- write path (Phase 3) -----------------------------------------

    async def apply(
        self,
        live_edits: dict[str, dict[str, str]],
        http_fields: dict[str, str],
        switch_to: str | None = None,
    ) -> dict[str, Any]:
        """Apply staged changes.

        When ``switch_to`` is set the user previewed a different preset — load it first so it
        becomes the active preset (the only way HQPlayer sets the active label), then apply the
        staged tweaks on top of its snapshot. Then the live setters (readback-verified), then the
        persistent lane, which re-asserts the active snapshot ⊕ tweaks via POST /restore — so drift
        never survives — and self-corrects fixable divergence.
        """
        mgr = self._mgr
        switched: dict[str, Any] | None = None
        if switch_to is not None:
            switched = await presetlane.switch(mgr, switch_to)
        # A fully routable batch routes live through the Control API and never
        # restarts — a staged mode goes first as its own batch
        # (lane.mode_then_split); one restore-lane field sends the whole
        # batch to the restore lane instead (routing.split_live). Skipped on a
        # LOAD, which reloads anyway; an unload does not, so its staged edits
        # still split.
        staged = dict(http_fields)
        live_report: list[dict[str, Any]] = []
        if not switch_to:
            live_report, live_edits, http_fields = await lane.mode_then_split(mgr, http_fields, live_edits)
        if live_edits:
            client = mgr.control
            if client is None:
                raise ControlError("daemon not connected")
            live_report = live_report + await apply_live(client, live_edits, mgr.audit)
            await lane.refresh_after_live(mgr, client, live_edits)
            lane.remember_routed(mgr, live_report, staged)
        persistent = await restore.apply(mgr, http_fields, switched=switch_to is not None) if http_fields else None
        if persistent is not None and persistent.get("applied"):
            # the restore restarted the daemon, so every live reading we hold belongs
            # to the process it replaced — and the auto-save that follows this apply
            # reads exactly those (ConnectionManager.resync_engine_state)
            await mgr.resync_engine_state()
            # the restore that just applied carried the parked filter files —
            # they live on the daemon now, so the parking area is done with them
            mgr.presetops.clear_parked_filters()
            # profile verbs staged with fan-out targets also land in those
            # stored preset files — after the restore, so a refused apply
            # fans out nothing (presetops.fanout_profiles)
            # the applied config was backfilled inside apply_edits; the stored
            # presets carry their own copies of the same profiles and are filled
            # from their own matrices here (presetops.backfill_profiles).
            # BEFORE the fan-out below: backfill is a migration of profiles
            # saved earlier, and the user's own save is the write that should
            # land last on any preset both of them touch.
            backfilled = mgr.presetops.backfill_profiles()
            if backfilled:
                persistent["profile_backfill"] = backfilled
            fanout = mgr.presetops.fanout_profiles(http_fields)
            if fanout:
                persistent["profile_fanout"] = fanout
        return {"live": live_report, "persistent": persistent, "switched": switched}

    async def apply_engine(self, overrides: dict[str, str], *, all_presets: bool = False) -> dict[str, Any]:
        """Apply hardware-acceleration engine attributes via the config-file-only lane (`http.engineattrs`).

        The restore restarts the daemon and interrupts playback; nothing gates on that — the user
        decides when.
        """
        mgr = self._mgr
        engineconf.validate_overrides(overrides)
        if mgr.http_client is None:
            return {"submitted": False, "error": "no credentials for HTTP config lane"}
        if mgr.readings.credentials_ok is False:
            # same guard, same reason as the staged-apply lane (http.restore.apply)
            return {"submitted": False, "reason": "credentials", "error": httpconf.AUTH_REFUSED_MESSAGE}
        try:
            backup = await mgr.presetops.backup_or_cached()
            mgr.presetops.persist_backup(backup)
            result = await engineattrs.apply(
                mgr, backup, overrides, mgr.readings.active_config, all_presets=all_presets
            )
        except httpx.HTTPError as exc:
            return {"submitted": False, "error": str(exc)}
        # same restart, same stale readings as the staged-apply path above
        await mgr.resync_engine_state()
        engine = result["verified"].get("engine")
        if engine:
            mgr.readings.engine = engine
        return result
