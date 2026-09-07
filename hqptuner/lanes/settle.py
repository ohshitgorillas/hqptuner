"""The settle loop every write lane rides after a restart or an engine reload.

A restore restarts the daemon (~5.6 s); a matrix/speakers form POST reloads the
engine (~3 s). Either way the lane that wrote has to wait for the daemon to
serve again and then confirm what actually landed — HQPTuner never reports a
success it did not read back.

Six lanes each grew their own copy of that loop. They are one shape: take a
deadline off the manager's clock, try a flaky probe, treat ``httpx.HTTPError``
as the expected post-restart transient rather than a failure, sleep, and give up
honestly at the deadline. Six copies is six chances for the retry semantics to
drift apart silently, which is exactly the class of bug a readback-verify path
must not have. This module is the one copy.

Pacing goes through ``ConnectionManager.sleep`` / ``.monotonic`` — the injectable
clock seams the suite virtualizes (docs/testing.md §7). A lane that reaches for
``asyncio.sleep`` or ``time.monotonic`` instead is a review flag.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx

from hqptuner.engine.control import ControlError

if TYPE_CHECKING:  # avoid a circular import at runtime
    from collections.abc import Awaitable, Callable

    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)

ZIP_MAGIC = b"PK\x03\x04"
#: How often the 8088 readiness probe re-asks inside the restart window.
HTTP_READY_INTERVAL = 1.0


@dataclass(frozen=True)
class Mark:
    """Where the manager's connection history stood when a write began."""

    connects: int
    drops: int


async def restore(mgr: ConnectionManager, cfgfile: bytes, *, mark: Mark | None, scope: str = "system") -> None:
    """POST a settings archive to ``/restore``, then start reconnecting the control lane it killed.

    Every restore the app submits goes through here, so every one of them reports
    its restart at once (``ConnectionManager.restarting``) instead of at the next
    poll. ``mark`` is the caller's ``mark_connect``, taken before the restore and
    handed to ``await_ready`` after: the drop follows the mark, not a fresh read
    of ``ready``, so a connect body that finishes during the POST is neither
    dropped from under the caller nor waited for by it. Those two decisions are
    one decision, made once.
    """
    await mgr.require_http().restore(cfgfile, scope=scope)
    if mark is not None:
        await mgr.restarting()


def mark_connect(mgr: ConnectionManager) -> Mark | None:
    """Return the manager's connect and drop counts while it holds a whole control connection, else None.

    None says there is no whole control connection for the restart to kill, so
    ``await_ready`` has nothing to wait for and returns at once. It reads
    ``connected`` rather than ``ready``: an install whose configuration lane is
    down still has a control connection the restart will take, and a caller that
    marked None there would return without waiting for the restart at all.
    """
    return Mark(mgr.connects, mgr.drops) if mgr.connected.is_set() else None


async def await_ready(mgr: ConnectionManager, mark: Mark | None) -> bool:
    """Wait until a drop and a connect have both landed after ``mark``, or the alarm window passes.

    ``await_http_ready`` proves only that the 8088 lane answers; after a restore
    the 4321 connection is the dead one the restart left behind and the readings
    on it are the previous engine's. This waits for the reconnect ``restore`` set
    in motion, so the caller returns to a manager whole on both lanes. The counts
    date the connect: a flag alone cannot say whether the readiness it reports
    predates this caller's restore.

    A connect alone is not enough. ``restarting`` drops the control lane the instant the
    POST returns, but hqplayerd goes on answering on 4321 for a moment yet (protocol.md
    "POST /restore"), so the reconnect can land on the daemon instance that has not
    restarted; the real restart then drops it, and that drop is the Unreachable a user
    sees after a Connected they should never have been shown. The counting drop is what
    proves the restart happened, so this waits for a drop and then a connect after it.

    The deadline runs on the real clock, not the lanes' virtualized seams
    (docs/testing.md rule 7, owner-approved for this site): what it waits for is
    a reconnect the poll loop physically has to perform, so a virtual clock would
    run the deadline out with no chance for it to happen. The wake is every edge of the
    connection itself (``mgr.changed``), so a reconnect landing 50 ms in returns 50 ms in.

    Best-effort: False means the deadline passed or there was nothing to wait
    for, which the caller reports rather than papers over.
    """
    if mark is None:
        return False
    end = time.monotonic() + mgr.alarm_threshold
    while mgr.drops <= mark.drops or mgr.connects <= mark.connects:
        remaining = end - time.monotonic()
        if remaining <= 0:
            return False
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(mgr.changed.wait(), remaining)
        mgr.changed.clear()
    return True


async def resync_engine_state(mgr: ConnectionManager) -> None:
    """Re-read the engine after something restarted it, so nothing reads the old engine's answers.

    ``state``, ``enums`` and ``live`` all describe a daemon process that is gone the moment a
    restore restarts it, and only the poll loop refreshes them — a second later. Anything reading
    in between (``overrides.live_overrides``, and so every save and auto-save) reports the settings
    of the engine that was running BEFORE the restart and writes them into the preset that just
    replaced it.

    Invalidated first and refilled second on purpose: the fetch can fail, and a reader that lands
    on ``state = None`` overlays nothing, which stores the config as loaded. Stale answers are the
    one outcome this must never leave behind.
    """
    mgr.readings.live.forget()
    mgr.readings.state = None
    client = mgr.control
    if client is None:
        return
    try:
        state = await client.get_state()
        enums = await client.get_all_enumerations()
    except ControlError as exc:
        # the poll loop's own reconnect refills both; until then None is the honest answer
        log.warning("engine resync after restart failed: %s", exc)
        return
    mgr.readings.state, mgr.readings.enums = state, enums


async def await_http_ready(mgr: ConnectionManager) -> bool:
    """Wait until the HTTP config lane serves again.

    The daemon restarts on a preset load and on every restore, and its active
    label flips before the restart completes, so a caller must not read 'label
    switched' as 'ready to write'.
    """

    async def probe() -> bool:
        await mgr.require_http().get_config()
        return True

    return bool(await poll_until(mgr, probe, interval=HTTP_READY_INTERVAL))


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


async def fresh_backup(mgr: ConnectionManager) -> bytes | None:
    """Return a ``/backup`` archive, or ``None`` while the daemon is mid-restart.

    A restarting daemon answers /backup with something that is not a zip yet —
    reading a config out of it would report garbage as realized state, so the
    zip magic is checked before anything parses the bytes.
    """
    data = await mgr.require_http().backup()
    return data if data[:4] == ZIP_MAGIC else None
