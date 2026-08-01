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

import contextlib
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:  # avoid a circular import at runtime
    from ..core.manager import ConnectionManager

ZIP_MAGIC = b"PK\x03\x04"


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
    """A ``/backup`` archive, or ``None`` while the daemon is mid-restart.

    A restarting daemon answers /backup with something that is not a zip yet —
    reading a config out of it would report garbage as realized state, so the
    zip magic is checked before anything parses the bytes."""
    data = await mgr.require_http().backup()
    return data if data[:4] == ZIP_MAGIC else None
