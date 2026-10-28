"""The one way out for a request that restarts or reloads the daemon, and the waits on what it did.

Every wait runs on ``mgr.clock`` and carries a deadline that defaults to the window, ``alarm_threshold``. A deadline
passed is answered as a result for the caller to report, never raised.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import httpx

from hqptuner.lanes import LaneStamp
from hqptuner.lanes.http import forms

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from hqptuner.lanes import LaneManager

log = logging.getLogger(__name__)

#: A restart request's stamp: the generation it was accepted in and when. A wait for the restart to land is a wait
#: for Ready at a later generation than this one's.
type Mark = LaneStamp

_TAKEN_DOWN = "the daemon accepted a request that restarts or reloads it"

ZIP_MAGIC = b"PK\x03\x04"


class _BeforeAny:
    """A mark every generation is later than: Ready after it is Ready at all."""

    generation = -1
    at = 0.0


async def restart(mgr: LaneManager, request: Callable[[], Awaitable[object]]) -> Mark:
    """Send ``request``, which restarts or reloads the daemon, and return the stamp to wait on.

    The stamp is written as the daemon accepts the request, and the control socket is taken down after it. A
    request that raises leaves no stamp and takes nothing down.
    """
    await request()
    mark: Mark = mgr.phase.request_accepted(mgr.clock.monotonic())
    await mgr.take_control_down(_TAKEN_DOWN)
    return mark


async def await_ready(mgr: LaneManager, mark: Mark, deadline: float | None = None) -> bool:
    """Wait for Ready at a generation later than ``mark``'s; answer whether it came before ``deadline``."""
    return bool(await mgr.phase.until_ready(after=mark, clock=mgr.clock, deadline=deadline))


async def await_serving(mgr: LaneManager, deadline: float | None = None) -> bool:
    """Wait for Ready at any generation, the standing one included; answer whether it came before ``deadline``."""
    return await await_ready(mgr, _BeforeAny(), deadline)


async def poll_until[T](
    mgr: LaneManager, probe: Callable[[], Awaitable[T | None]], *, interval: float, deadline: float | None = None
) -> T | None:
    """Read a write back every ``interval`` until ``probe`` confirms it, and return the confirming answer.

    ``probe`` answers something truthy once the readback confirms; a falsy answer or an HTTP error is a pass that
    did not. A confirmation is reported to the phase, which settles a pending request in place when the generation
    has not moved. ``None`` is the deadline passed, after one last read at it.
    """
    clock = mgr.clock
    until = clock.monotonic() + (mgr.cfg.alarm_threshold if deadline is None else deadline)
    while True:
        try:
            answer = await probe()
        except httpx.HTTPError as exc:
            log.debug("readback pass failed on the wire: %s", exc)
        else:
            if answer:
                mgr.phase.readback_confirmed(clock.monotonic())
                return answer
        remaining = until - clock.monotonic()
        if remaining <= 0:
            return None
        await clock.sleep(min(interval, remaining))


async def fresh_backup(mgr: LaneManager) -> bytes | None:
    """Return a ``/backup`` archive taken now, or ``None`` if the 8088 lane is declined or the answer is not a zip.

    Bytes that are not a zip are refused before anything parses them, so garbage is never read as realized state;
    the zip magic is checked first. A failed fetch raises ``httpx.HTTPError``, which ``poll_until`` reads as a pass
    that did not confirm.
    """
    if forms.decline(mgr) is not None:
        return None
    data = await mgr.require_http().backup()
    return data if data[:4] == ZIP_MAGIC else None
