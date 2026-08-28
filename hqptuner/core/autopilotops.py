"""Driving the high-frequency filter for the listener — auto-pilot's one write.

Runs off the poll loop rather than off a route. The advisor's note is computed on demand by ``GET /api/status``, which
only fires while a browser is open; auto-pilot has to keep working for someone who is only listening, so it lives
where the manager already has a connection and a tick.

The write goes through the ordinary LIVE lane (``lanes.live.lane.apply_now``), which readback-verifies it and records
it in the event log like any other durable write. Nothing about it is privileged: it is the same ``SetJunkFilter`` the
user's own dropdown sends, and it costs the stream nothing (manual §2.8 — playback filters switch during playback).

A failure here is auto-pilot's, not the daemon's, and is logged rather than raised: a listener whose filter did not
move is a worse outcome than nothing, but a supervisor loop that died trying is worse still.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from hqptuner.engine.control import ControlError
from hqptuner.engine.metering import context_from
from hqptuner.lanes import autopilot
from hqptuner.lanes.live import lane
from hqptuner.presets.store.autopilot import AutopilotError

if TYPE_CHECKING:
    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)


async def act(mgr: ConnectionManager) -> None:
    """Move the engine's junk filter to what the playing track asks for, if auto-pilot is on.

    A no-op unless the engaged filter differs from what the signature wants, so a settled track costs one comparison
    per poll and no daemon traffic at all. Silent when auto-pilot is off, when the metering reader is not running
    (``HQPTUNER_METERING_ENABLED=0``, or no stream to read), or when the engine is not answering.
    """
    try:
        if mgr.metering is None or not mgr.autopilot.enabled:
            return
        baseline = mgr.autopilot.baseline
    except AutopilotError as exc:
        log.warning("auto-pilot state unreadable: %s", exc)
        return
    ctx = context_from(mgr)
    if ctx is None:
        return
    want = autopilot.desired_junk_filter(mgr.metering.verdict(), baseline, ctx.filter)
    if want == ctx.junk_filter:
        return
    index = autopilot.junk_filter_index((mgr.enums or {}).get("junk_filters") or [], want)
    if index is None:
        log.warning("auto-pilot wanted junk filter %r, which the running enumeration does not carry", want)
        return
    log.info("auto-pilot: junk filter %s -> %s", ctx.junk_filter, want)
    try:
        await lane.apply_now(mgr, {"junk_filter": index})
    except ControlError as exc:
        log.warning("auto-pilot write failed: %s", exc)
