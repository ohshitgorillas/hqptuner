"""Live snapshots driven from core, with no HTTP request anywhere.

The presets layer owns a live snapshot's whole life: it validates a save,
records it into the manager's live-snapshot store and applies it back to the
engine, all from the manager alone. The store it reaches is the one the
manager's preset collaborator holds, ``presetops.live_presets``.

Each case runs a real manager against the in-loop control fake; the store is a
real file under ``tmp_path``. The fake's ``matrix_profile`` State key is the
engine's loaded matrix profile, and ``MatrixListProfiles`` answers the two
names the fake lists by default.
"""

from collections.abc import AsyncIterator, Awaitable, Callable, Coroutine
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
from apps import settled
from conftest import DaemonFactory
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.errors import HQPTunerError
from hqptuner.presets import livesnapshots
from hqptuner.presets.store.live import LivePresetStore, LiveRecord

if TYPE_CHECKING:
    import asyncio

#: A profile the fake daemon lists, and the one each engine here starts on.
LISTED = "Default"
MIXDOWN = "Mch-to-Stereo mixdown"

#: A profile name the fake daemon does not list.
UNLISTED = "Nope"

#: The unnamed default station, loaded while no config preset is.
DEFAULT_STATION = ""

#: A manager on the control fake and that fake's live State.
Engine = tuple[ConnectionManager, dict[str, str]]
EngineFactory = Callable[..., Coroutine[Any, Any, Engine]]


@pytest.fixture
async def engine(daemon: DaemonFactory, clock: VirtualClock, tmp_path: Path) -> AsyncIterator[EngineFactory]:
    """Build a manager on a control fake carrying the given State overrides,
    every store under ``tmp_path``, handed over connected and idle."""
    started: list[tuple[ConnectionManager, asyncio.Task[None]]] = []

    async def build(**overrides: str) -> Engine:
        port, _, state = await daemon(**overrides)
        manager = ConnectionManager(
            Config(
                hqp_host="127.0.0.1",
                hqp_control_port=port,
                backup_dir=tmp_path / "backups",
                preset_dir=tmp_path / "presets",
                live_preset_file=tmp_path / "live-presets.json",
            ),
            clock=clock,
        )
        task = clock.spawn(manager.run())
        started.append((manager, task))
        await settled(clock)
        return manager, state

    yield build
    for manager, task in started:
        manager.stop()
        await task
        await manager.aclose()


def live_store(manager: ConnectionManager) -> LivePresetStore:
    """The live-snapshot store the manager's preset collaborator holds."""
    store: LivePresetStore = manager.presetops.live_presets
    return store


def held_profile(manager: ConnectionManager, name: str) -> str | None:
    """The matrix profile the default station's snapshot ``name`` holds, or None
    when the station holds no such snapshot or it carries no profile."""
    record = live_store(manager).all(DEFAULT_STATION).get(name)
    return None if record is None else record.fields.get("matrix_profile")


async def refusal_code(attempt: Awaitable[object]) -> str | None:
    """The code ``attempt`` is refused with, or None when it goes through."""
    try:
        await attempt
    except HQPTunerError as refused:
        return refused.code
    return None


async def test_a_snapshot_recorded_from_core_holds_the_profile_it_was_given(engine: EngineFactory) -> None:
    manager, _ = await engine(matrix_profile=MIXDOWN)
    await livesnapshots.record(manager, "Warm", fields=["matrix_profile"], values={"matrix_profile": LISTED})
    assert held_profile(manager, "Warm") == LISTED


async def test_recording_from_core_a_profile_the_engine_does_not_list_is_refused(engine: EngineFactory) -> None:
    manager, _ = await engine()
    save = livesnapshots.record(manager, "Warm", fields=["matrix_profile"], values={"matrix_profile": UNLISTED})
    assert await refusal_code(save) == "values_unknown"


async def test_applying_a_snapshot_from_core_switches_the_engine_to_its_profile(engine: EngineFactory) -> None:
    manager, state = await engine(matrix_profile=MIXDOWN)
    live_store(manager).save("Warm", LiveRecord(chain="pcm", fields={"matrix_profile": LISTED}), [DEFAULT_STATION])
    await livesnapshots.apply(manager, "Warm")
    assert state["matrix_profile"] == LISTED


async def test_applying_from_core_a_snapshot_whose_profile_the_engine_no_longer_lists_is_refused(
    engine: EngineFactory,
) -> None:
    manager, _ = await engine(matrix_profile=MIXDOWN)
    live_store(manager).save("Gone", LiveRecord(chain="pcm", fields={"matrix_profile": UNLISTED}), [DEFAULT_STATION])
    assert await refusal_code(livesnapshots.apply(manager, "Gone")) == "route_refused"
