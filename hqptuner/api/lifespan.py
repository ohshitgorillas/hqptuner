"""Application lifespan — start the poll loop, the metering reader and auto-pilot, shutting all three down cleanly."""

import asyncio
import contextlib
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager

from fastapi import FastAPI

from hqptuner.conf.httpconf import HttpConfigClient
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
    http_client: HttpConfigClient | None,
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    """Build the lifespan handler bound to the app's manager, config, and 8088 client."""

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
        await manager.aclose()
        if http_client is not None:
            await http_client.aclose()

    return lifespan
