"""Application lifespan — start the poll loop, the metering reader and auto-pilot, shutting all three down cleanly."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager

from fastapi import FastAPI

from hqptuner.config import Config
from hqptuner.core import autopilotops, junkcal
from hqptuner.core.clock import Clock
from hqptuner.core.connection import ConnectionRecord, ConnectionStore, build_http_client, host_is_unchosen
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.controlerrors import ControlError
from hqptuner.engine.discovery import probe
from hqptuner.engine.metering import MeteringReader
from hqptuner.engine.trackcontext import context_from
from hqptuner.presets.store.jsonfile import StoreCorruptError

SHUTDOWN_GRACE = 2.0  # seconds the poll loop gets to notice its stop flag

log = logging.getLogger(__name__)


async def _adopt_alias(cfg: Config, connections: ConnectionStore, manager: ConnectionManager) -> None:
    """Point an install that has chosen no host at the daemon on the container's own host, where one answers.

    Only where nothing else named a host, so a saved record and a pinned variable both keep their meaning.
    The address is written to the config and to no store: nobody chose it, so it is asked again next start,
    and the first host the user saves replaces it. The 8088 client is rebuilt because the one ``create_app``
    built captured the address it was constructed with, which would leave the config lane on the old host
    while the control lane runs against the new one.
    """
    record: ConnectionRecord | None = None
    try:
        record = connections.read()
    except StoreCorruptError as exc:
        log.warning("%s — starting unconfigured", exc)
    if not host_is_unchosen(record):
        return
    try:
        answered = await probe(
            cfg.container_host_alias, cfg.hqp_control_port, cfg.request_timeout, deadline=manager.clock
        )
    except (OSError, ControlError):
        return
    cfg.hqp_host = answered.address
    manager.http_client = build_http_client(cfg)


async def _finish(task: asyncio.Task[None], grace: float, clock: Clock) -> None:
    """Give a background task ``grace`` seconds on ``clock`` to exit on its own stop flag, then cancel it.

    Shutdown must not wait on a daemon that has stopped answering: the poll loop's 8088 lane retries per request, so a
    wedged web server otherwise costs a full multiple of the request timeout.
    """
    finished = asyncio.Event()
    task.add_done_callback(lambda _: finished.set())
    if not await clock.wait(finished, grace):
        task.cancel()
    with contextlib.suppress(asyncio.CancelledError, TimeoutError):
        await task


def make_lifespan(
    cfg: Config,
    manager: ConnectionManager,
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    """Build the lifespan handler bound to the app's manager and config.

    The 8088 client is read off the manager at shutdown rather than captured here: a runtime credential change
    installs a new one, and a captured client would leave the live one open and close one nobody is using.
    """

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Before the poll loop and the metering reader, both of which read the host as it stands now.
        await _adopt_alias(cfg, app.state.connections, manager)
        task = manager.clock.spawn(manager.run())
        # junk-filter advisor's metering reader — best-effort alongside the poll
        # loop; an absent 4322 stream just means "no recommendation". Switched off
        # entirely, nothing is constructed and nothing ever connects.
        reader: MeteringReader | None = None
        metering_task: asyncio.Task[None] | None = None
        # The high-frequency filter's auto-pilot acts on that reader's verdict, so it
        # runs exactly where the reader does and nowhere else: with metering off there
        # is nothing for it to read and nothing it could honestly decide.
        autopilot_task: asyncio.Task[None] | None = None
        # The calibration capture reads the same verdict and writes files only.
        junkcal_task: asyncio.Task[None] | None = None
        if cfg.metering_enabled and cfg.advisor_enabled:
            reader = MeteringReader(
                cfg.hqp_host,
                cfg.hqp_metering_port,
                lambda: context_from(manager),
                pace=manager.clock.pace,
                monotonic=manager.clock.monotonic,
            )
            manager.metering = reader
            metering_task = manager.clock.spawn(reader.run())
            autopilot_task = manager.clock.spawn(autopilotops.run(manager, cfg.poll_interval))
            if cfg.junkcal_dir is not None:
                junkcal_task = manager.clock.spawn(junkcal.run(manager, cfg.junkcal_dir))
        yield
        manager.stop()
        if junkcal_task is not None:
            await _finish(junkcal_task, 0, manager.clock)
        if autopilot_task is not None:
            await _finish(autopilot_task, 0, manager.clock)
        if reader is not None and metering_task is not None:
            reader.stop()
            # no grace for the reader: it blocks in readexactly, which its stop flag
            # cannot interrupt, so waiting on it always costs the full grace
            await _finish(metering_task, 0, manager.clock)
        await _finish(task, SHUTDOWN_GRACE, manager.clock)
        live = manager.http_client
        # `aclose` closes the control lane and every retired 8088 client; the one still in service is ours.
        await manager.aclose()
        if live is not None:
            await live.aclose()

    return lifespan
