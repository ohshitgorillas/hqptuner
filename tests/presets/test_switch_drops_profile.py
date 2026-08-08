"""A preset switch drops the live matrix profile; a plain apply keeps it.

``<matrix_profile>`` carries only a ``name`` (hqplayerd-readme.txt §1.12) and
the daemon records the selected profile nowhere, so every restart comes up on
the live ``<matrix>``. A plain apply therefore re-installs the active profile's
stored matrix — rows and ``<post_process>`` chain both (§1.11.2) — so adoption
survives the restore restart. A ``switch_to`` apply is different: the user chose
a whole preset, and that preset's own live ``<matrix>`` is what they asked for,
even when the preset's stored config happens to carry a profile of the same
name as the one live right now. These cases pin that fork through the public
apply surface against both wire fakes.

Every asserted value is one the fakes' defaults cannot produce: the preset's
live rows sit at gain -2 and Night's stored rows at -7 (default 0); Night's
stored bauer stage sits at 300 Hz against a live 850 (default 700), so "nothing
was adopted" and "the wrong matrix was adopted" read differently.
"""

import asyncio
import json
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

import fake_http
import pytest
from conftest import eventually
from fake_config_xml import cfg_xml
from fake_http import state

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager

#: Night's stored matrix: one row at a gain no live matrix here has, and a
#: bauer stage at a frequency no live chain here has.
NIGHT = {
    "rows": [{"gain": "-7", "mixdown": "0", "process": "", "source": "1"}],
    "plugins": [{"type": "bauer", "enabled": "1", "frequency": "300", "preset": "default", "level": "4.5"}],
}

#: The live ``<matrix>`` rows of the config that carries Night: two rows at a
#: gain that is neither the fake's default (0) nor Night's (-7).
OWN_ROWS = [
    {"gain": "-2", "mixdown": "0", "process": "", "source": "0"},
    {"gain": "-2", "mixdown": "1", "process": "", "source": "1"},
]


def night_cfg() -> dict[str, Any]:
    """Fake-daemon state whose config carries a saved "Night" profile alongside
    its own live matrix: rows at -2, bauer at 850."""
    return state(_profiles={"Night": NIGHT}, _pipelines=OWN_ROWS, post_bauer_frequency="850")


async def _dual_manager(control_port: int, daemon: dict[str, Any], tmp_path: Path) -> AsyncIterator[ConnectionManager]:
    """A manager wired to BOTH fakes — the live 4321 daemon for the profile
    switch, the given 8088 daemon for the restore lane — torn down before either
    fake. The poll interval is parked far out so nothing the tests observe is
    the poll's doing."""
    http = HttpConfigClient("127.0.0.1", daemon["_port"], "u", "p")
    manager = ConnectionManager(
        Config(
            hqp_host="127.0.0.1",
            hqp_control_port=control_port,
            poll_interval=30.0,
            backup_dir=tmp_path / "backups",
            preset_dir=tmp_path / "presets",
        ),
        http,
    )
    task = asyncio.create_task(manager.run())
    await eventually(lambda: manager.reachable)
    yield manager
    manager.stop()
    await task
    await manager.aclose()
    await http.aclose()


@pytest.fixture
def night_http_daemon() -> Iterator[dict[str, Any]]:
    """A daemon whose RUNNING config carries the "Night" profile."""
    yield from fake_http.spawn(night_cfg())


@pytest.fixture
def plain_http_daemon() -> Iterator[dict[str, Any]]:
    """A daemon on the stock config — no "Night" anywhere in it."""
    yield from fake_http.spawn(state())


@pytest.fixture
async def plain_manager(
    live_daemon_port: int, plain_http_daemon: dict[str, Any], tmp_path: Path
) -> AsyncIterator[ConnectionManager]:
    async for manager in _dual_manager(live_daemon_port, plain_http_daemon, tmp_path):
        yield manager


@pytest.fixture
async def night_manager(
    live_daemon_port: int, night_http_daemon: dict[str, Any], tmp_path: Path
) -> AsyncIterator[ConnectionManager]:
    async for manager in _dual_manager(live_daemon_port, night_http_daemon, tmp_path):
        yield manager


async def rows(manager: ConnectionManager) -> list[dict[str, str]]:
    """The running config's live ``<matrix>`` rows, read back from the daemon."""
    pipelines: list[dict[str, str]] = json.loads((await manager.load_file_config())["matrix_pipelines"])
    return pipelines


# --- switch_to: the target preset's own matrix wins over the live profile ------


async def test_a_preset_switch_apply_keeps_the_presets_own_pipeline_rows(
    plain_manager: ConnectionManager,
) -> None:
    plain_manager.presetops.store.save("Base", cfg_xml(night_cfg()))
    await plain_manager.applyops.matrix_switch_profile("Night")
    await plain_manager.applyops.apply({}, {"title": "Tweaked"}, switch_to="Base")
    assert (await rows(plain_manager))[0]["gain"] == "-2"


async def test_a_preset_switch_apply_does_not_install_the_profiles_chain(
    plain_manager: ConnectionManager,
) -> None:
    # the preset's own live chain sits at 850, Night's stored bauer at 300; only
    # the preset's value may be running after the switch
    plain_manager.presetops.store.save("Base", cfg_xml(night_cfg()))
    await plain_manager.applyops.matrix_switch_profile("Night")
    await plain_manager.applyops.apply({}, {"title": "Tweaked"}, switch_to="Base")
    assert (await plain_manager.load_file_config()).get("post_bauer_frequency") == "850"


# --- no switch_to: adoption across the apply restart is preserved --------------


async def test_a_plain_apply_still_installs_the_active_profiles_rows(
    night_manager: ConnectionManager,
) -> None:
    await night_manager.applyops.matrix_switch_profile("Night")
    await night_manager.applyops.apply({}, {"title": "Renamed"})
    assert (await rows(night_manager))[0]["gain"] == "-7"
