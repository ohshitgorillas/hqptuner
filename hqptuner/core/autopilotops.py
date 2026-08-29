"""Driving the high-frequency filter for the listener — auto-pilot's one write.

A background task of its own, started by the app lifespan beside the metering reader whose verdict it acts on, and
started only where that reader is. Deliberately not a route: the advisor's note is computed on demand by
``GET /api/status``, which only fires while a browser is open, and auto-pilot has to keep working for someone who is
only listening.

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
from hqptuner.lanes.live import lane, routing
from hqptuner.presets.store.autopilot import AutopilotError

if TYPE_CHECKING:
    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)


def _enabled(mgr: ConnectionManager) -> bool:
    """Return whether auto-pilot is on, and False when its state cannot be read at all."""
    try:
        return mgr.presetops.autopilot.enabled
    except AutopilotError as exc:
        log.warning("auto-pilot state unreadable: %s", exc)
        return False


def _junk_filters(mgr: ConnectionManager) -> list[dict[str, str]]:
    """Return the running junk-filter enumeration, empty until the engine has answered for it."""
    return (mgr.enums or {}).get("junk_filters") or []


def _move(mgr: ConnectionManager) -> tuple[str, str | None] | None:
    """Return the junk filter auto-pilot wants and the one engaged, or None when there is no move to make.

    None covers every reason to do nothing at all: auto-pilot off, no metering reader (``HQPTUNER_METERING_ENABLED=0``,
    or no stream to read), an engine that is not answering, a state file that cannot be read, and the ordinary case of
    the engaged filter already being the wanted one.
    """
    reader = mgr.metering
    if reader is None or not _enabled(mgr):
        return None
    ctx = context_from(mgr)
    if ctx is None:
        return None
    want = autopilot.desired_junk_filter(reader.verdict(), ctx.filter)
    return None if want == ctx.junk_filter else (want, ctx.junk_filter)


async def act(mgr: ConnectionManager) -> None:
    """Move the engine's junk filter to what the playing track asks for, if auto-pilot is on.

    A no-op unless the engaged filter differs from what the signature wants, so a settled track costs one comparison
    per poll and no daemon traffic at all.
    """
    move = _move(mgr)
    if move is None:
        return
    want, engaged = move
    index = autopilot.junk_filter_index(_junk_filters(mgr), want)
    if index is None:
        log.warning("auto-pilot wanted junk filter %r, which the running enumeration does not carry", want)
        return
    log.info("auto-pilot: junk filter %s -> %s", engaged, want)
    try:
        await lane.apply_now(mgr, {"junk_filter": index})
    except (ControlError, routing.LiveRouteError) as exc:
        log.warning("auto-pilot write failed: %s", exc)


async def run(mgr: ConnectionManager, interval: float) -> None:
    """Act once per tick until the task is cancelled, which is how the lifespan stops it.

    A loop of its own rather than a step inside the manager's poll: what auto-pilot reads is the metering reader's
    latched verdict, and the reader is a background task for the same reason. The cadence follows the status poll
    because everything the decision reads is refreshed by it, and ticking faster would only re-ask the same question.
    The wait is the manager's own, which the test suite virtualizes (``docs/testing.md`` §7).
    """
    while True:
        await act(mgr)
        await mgr.sleep(interval)
