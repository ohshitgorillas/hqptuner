"""Connection evidence belongs to the target that supplied it."""

import asyncio
from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
import pytest
from apps import closed_port as reserved_closed_port
from conftest import DaemonFactory
from virtual_clock import VirtualClock

from hqptuner.clock import Clock
from hqptuner.conf.httpconf import HttpConfigClient, HttpOptions
from hqptuner.config import Config
from hqptuner.core import loader
from hqptuner.core.lifecycle import Phase
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.http import forms

HOST = "127.0.0.1"
HANDSHAKE = "GetInfo"


@asynccontextmanager
async def manager_at(
    port: int, tmp_path: Path, http: HttpConfigClient | None = None, clock: Clock | None = None
) -> AsyncIterator[ConnectionManager]:
    unavailable_port = reserved_closed_port()
    cfg = Config(
        hqp_host=HOST,
        hqp_control_port=port,
        hqp_http_port=unavailable_port,
        hqp_metering_port=unavailable_port,
        backup_dir=tmp_path / "backups",
        preset_dir=tmp_path / "presets",
    )
    manager = ConnectionManager(cfg, http, clock=clock or VirtualClock())
    try:
        yield manager
    finally:
        await manager.aclose()


# Break: initialize address evidence as found, or wait for GetInfo to record TCP success.
@pytest.mark.parametrize("failure_mode", ["_error", "_close", "_not_xml"])
async def test_tcp_success_changes_unknown_address_to_found_despite_failed_handshake(
    daemon: DaemonFactory, tmp_path: Path, failure_mode: str
) -> None:
    port, _commands, _state = await daemon(**{failure_mode: HANDSHAKE})
    async with manager_at(port, tmp_path) as manager:
        initial = manager.readings.address_found
        await loader.connect(manager, loader.Cadence())
        assert (initial, manager.readings.address_found) == (None, True)


# Break: infer address evidence from a successful application handshake rather than the dial.
async def test_a_refused_control_port_still_records_a_found_host(closed_port: int, tmp_path: Path) -> None:
    async with manager_at(closed_port, tmp_path) as manager:
        await loader.connect(manager, loader.Cadence())
        assert manager.readings.address_found is True


# Break: publish the address only after GetInfo has moved the lifecycle to Reachable.
async def test_readings_subscribers_hear_found_address_before_handshake(daemon: DaemonFactory, tmp_path: Path) -> None:
    port, _commands, _state = await daemon()
    async with manager_at(port, tmp_path) as manager:
        heard: list[tuple[bool | None, Phase]] = []
        manager.readings.on_change = lambda: heard.append(
            (manager.readings.address_found, manager.phase.standing.phase)
        )
        await loader.connect(manager, loader.Cadence())
        assert (True, Phase.DOWN) in heard


# Break: retain the old target's address verdict when retarget closes its connection.
async def test_retarget_discards_address_evidence_until_the_new_target_is_dialed(
    daemon: DaemonFactory, closed_port: int, tmp_path: Path
) -> None:
    port, _commands, _state = await daemon()
    async with manager_at(port, tmp_path) as manager:
        await loader.connect(manager, loader.Cadence())
        old_target = manager.readings.address_found
        manager.cfg.hqp_control_port = closed_port
        await manager.retarget()
        new_target = manager.readings.address_found
        await loader.connect(manager, loader.Cadence())
        assert (old_target, new_target, manager.readings.address_found) == (True, None, True)


# Break: clear address evidence silently so subscribers retain the old target's verdict.
async def test_readings_subscribers_hear_address_evidence_reset_on_retarget(
    daemon: DaemonFactory, closed_port: int, tmp_path: Path
) -> None:
    port, _commands, _state = await daemon()
    async with manager_at(port, tmp_path) as manager:
        await loader.connect(manager, loader.Cadence())
        heard = [manager.readings.address_found]
        manager.readings.on_change = lambda: heard.append(manager.readings.address_found)
        manager.cfg.hqp_control_port = closed_port
        await manager.retarget()
        assert (heard[0], heard[-1]) == (True, None)


