"""File readers preserve the generation in which each acquisition began."""

import asyncio
from collections.abc import Callable, Coroutine
from typing import Any

import httpx
import pytest
from conftest import DaemonFactory
from narrow import FixtureError

from hqptuner.conf.httpconf import HttpConfigClient, HttpOptions
from hqptuner.core import loader
from hqptuner.core.lifecycle import Fact
from hqptuner.core.manager import ConnectionManager
from hqptuner.core.readings import Source, Stamp
from hqptuner.lanes.http import forms, speakerprocessing
from hqptuner.presets import fileconfig

Reader = Callable[[ConnectionManager], Coroutine[Any, Any, object]]
SOURCE_PATHS = {
    "file_config": "/backup/settings.zip",
    "engine": "/backup/settings.zip",
    "config_form": "/config",
    "matrix_form": "/matrix",
    "speakers_form": "/speakers",
}
READERS = [
    pytest.param("file_config", fileconfig.load_file_config, id="archive"),
    pytest.param("engine", fileconfig.read_engine, id="engine"),
    pytest.param("config_form", forms.refresh, id="config"),
    pytest.param("matrix_form", forms.refresh, id="matrix"),
    pytest.param("speakers_form", forms.refresh, id="speakers"),
]
FORM_PATHS = [
    pytest.param("config_form", "/config", id="config"),
    pytest.param("matrix_form", "/matrix", id="matrix"),
    pytest.param("speakers_form", "/speakers", id="speakers"),
]


def next_generation(manager: ConnectionManager) -> int:
    manager.phase.report(Fact.GETINFO_ANSWERED, manager.clock.monotonic())
    manager.phase.report(Fact.SOCKET_LOST, manager.clock.monotonic())
    manager.phase.report(Fact.GETINFO_ANSWERED, manager.clock.monotonic())
    return manager.phase.standing.generation


class PausedResponse(httpx.AsyncBaseTransport):
    def __init__(self, path: str, after_post: str | None = None, response_number: int = 1) -> None:
        self.path = path
        self.response_number = response_number
        self.responses = 0
        self.after_post = after_post
        self.posted = after_post is None
        self.inner = httpx.AsyncHTTPTransport()
        self.arrived = asyncio.Event()
        self.release = asyncio.Event()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self.inner.handle_async_request(request)
        if request.method == "POST" and request.url.path == self.after_post:
            self.posted = True
        if request.method == "GET" and request.url.path == self.path and self.posted:
            self.responses += 1
            if self.responses == self.response_number:
                self.arrived.set()
                await self.release.wait()
        return response

    async def aclose(self) -> None:
        await self.inner.aclose()


# Break: stamp a payload with the lifecycle generation at completion rather than acquisition.
@pytest.mark.parametrize(("payload", "read"), READERS)
async def test_file_read_keeps_the_generation_from_before_its_response_arrives(
    http_manager: ConnectionManager, http_daemon: dict[str, Any], payload: str, read: Reader
) -> None:
    paused = PausedResponse(SOURCE_PATHS[payload])
    client = HttpConfigClient("127.0.0.1", http_daemon["_port"], "u", "p", HttpOptions(transport=paused))
    http_manager.http_client = client
    acquired = next_generation(http_manager)
    pending = asyncio.create_task(read(http_manager))
    try:
        await paused.arrived.wait()
        next_generation(http_manager)
        paused.release.set()
        await pending
        assert http_manager.readings.source_stamp(Source.FILE, payload) == Stamp(Source.FILE, acquired)
    finally:
        paused.release.set()
        await pending
        await client.aclose()


# Break: suppress the acquisition update when a successful reread has equal contents.
@pytest.mark.parametrize(("payload", "read"), READERS)
async def test_an_unchanged_successful_file_reread_replaces_the_acquisition_generation(
    http_manager: ConnectionManager, payload: str, read: Reader
) -> None:
    earlier = next_generation(http_manager)
    await read(http_manager)
    first = http_manager.readings.source_stamp(Source.FILE, payload)
    later = next_generation(http_manager)
    await read(http_manager)
    second = http_manager.readings.source_stamp(Source.FILE, payload)
    assert (first, second) == (Stamp(Source.FILE, earlier), Stamp(Source.FILE, later))


