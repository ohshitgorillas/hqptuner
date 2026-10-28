"""The live write lane — one batch of live settings, applied on the spot.

``POST /api/config/live`` lands here. It is deliberately not stage+apply: the
pending buffer holds every staged edit (``core/pending.PendingStore``) and
``POST /config/apply`` flushes everything in it, so a live control routed through
that pair would also apply edits the user staged elsewhere and never asked for.
This lane touches neither the pending store nor the persistent 8088 lane, so it
cannot restart the daemon.

``result="OK"`` is not proof of application: every setter here is verified by a
``State`` readback, which is ``writer.apply_live``'s job and the reason this lane
reuses it rather than calling the setters itself.

No idle gate, here or anywhere in the write path (CLAUDE.md): a live setting
applies immediately even mid-playback, and what that costs is the user's to
spend.
"""

from __future__ import annotations

import dataclasses
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, NamedTuple

from hqptuner.engine.controlerrors import ControlError
from hqptuner.lanes.live import routing
from hqptuner.lanes.live.chain import active_chain
from hqptuner.lanes.writer import LiveWriteOk, LiveWriteResult, apply_live

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.engine.control import ControlClient
    from hqptuner.lanes import LaneManager
    from hqptuner.lanes.writer import Interrupted

log = logging.getLogger(__name__)

# Writes that invalidate an enumeration the NEXT live write resolves against:
# SetMode swaps the filter and shaper lists wholesale, and the rate list depends
# on both mode and the selected filter (manual §4.6). The loader re-enumerates on
# its poll interval, on a mode-index move and on a chain change, so without this
# the control the user reaches for next could resolve its value against a stale list
# until one of those came.
_REENUMERATES = frozenset({"mode", "filter"})


@dataclass(frozen=True)
class LiveApplyReport:
    """One LIVE batch's answer: each setter's readback verdict, and whether it moved an enumeration."""

    live: list[LiveWriteResult] = dataclasses.field(default_factory=list)
    # true when this batch moved an enumeration the next write resolves against (``_REENUMERATES``)
    reenumerated: bool = False


class SplitPlan(NamedTuple):
    """A staged batch after routing: what a mode-first write reported, what goes live, what goes to the restore lane."""

    report: list[LiveWriteResult]
    live_edits: dict[str, dict[str, str]]
    restore_fields: dict[str, str]


def _applied(report: list[LiveWriteResult], setting: str) -> bool:
    """Whether this setting is in the report and verified by readback."""
    return any(entry.setting == setting and isinstance(entry, LiveWriteOk) for entry in report)


async def write_live(
    mgr: LaneManager,
    client: ControlClient,
    edits: dict[str, dict[str, str]],
    *,
    on_interrupted: Interrupted | None = None,
) -> list[LiveWriteResult]:
    """Apply live edits, readback-verified (``writer.apply_live``).

    Every live-setter batch goes through here. ``on_interrupted`` is handed to
    ``writer.apply_live``, which names to it the setting a dropped connection interrupted.
    """
    return await apply_live(client, edits, mgr.audit, on_interrupted=on_interrupted)


async def chain_entered(mgr: LaneManager, client: ControlClient, before: str | None, *, reenumerated: bool) -> None:
    """Handle the engine having loaded a different filter/shaper chain: refresh the lists it enumerates.

    Nothing is put back on the chain it entered: a chain switch ends what the Engine
    held, and the lists the new chain enumerates are the Engine's own answer.

    The chain can change with the configured mode standing still. In `[source]`
    mode the engine follows the source (readme §1.7), so a DSD track after a PCM
    one swaps the filter and shaper lists without touching `State.mode` — and
    watching the mode index alone therefore served the previous chain's lists for
    the whole of the next track. `reenumerated` says the caller already pulled
    fresh lists for a mode change, so this does not pull them twice.
    """
    after = active_chain(mgr)
    if after is None or after == before:
        return
    log.info("chain changed (%s -> %s)", before or "unknown", after)
    if not reenumerated:
        enums = await client.get_all_enumerations()
        mgr.readings.take_engine(mgr.phase.standing.generation, enums=enums)


async def _reread_state(mgr: LaneManager, client: ControlClient) -> None:
    """Re-read State into the manager, keeping the last good reading when HQPlayer refuses the read."""
    state = await client.state_unless_refused()
    if state is not None:
        mgr.readings.take_engine(mgr.phase.standing.generation, state=state)


