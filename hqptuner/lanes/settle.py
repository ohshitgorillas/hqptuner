"""The wait every write lane rides after a restart or an engine reload, and the restart boundary itself.

A restore restarts the daemon (~5.6 s); a matrix/speakers form POST reloads the engine (~3 s). Either
way the lane that wrote has to wait for the daemon to serve again, prove the process it is talking to
is the new one, and confirm what landed — HQPTuner never reports a success it did not read back, and
never lets a read cross a restart boundary unproven.

``poll_until`` is the one copy of the retry shape every lane needs; ``push_restore`` /
``await_restart`` / ``resync_engine_state`` are the boundary built on it.

Pacing goes through ``ConnectionManager.sleep`` / ``.monotonic`` — the injectable clock seams the
suite virtualizes (docs/testing.md §7). A lane reaching for ``asyncio.sleep`` or ``time.monotonic``
instead is a review flag.
"""

from __future__ import annotations

import contextlib
import logging
from typing import TYPE_CHECKING

import httpx

from hqptuner.engine.control import CommandError, ControlError

if TYPE_CHECKING:  # avoid a circular import at runtime
    from collections.abc import Awaitable, Callable

    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)

ZIP_MAGIC = b"PK\x03\x04"

RECONNECT_FAST = 1.0
# How long a restore's restart has to produce a new process (`await_restart`) —
# the ~5.6 s restart (docs/protocol.md) with room for a loaded host.
_RESTART_WINDOW = 15.0
# What the supervisor loop treats as "the daemon, not us": a refused or severed socket, a
# timeout, a non-2xx on the 8088 lane, a command the engine rejected. These are the faults
# `daemon unreachable` is an honest report of. Anything outside this set is a bug of ours,
# and the loop's second clause keeps it loud instead of dressing it as an outage.
WIRE_FAULTS = (ControlError, CommandError, httpx.HTTPError, OSError, TimeoutError)


async def poll_until[T](
    mgr: ConnectionManager,
    probe: Callable[[], Awaitable[T | None]],
    *,
    interval: float,
    deadline: float | None = None,
) -> T | None:
    """Call ``probe`` until it answers truthily, then return that answer.

    ``httpx.HTTPError`` from the probe is the post-restart transient (connection
    refused, 502 out of the reload window), not a verdict — keep polling. A
    falsy answer means "not there yet", same treatment. Returns ``None`` when the
    deadline passes first, which every caller reports as an unconfirmed apply
    rather than papering over.

    ``deadline`` defaults to the alarm threshold: the window past which the
    manager already calls the daemon unreachable, so waiting longer here would
    only duplicate that alarm.
    """
    end = mgr.monotonic() + (mgr.alarm_threshold if deadline is None else deadline)
    while mgr.monotonic() < end:
        with contextlib.suppress(httpx.HTTPError):
            result = await probe()
            if result:
                return result
        await mgr.sleep(interval)
    return None


async def await_http_ready(mgr: ConnectionManager) -> bool:
    """Wait until the HTTP config lane serves again.

    The daemon restarts on a preset load and on every restore, and its active label flips before
    the restart completes — so callers must not assume 'label switched' means 'ready to write'.
    """

    async def probe() -> bool:
        await mgr.require_http().get_config()
        return True

    return bool(await poll_until(mgr, probe, interval=RECONNECT_FAST))


async def fresh_backup(mgr: ConnectionManager) -> bytes | None:
    """Return a ``/backup`` archive, or ``None`` while the daemon is mid-restart.

    A restarting daemon answers /backup with something that is not a zip yet —
    reading a config out of it would report garbage as realized state, so the
    zip magic is checked before anything parses the bytes.
    """
    data = await mgr.require_http().backup()
    return data if data[:4] == ZIP_MAGIC else None


async def push_restore(mgr: ConnectionManager, data: bytes, scope: str = "system") -> None:
    """POST a settings archive to ``/restore`` and mark the restart it triggers as owed.

    Every restore in HQPTuner goes through here so the mark cannot be forgotten: the 200 says
    the files are on disk, the restart follows it, and ``await_restart`` answers for THIS push.
    """
    mgr.restore_baseline = mgr.generation
    await mgr.require_http().restore(data, scope=scope)


async def await_restart(mgr: ConnectionManager) -> bool:
    """Whether the daemon has restarted onto the config the last ``push_restore`` sent.

    ``POST /restore`` answers 200 before the restart, and the departing process keeps serving both
    lanes for ~5.6 s (docs/protocol.md) — so neither the 200 nor the HTTP lane answering again is
    evidence the restart happened. The proof is a new Control API connection generation. It is asked
    against the PUSH's generation rather than the caller's, so two waiters on one restart both get
    the answer instead of the second waiting out a restart that already happened.

    False means 'the engine cannot be trusted', never 'it restarted'. True at once when no restore is
    outstanding, and when there is no connection to observe: nothing is readable off an engine we are
    not connected to, so the boundary guards nothing.
    """
    baseline = mgr.restore_baseline
    if baseline is None or mgr.control is None:
        return True
    # NOT the alarm threshold: that is how long an unreachable daemon may go
    # unreported, and a deployment tuning it below the restart would never see one.
    deadline = max(_RESTART_WINDOW, mgr.alarm_threshold)

    async def probe() -> bool:
        if mgr.generation != baseline:
            return True
        client = mgr.control
        if client is not None:
            try:
                await client.get_info()
            except (ControlError, OSError):
                await mgr.drop("restart in progress")
            else:
                return False  # the process that took the restore is still answering
        with contextlib.suppress(*WIRE_FAULTS):
            await mgr.connect_and_load()  # whatever answers now is a new process
        return mgr.generation != baseline

    return bool(await poll_until(mgr, probe, interval=RECONNECT_FAST, deadline=deadline))


async def resync_engine_state(mgr: ConnectionManager) -> None:
    """Re-read the engine after something restarted it, so nothing reads the old engine's answers.

    ``state``, ``enums`` and ``live`` describe a process the restart replaced, and only the poll loop
    refreshes them — anything reading in between (``liveoverrides.live_overrides``, and so every save
    and auto-save) folds the old engine's settings into the preset that just replaced it.

    Invalidated first and refilled second: a failed refill must leave the picture invalid rather than
    stale, because a reader landing on ``state = None`` overlays nothing while a stale read stores
    the wrong engine's settings. The refill waits for the restart itself (``await_restart``, against
    the restore that was pushed), then RETRIES the read, since the poll loop can drop the connection
    between the boundary and that read.
    """
    mgr.live.forget()
    mgr.state = None
    if mgr.control is None:
        return  # no lane to resync: nothing was read off an engine, nothing to put back
    if not await await_restart(mgr):
        log.warning("engine resync: no restarted daemon within the deadline, live state left invalid")
        return

    async def refill() -> bool:
        return await _refill_engine(mgr)

    if await poll_until(mgr, refill, interval=RECONNECT_FAST, deadline=_RESTART_WINDOW):
        return
    log.warning("engine resync: the restarted daemon never answered, live state left invalid")


async def _refill_engine(mgr: ConnectionManager) -> bool:
    """Read state and enumerations off the current process, reconnecting first if the loop dropped it."""
    try:
        await mgr.connect_and_load()  # no-op when a connection is already up
        client = mgr.control
        if client is None:
            return False
        mgr.state = await client.get_state()
        mgr.enums = await client.get_all_enumerations()
    except WIRE_FAULTS:
        # the client we hold is the dead one, and holding it makes the reconnect
        # above a no-op — so let it go and let the next attempt bring a live one up
        await mgr.drop("engine resync read failed")
        return False
    return True
