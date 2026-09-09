"""Application lifespan — start the poll loop, the metering reader and auto-pilot, shutting all three down cleanly."""

import asyncio
import contextlib
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager

from fastapi import FastAPI

from hqptuner.config import Config
from hqptuner.core import autopilotops
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.metering import MeteringReader, context_from

SHUTDOWN_GRACE = 2.0  # seconds the poll loop gets to notice its stop flag


async def _finish(task: asyncio.Task[None], grace: float) -> None:
    """Give a background task ``grace`` seconds to exit on its own stop flag, then cancel it.

    Shutdown must not wait on a daemon that has stopped answering: the poll loop's 8088 lane retries per request, so a
    wedged web server otherwise costs a full multiple of the request timeout.
    """
    with contextlib.suppress(asyncio.CancelledError, TimeoutError):
        await asyncio.wait_for(task, grace)


def make_lifespan(
    cfg: Config,
    manager: ConnectionManager,
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    """Build the lifespan handler bound to the app's manager and config.

    The 8088 client is read off the manager at shutdown rather than captured here: a runtime credential change
    installs a new one, and a captured client would leave the live one open and close one nobody is using.
    """

    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        task = asyncio.create_task(manager.run())
        # junk-filter advisor's metering reader — best-effort alongside the poll
        # loop; an absent 4322 stream just means "no recommendation". Switched off
        # entirely, nothing is constructed and nothing ever connects.
        reader: MeteringReader | None = None
        metering_task: asyncio.Task[None] | None = None
        # The high-frequency filter's auto-pilot acts on that reader's verdict, so it
        # runs exactly where the reader does and nowhere else: with metering off there
        # is nothing for it to read and nothing it could honestly decide.
        autopilot_task: asyncio.Task[None] | None = None
        if cfg.metering_enabled:
            reader = MeteringReader(cfg.hqp_host, cfg.hqp_metering_port, lambda: context_from(manager))
            manager.metering = reader
            metering_task = asyncio.create_task(reader.run())
            autopilot_task = asyncio.create_task(autopilotops.run(manager, cfg.poll_interval))
        yield
        manager.stop()
        if autopilot_task is not None:
            await _finish(autopilot_task, 0)
        if reader is not None and metering_task is not None:
            reader.stop()
            # no grace for the reader: it blocks in readexactly, which its stop flag
            # cannot interrupt, so waiting on it always costs the full grace
            await _finish(metering_task, 0)
        await _finish(task, SHUTDOWN_GRACE)
        live = manager.http_client
        # `aclose` closes the control lane and every retired 8088 client; the one still in service is ours.
        await manager.aclose()
        if live is not None:
            await live.aclose()

    return lifespan