# Break: carry accepted or rejected credentials from an old connection configuration into its replacement.
@pytest.mark.parametrize("verdict", [True, False])
@pytest.mark.parametrize("changed", ["host", "password"])
async def test_retarget_discards_credentials_evidence_for_changed_connection_configuration(
    daemon: DaemonFactory, tmp_path: Path, changed: str, *, verdict: bool
) -> None:
    port, _commands, _state = await daemon()
    async with manager_at(port, tmp_path) as manager:
        manager.readings.take_file(credentials_ok=verdict)
        before = manager.readings.credentials_ok
        if changed == "host":
            manager.cfg.hqp_host = "127.0.0.2"
        else:
            manager.cfg.hqp_password = str(tmp_path)
        await manager.retarget()
        assert (before, manager.readings.credentials_ok) == (verdict, None)


class PausedDial:
    def __init__(self) -> None:
        self.arrived = asyncio.Event()
        self.release = asyncio.Event()
        self.virtual = VirtualClock()
        self.clock = Clock(
            monotonic=self.virtual.monotonic,
            sleep=self.virtual.sleep,
            wait=self.virtual.wait,
            pace=self.virtual.pace,
            spawn=self.virtual.spawn,
            now=self.virtual.now,
            wait_for=self.wait_for,
        )

    async def wait_for[T](self, operation: Awaitable[T], seconds: float, /) -> T:
        result: T = await self.virtual.wait_for(operation, seconds)
        if not self.arrived.is_set():
            self.arrived.set()
            await self.release.wait()
        return result


@asynccontextmanager
async def retarget_during_dial(port: int, replacement: int, tmp_path: Path) -> AsyncIterator[ConnectionManager]:
    paused = PausedDial()
    async with manager_at(port, tmp_path, clock=paused.clock) as manager:
        attempt = asyncio.create_task(loader.connect(manager, loader.Cadence()))
        try:
            await paused.arrived.wait()
            manager.cfg.hqp_control_port = replacement
            await manager.retarget()
            paused.release.set()
            await attempt
            yield manager
        finally:
            paused.release.set()
            await attempt


# Break: publish an old dial's successful result after retarget has invalidated its target.
async def test_an_old_dial_completion_cannot_restore_the_retargeted_address_verdict(
    daemon: DaemonFactory, closed_port: int, tmp_path: Path
) -> None:
    port, _commands, _state = await daemon()
    async with retarget_during_dial(port, closed_port, tmp_path) as manager:
        stale = manager.readings.address_found
        await manager.retarget()
        await loader.connect(manager, loader.Cadence())
        assert (stale, manager.readings.address_found) == (None, True)


# Break: adopt the old dial as the manager's standing connection after its target changed.
async def test_an_old_dial_completion_cannot_supply_the_new_targets_standing_connection(
    daemon: DaemonFactory, closed_port: int, tmp_path: Path
) -> None:
    port, _commands, _state = await daemon()
    async with manager_at(port, tmp_path) as connected:
        await loader.connect(connected, loader.Cadence())
        async with retarget_during_dial(port, closed_port, tmp_path) as retargeted:
            assert (connected.phase.standing.phase, retargeted.phase.standing.phase) == (Phase.REACHABLE, Phase.DOWN)


class PausedHttp(httpx.AsyncBaseTransport):
    def __init__(self) -> None:
        self.inner = httpx.AsyncHTTPTransport()
        self.arrived = asyncio.Event()
        self.release = asyncio.Event()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self.inner.handle_async_request(request)
        self.arrived.set()
        await self.release.wait()
        return response

    async def aclose(self) -> None:
        await self.inner.aclose()


# Break: let a refresh publish credentials learned by a client replaced while its responses were in flight.
@pytest.mark.parametrize("refused", [True, False])
async def test_a_replaced_http_clients_late_reply_cannot_supply_the_new_credentials_verdict(
    http_daemon: dict[str, Any], closed_port: int, tmp_path: Path, *, refused: bool
) -> None:
    http_daemon["_refuse_auth"] = refused
    paused = PausedHttp()
    old = HttpConfigClient(HOST, http_daemon["_port"], "u", "p", HttpOptions(transport=paused))
    replacement = HttpConfigClient(HOST, http_daemon["_port"], "u", "replacement")
    try:
        async with manager_at(closed_port, tmp_path, old) as manager:
            refresh = asyncio.create_task(forms.refresh(manager))
            try:
                await paused.arrived.wait()
                manager.http_client = replacement
                await manager.retarget()
                paused.release.set()
                await refresh
                stale = manager.readings.credentials_ok
                http_daemon["_refuse_auth"] = False
                await forms.refresh(manager)
                assert (stale, manager.readings.credentials_ok) == (None, True)
            finally:
                paused.release.set()
                await refresh
    finally:
        await old.aclose()
        await replacement.aclose()
