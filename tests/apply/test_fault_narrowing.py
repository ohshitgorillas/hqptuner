"""Which faults the connect/poll path is allowed to swallow (docs/testing.md).

An expected wire or state fault — the daemon down, a route refusing, a stored
preset the store will not read — keeps the quiet-retry behaviour. Everything
else has to stay loud rather than be reported to the user as "daemon
unreachable". Every fault here is injected at the wire (a 503 on a named 8088
route, a 4321 listener taken down) or through constructor inputs (a preset
directory another HQPTuner version stamped), never by patching the manager.
"""

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable, Coroutine
from pathlib import Path
from typing import Any

import pytest
from conftest import ManagerFactory, eventually
from fake_control import serve as fake_serve
from narrow import present

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes import httpforms

StartManager = Callable[..., Coroutine[Any, Any, ConnectionManager]]
KillableDaemon = tuple[int, Callable[[], Awaitable[None]]]


async def _settled(manager: ConnectionManager) -> None:
    """A full connect plus one completed poll — ``reachable`` alone flips before
    the best-effort 8088 loads run, so it cannot prove the connect returned."""
    await eventually(lambda: manager.reachable and manager.loaded_at is not None, timeout=5.0)
    first = manager.loaded_at
    await eventually(lambda: manager.reachable and manager.loaded_at != first, timeout=5.0)


@pytest.fixture
async def start_manager(live_daemon_port: int, tmp_path: Path) -> AsyncIterator[StartManager]:
    """A manager running both lanes: the 4321 fake plus an 8088 lane at
    ``http_port``, settled before it is handed back and torn down at exit."""
    started: list[tuple[ConnectionManager, asyncio.Task[None], HttpConfigClient]] = []

    async def start(http_port: int, **overrides: Any) -> ConnectionManager:
        http = HttpConfigClient("127.0.0.1", http_port, "u", "p")
        defaults: dict[str, Any] = {
            "hqp_host": "127.0.0.1",
            "hqp_control_port": live_daemon_port,
            "poll_interval": 0.02,
            "backup_dir": tmp_path / "backups",
            "preset_dir": tmp_path / "presets",
        }
        manager = ConnectionManager(Config(**{**defaults, **overrides}), http)
        task = asyncio.create_task(manager.run())
        started.append((manager, task, http))
        await _settled(manager)
        return manager

    yield start
    for manager, task, http in started:
        manager.stop()
        await task
        await manager.aclose()
        await http.aclose()


@pytest.fixture
async def killable_daemon() -> AsyncIterator[KillableDaemon]:
    """The 4321 fake behind a listener a test can take down mid-poll."""
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
    if server.is_serving():
        await kill()


# --- the polled forms: one refusing route must not cost the others ------------
# The 8088 web UI is three pages read in one pass. A 503 on one of them (readme
# §1.9's /speakers is a whole subsystem that can be absent) is an expected wire
# fault: it belongs to that form and stops there.


async def test_a_refusing_form_route_records_that_forms_error(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    http_daemon["_fail_paths"] = ["/matrix"]
    await httpforms.refresh(http_manager)
    assert http_manager.matrix_error is not None


async def test_a_refusing_form_route_still_refreshes_the_config_form(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    http_daemon["_fail_paths"] = ["/matrix"]
    await httpforms.refresh(http_manager)
    assert present(http_manager.config_form)["fields"] != []


async def test_a_refusing_form_route_still_refreshes_the_speakers_form(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    http_daemon["_fail_paths"] = ["/matrix"]
    await httpforms.refresh(http_manager)
    assert present(http_manager.speakers_form)["channels"] != []


async def test_a_refusing_form_route_leaves_the_last_good_snapshot_in_place(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    # a good pass first, then the route refuses while the daemon's own state
    # moves: the stale-but-real snapshot must survive, not be cleared
    await httpforms.refresh(http_manager)
    http_daemon["matrix_active"] = "Mch-to-Stereo mixdown"
    http_daemon["_fail_paths"] = ["/matrix"]
    await httpforms.refresh(http_manager)
    assert present(http_manager.matrix_form)["active"] == "[Default]"


# --- the supervisor loop ------------------------------------------------------


async def test_a_dead_control_lane_marks_the_daemon_unreachable(killable_daemon: KillableDaemon) -> None:
    port, kill = killable_daemon
    manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_control_port=port, poll_interval=0.02))
    task = asyncio.create_task(manager.run())
    await eventually(lambda: manager.reachable)
    await kill()
    await eventually(lambda: manager.unreachable_since is not None)
    manager.stop()
    await task
    await manager.aclose()
    assert manager.reachable is False


# --- connect-time faults on the best-effort lanes -----------------------------


async def test_a_refusing_backup_route_leaves_the_manager_reachable(
    start_manager: StartManager, http_daemon: dict[str, Any]
) -> None:
    # the 8088 file-config read fails; the 4321 connect it rode alongside stands
    http_daemon["_fail_paths"] = ["/backup/settings.zip"]
    manager = await start_manager(http_daemon["_port"])
    assert manager.reachable is True


async def test_a_refusing_backup_route_leaves_file_config_unset(
    start_manager: StartManager, http_daemon: dict[str, Any]
) -> None:
    http_daemon["_fail_paths"] = ["/backup/settings.zip"]
    manager = await start_manager(http_daemon["_port"])
    assert manager.file_config is None


async def test_a_store_stamped_by_a_newer_hqptuner_leaves_the_manager_reachable(
    start_manager: StartManager, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # connect imports the daemon's preset snapshots; this store refuses every
    # read, which is an expected preset-store fault, not a broken connection
    presets = tmp_path / "newer-presets"
    presets.mkdir()
    (presets / "store.json").write_text(json.dumps({"schema": 99}))
    manager = await start_manager(http_daemon["_port"], preset_dir=presets)
    assert manager.reachable is True


# --- an unexpected fault must not be reported as an unreachable daemon --------
#
# Behaviours 3, 5 and 6 of the spec are NOT covered here. They need a fault that
# is neither an HTTP/transport error nor the control protocol's own error type —
# the kind our own parsing bug would raise — and no body either fake can serve
# produces one: `parse_config_form`, `parse_matrix_form` and `parse_speakers_form`
# all return normally on an empty body, on a non-form page, and on non-numeric
# values and constraints in a `type="number"` input; the control lane likewise
# polls clean against a State carrying a non-numeric volume, mode or filter
# index, and against a non-numeric `RatesItem`. Manufacturing the fault by
# patching the parser or the manager would be testing our own mock (rule 3/4),
# so the gap is recorded rather than faked.


@pytest.mark.parametrize("form", ["config", "matrix", "speakers"])
async def test_a_healthy_pass_records_no_error_for_any_form(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any], form: str
) -> None:
    manager = http_manager_factory(http_daemon)
    await httpforms.refresh(manager)
    assert getattr(manager, f"{form}_error") is None
