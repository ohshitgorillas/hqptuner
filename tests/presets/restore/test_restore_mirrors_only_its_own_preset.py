"""A restore leaves the daemon's mirror of every stored preset it neither loads nor saves as it was.

hqplayerd keeps a ``data/cfgs/<name>.xml`` mirror per preset so its own profile
list stays populated. A restore
mirrors only the preset being loaded or saved; another preset in the store keeps
whatever mirror the daemon already held, and catches up when it is next loaded.

``POST /restore`` writes the members it carries and removes none it omits, so what the daemon holds for a
preset after a restore is the member the upload carried under its name, or the
mirror it held before when the upload carried none. The daemon's mirror of the
other preset always differs from that preset's stored record, so a restore that
rewrote it from the store is told apart from one that left it alone.

Each restore below runs with ``LOADED`` as the active preset, so ``OTHER`` is
neither loaded nor saved by any of them.
"""

import io
import zipfile
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from fake_config_xml import cfg_xml
from fake_http import state
from narrow import FixtureError

from hqptuner.core.manager import ConnectionManager

#: The preset each restore runs with active, and its stored record.
LOADED = "Den"
LOADED_RECORD = cfg_xml(state(title="Den record"))

#: A preset the store also holds that no restore here loads or saves, and its stored record.
OTHER = "Study Room"
OTHER_RECORD = cfg_xml(state(title="Study record as stored"))

#: What the daemon holds for ``OTHER`` before the restore: an older mirror than the
#: store's record, or no mirror at all.
OTHER_HELD_BY_DAEMON = [
    pytest.param(cfg_xml(state(title="Study record as last mirrored")), id="stale-mirror"),
    pytest.param(None, id="never-mirrored"),
]

#: A staged edit the fake daemon's config does not already carry.
STAGED_CHANGE = {"title": "Edited while loaded"}

#: An ``<engine>`` attribute value the fake daemon is not running, so the write is a real change.
ENGINE_CHANGE = {"cuda": "0"}


async def staged_apply_while_loaded(manager: ConnectionManager) -> None:
    manager.presetops.store.set_active(LOADED)
    await manager.applyops.apply({}, STAGED_CHANGE)


async def engine_apply_while_loaded(manager: ConnectionManager) -> None:
    manager.presetops.store.set_active(LOADED)
    await manager.applyops.apply_engine(ENGINE_CHANGE)


#: The restores that run while a preset is active and load none.
RESTORES = [
    pytest.param(staged_apply_while_loaded, id="staged-apply"),
    pytest.param(engine_apply_while_loaded, id="engine-apply"),
]


def cfgs_member(name: str) -> str:
    """The archive member hqplayerd keeps a named profile under."""
    return f"data/cfgs/{name}.xml"


def mirror_after_restore(daemon: dict[str, Any], name: str, before: bytes | None) -> bytes | None:
    """What the daemon holds for ``name`` once the last restore landed: the member the
    upload carried under that name, else what it held before."""
    upload = daemon.get("_restore_bytes")
    if upload is None:
        raise FixtureError(reason="the restore never reached the daemon")
    archive = zipfile.ZipFile(io.BytesIO(upload))
    member = cfgs_member(name)
    return archive.read(member) if member in archive.namelist() else before


@pytest.mark.parametrize("held", OTHER_HELD_BY_DAEMON)
@pytest.mark.parametrize("restore", RESTORES)
async def test_a_restore_leaves_the_daemon_mirror_of_a_stored_preset_it_neither_loads_nor_saves_as_it_was(
    http_daemon: dict[str, Any],
    http_manager: ConnectionManager,
    restore: Callable[[ConnectionManager], Awaitable[None]],
    held: bytes | None,
) -> None:
    if held is not None:
        http_daemon["_saved"][OTHER] = held
    http_manager.presetops.store.save(LOADED, LOADED_RECORD)
    http_manager.presetops.store.save(OTHER, OTHER_RECORD)
    await restore(http_manager)
    assert mirror_after_restore(http_daemon, OTHER, held) == held
