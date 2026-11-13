"""Accepted writes retire in-flight File reads while retaining acquired values."""

import asyncio
import contextlib
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any

import httpx
import pytest

from hqptuner.conf.httpconf import HttpConfigClient, HttpOptions
from hqptuner.core.lifecycle import Fact
from hqptuner.core.manager import ConnectionManager
from hqptuner.core.readings import Source, Stamp
from hqptuner.lanes import settle
from hqptuner.lanes.http import forms, speakerprocessing
from hqptuner.presets import fileconfig

Reader = Callable[[ConnectionManager], Coroutine[Any, Any, object]]
READERS = [
    pytest.param("file_config", "/backup/settings.zip", fileconfig.load_file_config, id="archive"),
    pytest.param("engine", "/backup/settings.zip", fileconfig.read_engine, id="engine"),
    pytest.param("config_form", "/config", forms.refresh, id="config"),
    pytest.param("matrix_form", "/matrix", forms.refresh, id="matrix"),
    pytest.param("speakers_form", "/speakers", forms.refresh, id="speakers"),
]


RETAINED = "Retained fixture"
STALE = "Stale fixture"
FRESH = "Fresh fixture"


@dataclass(frozen=True)
class Lifetime:
    stamps: tuple[Stamp | None, Stamp | None, Stamp | None]
    values: tuple[object, object, object]


def wire_values(daemon: dict[str, Any], title: str, number: int) -> None:
    daemon["title"] = title
    daemon["cuda_dev"] = str(number)
    daemon["matrix_active"] = title
    daemon["_speakers"][0]["level"] = str(-number)


def source_value(manager: ConnectionManager, payload: str) -> object:
    readings = manager.readings
    if payload == "file_config":
        return None if readings.file_config is None else readings.file_config["title"]
    if payload == "engine":
        return None if readings.engine is None else readings.engine["cuda_dev"]
    if payload == "config_form":
        form = readings.config_form
        return None if form is None else next(row["value"] for row in form["fields"] if row["name"] == "title")
    if payload == "matrix_form":
        return None if readings.matrix_form is None else readings.matrix_form["active"]
    return None if readings.speakers_form is None else readings.speakers_form["channels"][0]["level"]


class PausedRead(httpx.AsyncBaseTransport):
    def __init__(self, path: str, after_post: str | None = None, response_number: int = 1) -> None:
        self.path = path
        self.after_post = after_post
        self.posted = after_post is None
        self.response_number = response_number
        self.responses = 0
        self.inner = httpx.AsyncHTTPTransport()
        self.arrived = asyncio.Event()
        self.release = asyncio.Event()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self.inner.handle_async_request(request)
        if request.method == "POST" and request.url.path == self.after_post:
            self.posted = True
        if request.method == "GET" and request.url.path == self.path and self.posted:
            self.responses += 1
        if request.method == "GET" and request.url.path == self.path and self.responses == self.response_number:
            await response.aread()
            self.arrived.set()
            await self.release.wait()
        return response

    async def aclose(self) -> None:
        await self.inner.aclose()


async def lifetime_stamps(
    manager: ConnectionManager,
    daemon: dict[str, Any],
    payload: str,
    path: str,
    read: Reader,
    *,
    event: str,
) -> Lifetime:
    wire_values(daemon, RETAINED, 2)
    await read(manager)
    original = manager.require_http()
    archive = await original.backup()
    manager.phase.report(Fact.GETINFO_ANSWERED, manager.clock.monotonic())
    manager.phase.report(Fact.SOCKET_LOST, manager.clock.monotonic())
    manager.phase.report(Fact.GETINFO_ANSWERED, manager.clock.monotonic())
    paused = PausedRead(path)
    client = HttpConfigClient("127.0.0.1", daemon["_port"], "u", "p", HttpOptions(transport=paused))
    manager.http_client = client
    wire_values(daemon, STALE, 3)
    pending = asyncio.create_task(read(manager))
    try:
        await paused.arrived.wait()
        if event == "retarget":
            manager.http_client = original
            await manager.retarget()
        elif event == "speaker":
            await speakerprocessing.apply(manager, {"0": {"level": "-7"}}, enabled=True)
        else:
            daemon["_refuse_auth"] = event == "refused"

            async def request() -> None:
                await client.restore(archive)

            with contextlib.suppress(httpx.HTTPError):
                await settle.restart(manager, request)
            daemon["_refuse_auth"] = False
        retained = manager.readings.source_stamp(Source.FILE, payload)
        retained_value = source_value(manager, payload)
        paused.release.set()
        await pending
        completed = manager.readings.source_stamp(Source.FILE, payload)
        completed_value = source_value(manager, payload)
        wire_values(daemon, FRESH, 5)
        await read(manager)
        fresh = manager.readings.source_stamp(Source.FILE, payload)
        return Lifetime((retained, completed, fresh), (retained_value, completed_value, source_value(manager, payload)))
    finally:
        paused.release.set()
        await pending
        manager.http_client = original
        await client.aclose()


