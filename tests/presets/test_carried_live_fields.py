"""What a restore-shaped write carries for the live-only settings
(docs/testing.md — behavior only, one assertion per test, public API only,
fakes speak the wire protocol).

Output mode, both chains' filters and shapers and adaptive volume
(``overrides.LIVE_DOMAIN``) are applied over the 4321 control lane and never
reach hqplayerd's config file. A restore restarts the
daemon onto that file, so those settings have to be carried into the pushed
config from somewhere. ``carried_live_fields`` answers where from: the RUNNING
ENGINE first, because that is what the user is hearing, and the active preset's
stored snapshot only for the fields the engine cannot answer for.

The engine's half arrives off the real-socket control fake (``fake_control``):
its State starts on the PCM chain (mode="1"), and ``mode="2"`` starts it on SDM,
which is reported in the configuration form's own domain (``auto`` / ``pcm`` /
``sdm``, hqplayerd-readme.txt §1.7) by joining the modes enumeration BY NAME —
the wire list is ``[source]``/``PCM``/``SDM (DSD)`` at indices 0/1/2 and State's
``mode`` attribute carries the index.

The store's half is an ordinary saved config snapshot: ``fake_config_xml.cfg_xml``
renders the 6.0.4 file, ``presetconf.apply_edits`` moves the fields under test in
it, and ``PresetStore`` makes it the active preset — the same shape
``test_restart_survival._active_preset_carrying`` uses.

The apply path over the same contract is `test_restore_carries_the_engine.py`.
"""

import asyncio
from collections.abc import AsyncIterator, Callable, Coroutine
from pathlib import Path
from typing import Any

import pytest
from conftest import DaemonFactory
from fake_config_xml import cfg_xml
from fake_http import state

from hqptuner.conf import presetconf
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.presetfields import carried_live_fields
from hqptuner.presets.store.presets import PresetStore

#: Build a manager on a control fake started with the given State overrides.
EngineManager = Callable[..., Coroutine[Any, Any, ConnectionManager]]


@pytest.fixture
async def engine_manager(daemon: DaemonFactory, tmp_path: Path) -> AsyncIterator[EngineManager]:
    """A manager on the control fake alone, with its preset directory under
    ``tmp_path``. The poll interval is parked far out so nothing observed here
    is the background poll's doing."""
    started: list[tuple[ConnectionManager, asyncio.Task[None]]] = []

    async def build(**overrides: str) -> ConnectionManager:
        port, _, _ = await daemon(**overrides)
        manager = ConnectionManager(
            Config(
                hqp_host="127.0.0.1",
                hqp_control_port=port,
                poll_interval=30.0,
                backup_dir=tmp_path / "backups",
                preset_dir=tmp_path / "presets",
            )
        )
        task = asyncio.create_task(manager.run())
        started.append((manager, task))
        return manager

    yield build
    for manager, task in started:
        manager.stop()
        await task
        await manager.aclose()


def _active_preset_holding(preset_dir: Path, edits: dict[str, str], name: str = "Kept") -> None:
    """Make ``name`` the active preset, its stored snapshot carrying ``edits``."""
    store = PresetStore(preset_dir)
    store.save(name, presetconf.apply_edits(cfg_xml(state()), edits))
    store.set_active(name)


# --- the store answers only where the engine cannot ---------------------------


#: (State, field, stored) for the fields belonging to the chain the engine does
#: NOT have loaded: State carries one filter, one 1x filter and one shaper, and
#: they answer for the loaded chain alone (protocol.md §4), so the other chain's
#: three fields have no engine answer at all and the snapshot is the only source.
STORE_ANSWERS = [
    ({"mode": "1"}, "oversampling", "23"),
    ({"mode": "1"}, "oversampling1x", "38"),
    ({"mode": "1"}, "modulator", "12"),
    ({"mode": "2"}, "filter", "25"),
    ({"mode": "2"}, "filter1x", "40"),
    ({"mode": "2"}, "dither", "7"),
]


@pytest.mark.parametrize(("state", "field", "stored"), STORE_ANSWERS, ids=[row[1] for row in STORE_ANSWERS])
async def test_a_field_the_engine_cannot_answer_for_comes_from_the_store(
    engine_manager: EngineManager, tmp_path: Path, state: dict[str, str], field: str, stored: str
) -> None:
    manager = await engine_manager(**state)
    _active_preset_holding(tmp_path / "presets", {field: stored})
    assert carried_live_fields(manager)[field] == stored


async def test_a_stored_field_outside_the_live_domain_is_not_carried(
    engine_manager: EngineManager, tmp_path: Path
) -> None:
    # the snapshot is a whole config file, so it holds settings that reach the
    # daemon through the file like any other; carrying those would push a
    # preset's value for a setting the user never staged.
    #
    # Both stored fields are moved in the SAME snapshot and the engine is on PCM,
    # so `oversampling` is the positive control: it can only have come from the
    # store. Asserting the absence alone would pass just as well on a snapshot
    # nothing ever read — an inactive preset, or a save that never landed.
    manager = await engine_manager(mode="1")
    _active_preset_holding(tmp_path / "presets", {"oversampling": "23", "volume_min": "-40"})
    carried = carried_live_fields(manager)
    assert set(carried) & {"oversampling", "volume_min"} == {"oversampling"}


# --- nothing to carry ---------------------------------------------------------


def test_a_manager_with_neither_source_answers_empty_instead_of_raising(tmp_path: Path) -> None:
    # a no-crash guard, not a coverage claim: a manager that never connected has
    # no State to read the engine off and its empty preset directory has no
    # active preset, so the only contract left is that the call still answers —
    # a restore on a cold manager must not die on the way to the push
    manager = ConnectionManager(Config(backup_dir=tmp_path, preset_dir=tmp_path / "presets"))
    assert carried_live_fields(manager) == {}
