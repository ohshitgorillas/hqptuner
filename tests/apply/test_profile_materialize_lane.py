"""The persistent apply lane materializes the profile the engine is running.

The active matrix profile is runtime-only state — the daemon reports it in
``State.matrix_profile`` and the config XML records the selection nowhere
(hqplayerd-readme.txt §1.12) — so the config the lane uploads to ``POST
/restore`` has to carry that profile's matrix as the LIVE ``<matrix>``, or the
self-restarting daemon comes back running something the user never chose.

Both lanes are real here: the 4321 fake reports the active profile over a real
socket, the 8088 fake receives the restore and re-reads the uploaded config with
its own adopter. The live rows are read back off the fake's adopted state, at a
gain no default in either fake produces.
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import pytest
from conftest import DaemonFactory, ManagerFactory, eventually
from fake_control import CommandLog, restart_after

from hqptuner.core.manager import ConnectionManager

#: The rows "Night" stores in the config file: one row, at a gain neither fake's
#: default pipeline carries, so an unmaterialized apply cannot read as a pass.
NIGHT_ROWS = [{"gain": "-7", "mixdown": "0", "process": "", "source": "1"}]

#: The live matrix's own rows, at a gain that is neither the fake's default (0)
#: nor Night's (-7): "the live rows were kept" has to be distinguishable from
#: "the live rows were wiped", which the fake's adopter reads back as the default.
LIVE_ROWS = [
    {"gain": "-2", "mixdown": "0", "process": "", "source": "0"},
    {"gain": "-2", "mixdown": "1", "process": "", "source": "1"},
]

#: A manager on both fakes, plus everything the 4321 fake was asked.
Built = tuple[ConnectionManager, CommandLog]
RunningProfile = Callable[[str], Awaitable[Built]]


@pytest.fixture
async def running_profile(
    daemon: DaemonFactory,
    http_daemon: dict[str, Any],
    http_manager_factory: ManagerFactory,
) -> AsyncIterator[RunningProfile]:
    """A manager on both fakes, the 4321 one reporting the named profile active."""
    started: list[tuple[ConnectionManager, asyncio.Task[None]]] = []

    async def build(active: str) -> Built:
        port, log, state = await daemon(matrix_profile=active, _profile_names=active)
        manager = http_manager_factory(
            http_daemon,
            hqp_host="127.0.0.1",
            hqp_control_port=port,
            hqp_http_port=http_daemon["_port"],
            poll_interval=0.02,
        )
        # The restore this lane exists for SELF-RESTARTS the daemon: it answers
        # 200, then exits and comes back running the config it just adopted,
        # taking the Control API socket with it. The whole point of materializing
        # the profile is what that restarted process comes up on, so the fake has
        # to actually restart.
        http_daemon["_on_restore"] = lambda: restart_after(state)
        task = asyncio.create_task(manager.run())
        await eventually(lambda: manager.reachable)
        started.append((manager, task))
        return manager, log

    yield build
    for manager, task in started:
        manager.stop()
        await task
        await manager.aclose()


def with_night(http_daemon: dict[str, Any]) -> None:
    """The config file carries a saved "Night" whose rows differ from the live ones."""
    http_daemon["_profiles"] = {"Night": {"rows": NIGHT_ROWS, "plugins": []}}
    http_daemon["_pipelines"] = [dict(row) for row in LIVE_ROWS]


# --- the active profile is in the config: its matrix goes live ----------------


async def test_an_apply_under_an_active_profile_restores_that_profiles_rows(
    running_profile: RunningProfile, http_daemon: dict[str, Any]
) -> None:
    with_night(http_daemon)
    manager, _log = await running_profile("Night")
    await manager.applyops.apply({}, {"title": "Renamed"})
    assert http_daemon["_pipelines"][0]["gain"] == "-7"


async def test_an_apply_under_an_active_profile_still_applies_the_staged_edit(
    running_profile: RunningProfile, http_daemon: dict[str, Any]
) -> None:
    with_night(http_daemon)
    manager, _log = await running_profile("Night")
    await manager.applyops.apply({}, {"title": "Renamed"})
    assert http_daemon["title"] == "Renamed"


async def test_an_apply_under_an_active_profile_reports_applied(
    running_profile: RunningProfile, http_daemon: dict[str, Any]
) -> None:
    with_night(http_daemon)
    manager, _log = await running_profile("Night")
    report = await manager.applyops.apply({}, {"title": "Renamed"})
    assert report["persistent"]["applied"] is True


async def test_an_apply_under_an_active_profile_reports_no_profile_restoration(
    running_profile: RunningProfile, http_daemon: dict[str, Any]
) -> None:
    # the key belonged to the superseded re-selection design; nothing re-selects
    # a profile now, so the report must not claim it did
    with_night(http_daemon)
    manager, _log = await running_profile("Night")
    report = await manager.applyops.apply({}, {"title": "Renamed"})
    assert "profile_restored" not in report["persistent"]


# --- and the engine is never asked to re-select the profile -------------------
#
# Materializing the profile into the live <matrix> is the whole mechanism: the
# restarted daemon comes up already running it. A MatrixSetProfile on top would
# be a playback-time switch issued at the one moment nothing is playing.


async def test_an_apply_under_an_active_profile_sends_no_profile_switch(
    running_profile: RunningProfile, http_daemon: dict[str, Any]
) -> None:
    with_night(http_daemon)
    manager, log = await running_profile("Night")
    await manager.applyops.apply({}, {"title": "Renamed"})
    assert "MatrixSetProfile" not in [name for name, _attrs in log]


# --- a profile only the daemon knows: nothing to adopt, and no failure --------
#
# hqplayerd never persists a profile saved through its own /matrix route, so a
# daemon can report one active that the config file has never heard of. That is
# an ordinary state, not an error: the apply proceeds on the live matrix.


async def test_an_apply_under_a_profile_the_config_lacks_still_reports_applied(
    running_profile: RunningProfile, http_daemon: dict[str, Any]
) -> None:
    with_night(http_daemon)
    manager, _log = await running_profile("Ghost")
    report = await manager.applyops.apply({}, {"title": "Renamed"})
    assert report["persistent"]["applied"] is True


async def test_an_apply_under_a_profile_the_config_lacks_keeps_the_live_rows(
    running_profile: RunningProfile, http_daemon: dict[str, Any]
) -> None:
    with_night(http_daemon)
    manager, _log = await running_profile("Ghost")
    await manager.applyops.apply({}, {"title": "Renamed"})
    assert http_daemon["_pipelines"][0]["gain"] == "-2"
