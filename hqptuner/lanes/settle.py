"""Waiting for the daemon to settle after a restart."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from hqptuner.lanes import LaneManager


@dataclass(frozen=True)
class Mark:
    """The connection generation a wait is measured from."""

    generation: int


async def _nothing() -> None:
    """Do nothing."""


def mark_connect(mgr: LaneManager) -> Mark:
    """Return the mark for the connection as it stands."""
    del mgr
    return Mark(0)


async def restore(mgr: LaneManager, data: bytes, *, mark: Mark | None, scope: str = "system") -> None:
    """Push ``data`` to the daemon."""


async def await_ready(mgr: LaneManager, mark: Mark | None) -> bool:
    """Return whether the daemon came back past ``mark``."""
    del mgr, mark
    await _nothing()
    return False


async def await_http_ready(mgr: LaneManager) -> bool:
    """Return whether the 8088 lane is serving."""
    del mgr
    await _nothing()
    return False


async def poll_until[T](
    mgr: LaneManager, probe: Callable[[], Awaitable[T | None]], *, interval: float, deadline: float | None = None
) -> T | None:
    """Return the first answer ``probe`` gives."""
    del mgr, probe, interval, deadline
    await _nothing()
    return None


async def fresh_backup(mgr: LaneManager) -> bytes | None:
    """Return a backup taken now."""
    del mgr
    await _nothing()
    return None


async def own_restart(mgr: LaneManager, request: Callable[[], Awaitable[object]], mark: Mark | None) -> None:
    """Run ``request`` and wait out the restart it causes."""


async def resync_engine_state(mgr: LaneManager) -> None:
    """Reread the engine's state."""
