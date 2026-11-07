"""A restore boots the daemon on the realized config: for a live-domain field, what the Engine is running.

A restore boots on the realized config: the File as ``/backup`` last returned it, the Staged edits
written in, and for the live-domain fields the Engine's last verified value.
A stored preset is not one of those sources. The restore an engine-attribute
apply makes and the restore a staged apply makes both boot on it.

On every wire here the Engine, the File and the active preset's Record each hold
a different value for the PCM chain's filter slots, and the Engine has the PCM
chain loaded. The 8088 fake records the upload exactly as it arrived, so the
working config a restore put on the wire is read from the upload itself.
"""

import io
import zipfile
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
from apps import settled
from conftest import DaemonFactory
from fake_config_xml import cfg_xml, elem_attr
from fake_http import state
from narrow import FixtureError
from virtual_clock import VirtualClock

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager

if TYPE_CHECKING:
    import asyncio

#: The preset the store holds as active while each restore runs, and its Record:
#: a filter slot value on each PCM field that neither the Engine nor the File holds.
ACTIVE_PRESET = "Den"
RECORD_XML = cfg_xml(state(title="Den record", filter="31", filter1x="33"))

#: A staged edit to a field no live setter reaches, so the staged apply restores.
STAGED_EDIT = {"title": "Renamed"}

#: An ``<engine>`` attribute value the fake daemon is not running, so the write is a real change.
ENGINE_EDIT = {"cuda": "0"}


class EngineFilter:
    """One PCM filter slot the Engine runs off the File's value.

    ``state_key`` is the slot in the control fake's ``State``, ``index`` the list
    index the Engine runs there, ``pcm_attr`` the ``<pcm>`` attribute the File
    keeps the slot in, and ``enum_id`` the enum ID the fake's PCM filter list
    gives that index. The fake's File holds ``40`` for ``filter`` and ``47`` for
    ``filter1x``, so neither equals the Engine's.
    """

    def __init__(self, state_key: str, index: str, pcm_attr: str, enum_id: str) -> None:
        self.state_key = state_key
        self.index = index
        self.pcm_attr = pcm_attr
        self.enum_id = enum_id


#: The Nx slot on ``sinc-M`` (PCM index 2, enum 25) and the 1x slot on
#: ``poly-sinc-short-mp`` (PCM index 3, enum 57).
ENGINE_FILTERS = [
    pytest.param(EngineFilter("filterNx", "2", "filter", "25"), id="nx-filter"),
    pytest.param(EngineFilter("filter1x", "3", "filter1x", "57"), id="1x-filter"),
]

#: A manager on both lanes, settled after its first connect, with the store's active preset set.
DualLane = Callable[..., Awaitable[ConnectionManager]]


@pytest.fixture
async def dual_lane(daemon: DaemonFactory, http_daemon: dict[str, Any], tmp_path: Path) -> AsyncIterator[DualLane]:
    """Build a connected manager on the 4321 fake and the 8088 fake.

    Keyword arguments are the control fake's ``State`` overrides. The store holds
    ``RECORD_XML`` as the active preset before the manager connects."""
    built: list[tuple[ConnectionManager, asyncio.Task[None], HttpConfigClient]] = []

    async def build(**overrides: str) -> ConnectionManager:
        port, _log, _state = await daemon(**overrides)
        http = HttpConfigClient("127.0.0.1", http_daemon["_port"], "u", "p")
        clock = VirtualClock()
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=port,
            alarm_threshold=1.0,
            backup_dir=tmp_path / "backups",
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
        )
        manager = ConnectionManager(cfg, http, clock)
        manager.presetops.store.save(ACTIVE_PRESET, RECORD_XML)
        manager.presetops.store.set_active(ACTIVE_PRESET)
        task = clock.spawn(manager.run())
        built.append((manager, task, http))
        await settled(clock)
        return manager

    yield build
    for manager, task, http in built:
        manager.stop()
        await task
        await manager.aclose()
        await http.aclose()


async def staged_apply(manager: ConnectionManager) -> None:
    await manager.applyops.apply({}, STAGED_EDIT)


async def engine_apply(manager: ConnectionManager) -> None:
    await manager.applyops.apply_engine(ENGINE_EDIT)


#: The two writes that restore without loading a preset.
RESTORES = [
    pytest.param(staged_apply, id="staged-apply"),
    pytest.param(engine_apply, id="engine-apply"),
]


def engine_reading_holds(manager: ConnectionManager, engine_filter: EngineFilter) -> None:
    """Refuse to go on unless the manager's Engine reading already holds the slot the Engine runs.

    The restore is meant to find a verified Engine value to take; a manager that
    never read ``State`` would fail the assertion for a different reason."""
    reading = manager.readings.state
    held = None if reading is None else reading.get(engine_filter.state_key)
    if held != engine_filter.index:
        raise FixtureError(reason=f"the Engine reading holds {held!r}, not the running {engine_filter.index!r}")


def uploaded_pcm_attr(daemon: dict[str, Any], attr: str) -> str | None:
    """The ``<pcm>`` attribute of the working config the last restore uploaded."""
    upload = daemon.get("_restore_bytes")
    if upload is None:
        raise FixtureError(reason="the restore never reached the daemon")
    xml = zipfile.ZipFile(io.BytesIO(upload)).read("hqplayerd.xml")
    return elem_attr(xml, "pcm", attr)


@pytest.mark.parametrize("write", RESTORES)
@pytest.mark.parametrize("engine_filter", ENGINE_FILTERS)
async def test_a_restore_boots_on_the_filter_the_engine_is_running(
    dual_lane: DualLane,
    http_daemon: dict[str, Any],
    write: Callable[[ConnectionManager], Awaitable[None]],
    engine_filter: EngineFilter,
) -> None:
    manager = await dual_lane(**{engine_filter.state_key: engine_filter.index})
    engine_reading_holds(manager, engine_filter)
    await write(manager)
    assert uploaded_pcm_attr(http_daemon, engine_filter.pcm_attr) == engine_filter.enum_id
