"""Apply/dispatch operations (``manager.applyops``).

The staged-config apply, the engine-attribute apply, and the live volume write
form one self-contained collaborator. Each delegates to its lane with the
manager — this class owns the dispatch, not a second wire lane.

Operations that had nothing to add over their lane are not here: the matrix
profile switch and the speaker apply were one-line pass-throughs, so their
routes call ``lanes.matrixlane`` and ``lanes.http.speakerprocessing`` directly.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING

from hqptuner import voltrace
from hqptuner.conf import engineconf, httpauth
from hqptuner.engine.controlerrors import ControlError
from hqptuner.lanes import settle
from hqptuner.lanes.http import engineattrs, restore
from hqptuner.lanes.http.engineattrs import EngineVerification
from hqptuner.lanes.http.restore import RestoreDeclined, RestoreResult
from hqptuner.lanes.live import lane
from hqptuner.lanes.writer import LiveWriteOk, LiveWriteResult, apply_live
from hqptuner.presets import presetlane
from hqptuner.presets.presetlane import PresetActivation
from hqptuner.presets.presetops import PresetAftermath, after_restore

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.core.manager import ConnectionManager


def _trace_live_volume(
    mgr: "ConnectionManager",
    live_edits: dict[str, dict[str, str]],
    report: list[LiveWriteResult],
) -> None:
    """Record a volume the live lane just set, where this batch carried one.

    The second of the two paths that reach the playing volume. Emitted here rather than inside ``lanes/writer`` for
    two reasons: ``_apply_one`` is handed an ``AuditLog`` and not the manager, and the attribution field lives on the
    manager's readings — so emitting from the caller leaves every existing signature alone. A setter that returns
    without raising has had its readback matched (``lanes/writer``), so the value sent is the value confirmed.
    """
    want = live_edits.get("volume", {}).get("value")
    if want is None:
        return
    entry = next((row for row in report if row.setting == "volume"), None)
    ok = isinstance(entry, LiveWriteOk)
    voltrace.write(mgr, "live_lane", want, want if ok else None, ok=ok)


@dataclass(frozen=True)
class ApplyReport:
    """A staged apply's answer; the fields are the wire keys.

    ``live`` holds the live setters' results, ``persistent`` the persistent lane's, ``aftermath`` the restore's
    effect on stored presets, and ``switched`` the preset switch that runs before both lanes.
    """

    live: list[LiveWriteResult]
    persistent: RestoreResult | None
    aftermath: PresetAftermath
    switched: PresetActivation | None


async def _persistent_apply(
    mgr: "ConnectionManager", http_fields: dict[str, str], switch_to: str | None
) -> RestoreResult:
    """Return the persistent lane's outcome: declined as data, or the restore lane's own answer.

    Checked before the lane is ever called: a compound action's outcome is data, while the restore
    lane called alone raises the same refusal.
    """
    declined = httpauth.decline_error(mgr)
    if declined is not None:
        return RestoreDeclined(str(declined), declined.code)
    return await restore.apply(mgr, http_fields, switched=switch_to is not None)


async def _write_live(
    mgr: "ConnectionManager", live_edits: dict[str, dict[str, str]], staged: dict[str, str]
) -> list[LiveWriteResult]:
    """Send the batch's live-routed edits, readback-verified, and do the bookkeeping the next write relies on."""
    async with mgr.live_writes:
        client = mgr.require_control()
        report = await apply_live(client, live_edits, mgr.audit)
        _trace_live_volume(mgr, live_edits, report)
        await lane.refresh_after_live(mgr, client, live_edits)
        lane.remember_routed(mgr, report, staged)
        return report


@dataclass(frozen=True)
class EngineApplyResult:
    """The outcome of ``ApplyOps.apply_engine``. The fields are the wire keys."""

    verified: EngineVerification
    members: list[str]
    backup_bytes: int


@dataclass(frozen=True)
class VolumeReport:
    """A live volume write's readback: the level the engine reports after the write."""

    volume: str | None