# Break: let an acquisition from before an accepted write replace the retained File view.
@pytest.mark.parametrize(("payload", "path", "read"), READERS)
async def test_accepted_write_keeps_last_acquisition_until_a_post_write_read_arrives(
    http_manager: ConnectionManager,
    http_daemon: dict[str, Any],
    payload: str,
    path: str,
    read: Reader,
) -> None:
    acquired = http_manager.phase.standing.generation
    observed = await lifetime_stamps(http_manager, http_daemon, payload, path, read, event="accepted")
    fresh = http_manager.phase.standing.generation
    assert observed.stamps == (Stamp(Source.FILE, acquired), Stamp(Source.FILE, acquired), Stamp(Source.FILE, fresh))


# Break: invalidate acquisitions on attempted writes even when the daemon rejects the write.
@pytest.mark.parametrize(("payload", "path", "read"), READERS)
async def test_refused_write_allows_the_in_flight_file_acquisition_to_land(
    http_manager: ConnectionManager,
    http_daemon: dict[str, Any],
    payload: str,
    path: str,
    read: Reader,
) -> None:
    acquired = http_manager.phase.standing.generation
    observed = await lifetime_stamps(http_manager, http_daemon, payload, path, read, event="refused")
    fresh = http_manager.phase.standing.generation
    assert observed.stamps == (Stamp(Source.FILE, acquired), Stamp(Source.FILE, fresh), Stamp(Source.FILE, fresh))


# Break: allow the old HTTP target's completion to replace a retained File acquisition.
@pytest.mark.parametrize(("payload", "path", "read"), READERS)
async def test_retarget_rejects_the_old_clients_file_completion_until_a_new_read_lands(
    http_manager: ConnectionManager,
    http_daemon: dict[str, Any],
    payload: str,
    path: str,
    read: Reader,
) -> None:
    acquired = http_manager.phase.standing.generation
    observed = await lifetime_stamps(http_manager, http_daemon, payload, path, read, event="retarget")
    fresh = http_manager.phase.standing.generation
    assert observed.stamps == (Stamp(Source.FILE, acquired), Stamp(Source.FILE, acquired), Stamp(Source.FILE, fresh))


EXPECTED_VALUES = {
    "file_config": (RETAINED, RETAINED, FRESH),
    "engine": ("2", "2", "5"),
    "config_form": (RETAINED, RETAINED, FRESH),
    "matrix_form": (RETAINED, RETAINED, FRESH),
    "speakers_form": (-2.0, -2.0, -5.0),
}


# Break: clear retained values or install a stale payload while preserving its old stamp.
@pytest.mark.parametrize(("payload", "path", "read"), READERS)
@pytest.mark.parametrize("event", ["accepted", "retarget"])
async def test_file_values_survive_invalidation_and_ignore_stale_payloads_until_fresh_read(
    http_manager: ConnectionManager,
    http_daemon: dict[str, Any],
    payload: str,
    path: str,
    read: Reader,
    *,
    event: str,
) -> None:
    observed = await lifetime_stamps(http_manager, http_daemon, payload, path, read, event=event)
    assert observed.values == EXPECTED_VALUES[payload]


