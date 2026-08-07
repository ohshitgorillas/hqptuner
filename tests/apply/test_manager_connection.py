"""Connection-manager reachability bookkeeping through the public ``run()`` loop
(docs/testing.md): a poll failure drops the connection and timestamps the outage,
the alarm trips only past the threshold (in virtual time), a mode change
re-enumerates on the next poll, and the live volume lane answers from readback.

The 4321 fake is conftest's wire-protocol handler behind a killable server, so an
outage is injected at the wire — connections severed, listener closed — never by
patching the manager. ``run()`` itself stays on the real clock by design, paced
here with a small ``poll_interval``."""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable

import pytest
from fake_control import serve as fake_serve
from narrow import present

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.control import ControlError

KillableDaemon = tuple[int, Callable[[], Awaitable[None]]]
OutageManager = tuple[ConnectionManager, Callable[[], Awaitable[None]]]


async def _eventually(condition: Callable[[], bool], timeout: float = 3.0) -> None:
    """Wait (real clock, tiny polls — the run() loop is deliberately real-paced)
    until the condition holds; a TimeoutError means the behavior never happened."""

    async def wait() -> None:
        while not condition():
            await asyncio.sleep(0.01)

    await asyncio.wait_for(wait(), timeout)


@pytest.fixture
async def killable_daemon() -> AsyncIterator[KillableDaemon]:
    """The shared 4321 fake behind a server a test can take down mid-poll."""
    writers: list[asyncio.StreamWriter] = []

    async def serve(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        writers.append(writer)
        await fake_serve(reader, writer)

    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]

    async def kill() -> None:
        server.close()
        for writer in writers:
            writer.close()
        await server.wait_closed()

    yield port, kill
    # always through kill(): the writers list pins the server-side transports,
    # so wait_closed() only returns once they are explicitly closed
    if server.is_serving():
        await kill()


@pytest.fixture
async def outage_manager(killable_daemon: KillableDaemon) -> AsyncIterator[OutageManager]:
    port, kill = killable_daemon
    manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_control_port=port, poll_interval=0.02))
    task = asyncio.create_task(manager.run())
    await _eventually(lambda: manager.reachable)
    yield manager, kill
    manager.stop()
    await task
    await manager.aclose()


# --- reachability drops when the wire dies ----------------------------------


async def test_a_poll_failure_marks_the_daemon_unreachable(outage_manager: OutageManager) -> None:
    manager, kill = outage_manager
    await kill()
    await _eventually(lambda: not manager.reachable)
    assert manager.reachable is False


async def test_a_poll_failure_closes_the_control_client(outage_manager: OutageManager) -> None:
    manager, kill = outage_manager
    await kill()
    await _eventually(lambda: manager.control is None)
    assert manager.control is None


async def test_a_poll_failure_records_when_the_outage_began(outage_manager: OutageManager) -> None:
    manager, kill = outage_manager
    await kill()
    await _eventually(lambda: not manager.reachable)
    assert manager.unreachable_since is not None


async def test_a_connected_manager_reports_no_outage(outage_manager: OutageManager) -> None:
    manager, _ = outage_manager
    assert manager.unreachable_since is None


# --- the alarm: unreachable beyond the threshold ------------------------------


async def test_alarm_stays_quiet_inside_the_threshold() -> None:
    manager = ConnectionManager(Config(alarm_threshold=60.0))
    assert manager.alarm is False


async def test_alarm_trips_once_unreachable_past_the_threshold() -> None:
    # never-connected manager; the wait is paid in virtual time (conftest clock)
    manager = ConnectionManager(Config(alarm_threshold=1.0))
    await manager.sleep(2.0)
    assert manager.alarm is True


async def test_alarm_never_trips_while_connected(outage_manager: OutageManager) -> None:
    manager, _ = outage_manager
    await manager.sleep(100.0)
    assert manager.alarm is False


# --- poll-time re-enumeration on a mode change --------------------------------


async def test_a_mode_change_is_reenumerated_on_the_next_poll(outage_manager: OutageManager) -> None:
    # an external actor flips the engine to SDM; the poll must swap the lists
    # wholesale — enum 38 is the SDM chain's poly-sinc-gauss-long, not PCM's 40
    manager, _ = outage_manager
    await present(manager.control).set_command("SetMode", value="2")
    await _eventually(lambda: (manager.enums or {}).get("filters", [{}])[0].get("value") == "38")
    assert present(manager.enums)["filters"][0]["value"] == "38"


# --- live volume lane ---------------------------------------------------------


async def test_set_volume_echoes_the_readback_level(outage_manager: OutageManager) -> None:
    manager, _ = outage_manager
    assert (await manager.applyops.set_volume("-20.0"))["volume"] == "-20.0"


async def test_set_volume_without_a_connection_raises() -> None:
    manager = ConnectionManager(Config())
    with pytest.raises(ControlError, match="not connected"):
        await manager.applyops.set_volume("-20.0")


# --- mode-name join -----------------------------------------------------------


async def test_current_mode_name_joins_state_to_the_modes_enum(outage_manager: OutageManager) -> None:
    manager, _ = outage_manager
    assert manager.current_mode_name() == "PCM"


def test_current_mode_name_is_empty_before_any_connection() -> None:
    assert ConnectionManager(Config()).current_mode_name() == ""