class ApplyOps:
    """Dispatch the manager's three write operations to their lanes."""

    def __init__(self, mgr: "ConnectionManager") -> None:
        """Bind the operations to the manager whose clients, caches and lanes they write through."""
        self._mgr = mgr

    async def set_volume(self, db: str) -> VolumeReport:
        """Write the playback volume live, immediately, outside the staged-config apply flow.

        Raises CommandError when volume control is disabled (fixed volume / no-volume path;
        VolumeRange enabled=0). Returns the readback level so the caller echoes the applied value.
        """
        client = self._mgr.require_control()
        try:
            await client.set_volume(db)
        except ControlError:
            # recorded before it propagates: a refused write is exactly the one a
            # later reading cannot be told from a write that never happened
            voltrace.write(self._mgr, "api.volume", db, None, ok=False)
            raise
        self._mgr.readings.state = await client.get_state()
        readback = self._mgr.readings.state.get("volume")
        voltrace.write(self._mgr, "api.volume", db, readback, ok=True)
        return VolumeReport(readback)

    # --- write path (Phase 3) -----------------------------------------

    async def apply(
        self,
        live_edits: dict[str, dict[str, str]],
        http_fields: dict[str, str],
        switch_to: str | None = None,
    ) -> ApplyReport:
        """Apply staged changes.

        When ``switch_to`` is set the user previewed a different preset — load it first so it
        becomes the active preset (the only way HQPlayer sets the active label), then apply the
        staged tweaks on top of its snapshot. Then the live setters (readback-verified), then the
        persistent lane, which re-asserts the active snapshot ⊕ tweaks via POST /restore — so drift
        never survives — and self-corrects fixable divergence.
        """
        mgr = self._mgr
        switched = await presetlane.switch(mgr, switch_to) if switch_to is not None else None
        # A fully routable batch routes live through the Control API and never
        # restarts — a staged mode goes first as its own batch
        # (lane.mode_then_split); one restore-lane field sends the whole
        # batch to the restore lane instead (routing.split_live). Skipped on a
        # LOAD, which reloads anyway; an unload does not, so its staged edits
        # still split.
        if switch_to:
            plan = lane.SplitPlan([], live_edits, http_fields)
        else:
            plan = await lane.mode_then_split(mgr, http_fields, live_edits)
        live = plan.report
        if plan.live_edits:
            live = live + await _write_live(mgr, plan.live_edits, dict(http_fields))
        restore_fields = plan.restore_fields
        persistent = await _persistent_apply(mgr, restore_fields, switch_to) if restore_fields else None
        aftermath = await after_restore(mgr, persistent, restore_fields)
        # after all of it: a preset load is the FIRST step of an apply, so every
        # checkpoint inside the load reads state the live setters and the restore
        # have not touched yet. This one reads on a live-only apply too —
        # the apply that can move the volume without the config file hearing of it.
        voltrace.observe(mgr, "post_apply", {**voltrace.subset(mgr.readings.file_config), **voltrace.live_volume(mgr)})
        return ApplyReport(live, persistent, aftermath, switched)

    async def apply_engine(self, overrides: dict[str, str], *, all_presets: bool = False) -> EngineApplyResult:
        """Apply hardware-acceleration engine attributes via the config-file-only lane (`http.engineattrs`).

        The restore restarts the daemon and interrupts playback; nothing gates on that — the user
        decides when. A declined lane raises ``HttpLaneDeclinedError``, and a daemon that fails the
        write raises ``httpx.HTTPError``: the route turns either into a refusal.
        """
        mgr = self._mgr
        engineconf.validate_overrides(overrides)
        declined = httpauth.decline_error(mgr)
        if declined is not None:
            raise declined
        backup = await mgr.require_http().backup()
        mgr.presetops.persist_backup_for_apply(backup)
        result = await engineattrs.apply(mgr, backup, overrides, mgr.readings.active_config, all_presets=all_presets)
        # same restart, same stale readings as the staged-apply path above
        await settle.resync_engine_state(mgr)
        if result.verified.engine:
            mgr.readings.engine = result.verified.engine
        return EngineApplyResult(verified=result.verified, members=result.members, backup_bytes=result.backup_bytes)