def _reenumerates(edits: dict[str, dict[str, str]]) -> bool:
    """Whether a live batch moves an enumeration the next write resolves against (``_REENUMERATES``)."""
    return bool(_REENUMERATES & set(edits))


async def refresh_after_live(mgr: LaneManager, client: ControlClient, edits: dict[str, dict[str, str]]) -> None:
    """Re-read what a live batch just invalidated: the running state always, the enumerations when the batch moved one.

    Live edits bypass the config file, so State is the only record of them. The
    enumerations are the subtler half: a write in ``_REENUMERATES`` swaps a list
    the NEXT write resolves its value against, and refreshing State alone also
    consumes the mode transition the loader watches to re-enumerate on its own
    (``core/loader._beat``) — so a caller that skipped this left both the cache and
    the fallback stale. Every live-routing caller runs it, staged lane included.
    A refused State read is a complete reply that says nothing of the engine, so the last good reading stands.
    """
    await _reread_state(mgr, client)
    if _reenumerates(edits):
        enums = await client.get_all_enumerations()
        mgr.readings.take_engine(mgr.phase.standing.generation, enums=enums)


async def _refresh_quietly(mgr: LaneManager, client: ControlClient, edits: dict[str, dict[str, str]]) -> None:
    """Refresh what the batch invalidated (``refresh_after_live``).

    A control failure here is logged, not raised: the write is already readback-verified.
    """
    try:
        await refresh_after_live(mgr, client, edits)
    except ControlError as exc:
        log.warning("post-apply refresh failed: %s", exc)


async def _after_mode(mgr: LaneManager, client: ControlClient) -> None:
    """Re-read State after a verified mode write, once the re-enumeration has run.

    Nothing is re-asserted on the chain the mode entered. A control failure is logged, not raised.
    """
    try:
        state = await client.get_state()
        mgr.readings.take_engine(mgr.phase.standing.generation, state=state)
    except ControlError as exc:
        log.warning("post-mode State re-read failed: %s", exc)


async def apply_now(mgr: LaneManager, fields: dict[str, str]) -> LiveApplyReport:
    """Apply one batch of LIVE config-form fields under ``mgr.live_writes`` (``_apply_batch``)."""
    async with mgr.live_writes:
        return await _apply_batch(mgr, fields)


async def _apply_batch(mgr: LaneManager, fields: dict[str, str]) -> LiveApplyReport:
    """Resolve, apply and readback-verify a batch of LIVE config-form fields; the caller holds ``mgr.live_writes``.

    A field of the chain the engine has not loaded refuses the batch (``routing.resolve_live``).

    Everything after `apply_live` is bookkeeping for the NEXT write — the write
    itself is already readback-verified — so a control-connection failure there is
    logged, not raised. `SetFilter` and `SetMode` reload the engine and the daemon
    can drop the connection under the refresh that follows; raising turned a change
    the user watched land into an error on the control they just touched. The loader
    redials and refills the readings (`core/loader.run`).
    """
    client = mgr.require_control()
    edits = routing.resolve_live(mgr, fields)
    report = await write_live(mgr, client, edits)
    await _refresh_quietly(mgr, client, edits)
    if _applied(report, "mode"):
        await _after_mode(mgr, client)
    return LiveApplyReport(report, _reenumerates(edits))


def mode_already_running(mgr: LaneManager, want: str) -> bool:
    """Whether the engine is already in the mode a preset asks for.

    Worth checking because ``SetMode`` is not free even when it changes nothing:
    it clears the engine's rate pin outright and reloads the chain. A preset saved and
    re-applied in the same mode should disturb neither.
    """
    index = (mgr.readings.state or {}).get("mode")
    if index is None:
        return False
    return routing.mode_form_value((mgr.readings.enums or {}).get("modes") or [], index) == want


async def apply_preset(mgr: LaneManager, fields: dict[str, str]) -> LiveApplyReport:
    """Apply a live snapshot — a batch that may carry the output mode.

    ``resolve_live`` refuses mode beside anything else, and rightly: ``SetMode``
    swaps the filter, shaper and rate enumerations, so indices resolved before it
    ran are stale after. A preset is not obliged to be one batch, though. The mode
    goes first on its own, which re-enumerates exactly as a hand-made mode write
    does, and the rest is then resolved against the lists that switch produced.

    This is what lets a preset mean "run SDM, like this". Applying one saved on
    the other chain is not a conflict to refuse: switching is the request.
    """
    mode = fields.get("mode")
    rest = {field: value for field, value in fields.items() if field != "mode"}
    async with mgr.live_writes:
        if mode is None or not rest:
            return await _apply_batch(mgr, fields)
        first = LiveApplyReport() if mode_already_running(mgr, mode) else await _apply_batch(mgr, {"mode": mode})
        second = await _apply_batch(mgr, rest)
        return LiveApplyReport([*first.live, *second.live], first.reenumerated or second.reenumerated)