# Break: retire unrelated source acquisitions when only speaker processing was written.
@pytest.mark.parametrize(("payload", "path", "read"), READERS[1:4])
async def test_speaker_write_preserves_unrelated_in_flight_acquisitions(
    http_manager: ConnectionManager,
    http_daemon: dict[str, Any],
    payload: str,
    path: str,
    read: Reader,
) -> None:
    acquired = http_manager.phase.standing.generation
    observed = await lifetime_stamps(http_manager, http_daemon, payload, path, read, event="speaker")
    fresh = http_manager.phase.standing.generation
    assert observed.stamps == (Stamp(Source.FILE, acquired), Stamp(Source.FILE, fresh), Stamp(Source.FILE, fresh))


# Break: let an older speakers response overwrite a speaker write's confirmed readback.
async def test_speaker_write_readback_survives_an_older_speakers_response(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    observed = await lifetime_stamps(
        http_manager, http_daemon, "speakers_form", "/speakers", forms.refresh, event="speaker"
    )
    assert observed.values == (-7.0, -7.0, -5.0)


async def restore_title(manager: ConnectionManager) -> object:
    return await manager.applyops.apply({}, {"title": STALE})


async def restore_engine(manager: ConnectionManager) -> object:
    return await manager.applyops.apply_engine({"cuda_dev": "3"})


async def verification_race(
    manager: ConnectionManager,
    daemon: dict[str, Any],
    payload: str,
    read: Reader,
    write: Reader,
    *,
    event: str,
) -> object:
    original = manager.require_http()
    wire_values(daemon, RETAINED, 2)
    await read(manager)
    wire_values(daemon, FRESH, 5)
    replacement_archive = await original.backup()
    wire_values(daemon, RETAINED, 2)
    if event == "later_probe":
        earlier_archive = await original.backup()
        daemon["_restart_state"] = {"_backups": [earlier_archive, earlier_archive]}
    daemon["_adopts"] = {"cuda_dev": ("engine", "cuda_dev")}
    paused = PausedRead("/backup/settings.zip", "/restore", 2 if event == "later_probe" else 1)
    client = HttpConfigClient("127.0.0.1", daemon["_port"], "u", "p", HttpOptions(transport=paused))
    manager.http_client = client
    pending = asyncio.create_task(write(manager))
    try:
        await paused.arrived.wait()
        if event == "retarget":
            manager.http_client = original
            await manager.retarget()
            await original.restore(replacement_archive)
        else:

            async def request() -> None:
                await original.restore(replacement_archive)

            await settle.restart(manager, request)
        daemon["_backups"] = []
        await read(manager)
        daemon["_down"] = event == "later_probe"
        paused.release.set()
        await pending
        return source_value(manager, payload)
    finally:
        paused.release.set()
        await pending
        daemon["_down"] = False
        manager.http_client = original
        await client.aclose()


# Break: record verification payloads after their write or target ownership has expired.
@pytest.mark.parametrize("event", ["accepted", "retarget"])
@pytest.mark.parametrize(
    ("payload", "read", "write", "expected"),
    [
        ("file_config", fileconfig.load_file_config, restore_title, FRESH),
        ("engine", fileconfig.read_engine, restore_engine, "5"),
    ],
)
async def test_superseded_write_verification_cannot_overwrite_newer_file_values(
    http_manager: ConnectionManager,
    http_daemon: dict[str, Any],
    payload: str,
    read: Reader,
    write: Reader,
    *,
    expected: str,
    event: str,
) -> None:
    observed = await verification_race(http_manager, http_daemon, payload, read, write, event=event)
    assert observed == expected


# Break: record an earlier successful engine probe after its ownership expires during later verification.
async def test_an_earlier_engine_probe_cannot_be_recorded_after_invalidation_during_a_later_probe(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    observed = await verification_race(
        http_manager, http_daemon, "engine", fileconfig.read_engine, restore_engine, event="later_probe"
    )
    assert observed == "5"