# Break: renew the retained form's acquisition when an error response supplies no replacement.
@pytest.mark.parametrize(("payload", "path"), FORM_PATHS)
async def test_a_failed_form_reread_preserves_its_last_successful_acquisition(
    http_manager: ConnectionManager, http_daemon: dict[str, Any], payload: str, path: str
) -> None:
    acquired = next_generation(http_manager)
    await forms.refresh(http_manager)
    next_generation(http_manager)
    http_daemon["_fail_paths"] = [path]
    await forms.refresh(http_manager)
    assert http_manager.readings.source_stamp(Source.FILE, payload) == Stamp(Source.FILE, acquired)


# Break: stamp retained archive values when a forms read only updates credential evidence.
@pytest.mark.parametrize(("payload", "read"), READERS[:2])
@pytest.mark.parametrize("refused", [False, True])
async def test_credential_evidence_does_not_renew_a_retained_archive_acquisition(
    http_manager: ConnectionManager, http_daemon: dict[str, Any], payload: str, read: Reader, *, refused: bool
) -> None:
    acquired = next_generation(http_manager)
    await read(http_manager)
    next_generation(http_manager)
    http_daemon["_refuse_auth"] = refused
    await forms.refresh(http_manager)
    assert http_manager.readings.source_stamp(Source.FILE, payload) == Stamp(Source.FILE, acquired)


async def staged_apply(manager: ConnectionManager) -> object:
    return await manager.applyops.apply({}, {"title": "Acquisition fixture"})


async def engine_apply(manager: ConnectionManager) -> object:
    return await manager.applyops.apply_engine({"cuda": "0"})


async def speaker_apply(manager: ConnectionManager) -> object:
    return await speakerprocessing.apply(manager, {"0": {"level": "-7"}}, enabled=True)


async def connect(manager: ConnectionManager) -> None:
    await loader.connect(manager, loader.Cadence())


async def stamp_across_response(
    manager: ConnectionManager,
    daemon: dict[str, Any],
    read: Reader,
    payload: str,
    after_post: str | None = None,
    *,
    response_number: int = 1,
) -> tuple[Stamp | None, Stamp]:
    paused = PausedResponse(SOURCE_PATHS[payload], after_post, response_number)
    client = HttpConfigClient("127.0.0.1", daemon["_port"], "u", "p", HttpOptions(transport=paused))
    manager.http_client = client
    next_generation(manager)
    pending = asyncio.create_task(read(manager))
    arrived = asyncio.create_task(paused.arrived.wait())
    try:
        await asyncio.wait((pending, arrived), return_when=asyncio.FIRST_COMPLETED)
        if not paused.arrived.is_set():
            await pending
            raise FixtureError(reason="the operation completed before the acquisition arrived")
        acquired = manager.phase.standing.generation
        next_generation(manager)
        paused.release.set()
        await pending
        return manager.readings.source_stamp(Source.FILE, payload), Stamp(Source.FILE, acquired)
    finally:
        paused.release.set()
        arrived.cancel()
        await asyncio.gather(pending, arrived, return_exceptions=True)
        await client.aclose()


# Break: a synchronous readback recorder assigns the generation after the asynchronous response.
@pytest.mark.parametrize(
    ("payload", "write", "posted", "response_number"),
    [
        pytest.param("file_config", staged_apply, "/restore", 1, id="preset-restore"),
        pytest.param("engine", engine_apply, "/restore", 1, id="engine-apply"),
        pytest.param("speakers_form", speaker_apply, "/speakers", 2, id="speaker-apply"),
    ],
)
async def test_apply_readback_keeps_the_generation_from_its_originating_acquisition(
    http_manager: ConnectionManager,
    http_daemon: dict[str, Any],
    payload: str,
    write: Reader,
    posted: str,
    *,
    response_number: int,
) -> None:
    recorded, acquired = await stamp_across_response(
        http_manager, http_daemon, write, payload, posted, response_number=response_number
    )
    assert recorded == acquired


# Break: loader passes archive bytes to a recorder without retaining their acquisition generation.
async def test_connection_archive_keeps_the_generation_from_before_its_response_arrives(
    http_manager: ConnectionManager, http_daemon: dict[str, Any], daemon: DaemonFactory
) -> None:
    port, _commands, _state = await daemon()
    http_manager.cfg.hqp_host = "127.0.0.1"
    http_manager.cfg.hqp_control_port = port
    try:
        recorded, acquired = await stamp_across_response(http_manager, http_daemon, connect, "file_config")
        assert recorded == acquired
    finally:
        await http_manager.aclose()