def _mode_apart(http_fields: dict[str, str]) -> str | None:
    """Return the staged mode value when it goes on the wire as its own batch.

    Every live mode write does, whatever else is staged with it. ``SetMode`` swaps
    the lists every later value resolves against, so it has to go through the
    re-enumerating path (``apply_now``) — beside other routable fields because
    those fields resolve against the lists it swapped
    (``routing._mode_blocks_batch``), and ALONE because the batch after it does.
    A mode routed as an ordinary edit left the enumerations stale and the poll
    loop blind to the switch it watches for, so the next apply's filter resolved
    against the departed mode's list and the engine took a different filter than
    the one named.

    Only in a batch that can go fully live, though. One restore-lane field means
    the restart is happening regardless, and that restart boots the daemon onto
    its config file, so the mode belongs in that file with the rest of the batch,
    not on a live setter the restore would immediately overwrite.
    """
    if any(field not in routing.ROUTABLE for field in http_fields):
        return None
    return http_fields.get("mode")


async def apply_mode_first(mgr: LaneManager, mode: str) -> list[LiveWriteResult] | None:
    """Write a staged mode as its own re-enumerating batch; None when it cannot go live at all.

    A mode the engine is already running is not re-sent (``mode_already_running``). A mode the
    running enumerations cannot resolve is the one case that falls back to the restore lane,
    decided before anything is sent. A mode that reaches the daemon and does not verify stays in
    the report as a failed setter: the user was told before Apply this batch would not restart.
    """
    if mode_already_running(mgr, mode):
        return []
    _edits, unroutable = routing.split_live(mgr, {"mode": mode}, {})
    if unroutable:
        log.warning("mode-first batch fell back to the restore lane: mode %r does not resolve live", mode)
        return None
    return (await apply_now(mgr, {"mode": mode})).live


def split_remainder(
    mgr: LaneManager,
    http_fields: dict[str, str],
    live_edits: dict[str, dict[str, str]],
    report: list[LiveWriteResult],
) -> SplitPlan:
    """Split what is staged beside a mode already written, against the lists that switch produced.

    What falls back to the restore lane takes the mode with it: that restart boots the daemon
    from its config file, which never learned the mode just applied live.
    """
    rest = {name: value for name, value in http_fields.items() if name != "mode"}
    edits, remainder = routing.split_live(mgr, rest, live_edits)
    if remainder:
        remainder = {**remainder, "mode": http_fields["mode"]}
    return SplitPlan(report, edits, remainder)


async def mode_then_split(
    mgr: LaneManager, http_fields: dict[str, str], live_edits: dict[str, dict[str, str]]
) -> SplitPlan:
    """Route a staged batch, mode first.

    Without a re-enumeration between ``SetMode`` and the rest, a staged mode
    beside other routable fields sends the whole batch to the restore lane
    (``routing._mode_blocks_batch``) — one daemon restart, playback
    interrupted. ``apply_now`` is that re-enumeration, so the mode goes through it
    alone and the remainder splits against the lists the switch produced. A mode
    the engine is already running is dropped rather than re-sent — ``SetMode``
    clears the rate pin even when it changes nothing (``mode_already_running``).
    A mode that cannot resolve sends the whole batch to the restore lane
    (``apply_mode_first``). A mode that reaches the daemon and does not verify
    does NOT: the batch stays live and reports the setter as failed. A control
    lane that dies under the mode write aborts the apply: a dead socket is not an
    answer to route on.

    A staged mode with nothing beside it takes the same route (``_mode_apart``):
    the batch that needs the post-switch lists is then the NEXT apply rather than
    the remainder of this one, and it is no less entitled to them.
    """
    mode = _mode_apart(http_fields)
    if mode is None:
        edits, remainder = routing.split_live(mgr, http_fields, live_edits)
        return SplitPlan([], edits, remainder)
    report = await apply_mode_first(mgr, mode)
    if report is None:
        return SplitPlan([], live_edits, dict(http_fields))
    return split_remainder(mgr, http_fields, live_edits, report)
