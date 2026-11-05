"""The persistent restore's edges, against the fake 8088 daemon.

A restore pass that never lands, a readback the daemon answers with something that is not a settings archive, a
device the daemon's form can no longer be asked about, and an apply that deletes the matrix profile the listener is
on each end the apply in a state the caller has to be able to tell apart from success. The fake speaks the wire: the
pre-restart archive, the restore POST refused with 503, and the archive served as a stranger's bytes.
"""

import json
from collections.abc import Iterator
from typing import Any

import fake_http
import pytest
from conftest import ManagerFactory

from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.http import restore
from hqptuner.lanes.http.restore import RestoreOutcome, RestoreWriteFailedError

#: The profile the listener is on, stored with one row at a gain no live matrix below has.
ACTIVE = "Night"
STORED_GAIN = "-7"
LIVE_GAIN = "-2"
LIVE_ROWS = [{"gain": LIVE_GAIN, "mixdown": "0", "process": "", "source": "0"}]
STORED_ROWS = [{"gain": STORED_GAIN, "mixdown": "0", "process": "", "source": "0"}]
DELETE_ACTIVE = json.dumps({"name": ACTIVE, "presets": []})


@pytest.fixture
def profile_daemon() -> Iterator[dict[str, Any]]:
    """A daemon whose live matrix sits at ``LIVE_GAIN`` and which stores ``ACTIVE`` at ``STORED_GAIN``."""
    yield from fake_http.spawn(
        fake_http.state(_profiles={ACTIVE: {"rows": STORED_ROWS, "plugins": []}}, _pipelines=LIVE_ROWS)
    )


async def test_a_restore_the_daemon_refuses_on_every_pass_reports_the_write_never_landed(
    restore_refusing_http_daemon: dict[str, Any], http_manager_factory: ManagerFactory
) -> None:
    manager = http_manager_factory(restore_refusing_http_daemon)
    with pytest.raises(RestoreWriteFailedError):
        await restore.apply(manager, {"title": "Renamed"})


@pytest.mark.parametrize(
    ("edits", "gain"),
    [({"title": "Renamed"}, STORED_GAIN), ({"matrix_profile_delete": DELETE_ACTIVE}, LIVE_GAIN)],
    ids=["ordinary edit", "deleting the active profile"],
)
async def test_an_apply_installs_the_active_profiles_rows_unless_it_deletes_that_profile(
    profile_daemon: dict[str, Any], http_manager_factory: ManagerFactory, edits: dict[str, str], gain: str
) -> None:
    manager = http_manager_factory(profile_daemon)
    manager.readings.state = {"matrix_profile": ACTIVE}
    await restore.apply(manager, edits)
    assert profile_daemon["_pipelines"][0]["gain"] == gain


@pytest.mark.parametrize(
    ("served", "readable"),
    [(None, True), ("_corrupt_backup", False), ("_truncated_backup", False)],
    ids=["settings archive", "not an archive", "archive cut short"],
)
async def test_a_readback_is_read_as_config_only_when_the_daemon_served_a_settings_archive(
    http_daemon: dict[str, Any], http_manager_factory: ManagerFactory, served: str | None, *, readable: bool
) -> None:
    if served is not None:
        http_daemon[served] = True
    manager = http_manager_factory(http_daemon)
    realized = await restore.verify(manager, {"title": "Renamed"}, {"title"})
    assert ("title" in realized) is readable


async def _outcome(manager: ConnectionManager, device: str) -> RestoreOutcome:
    return (await restore.apply(manager, {"net_device": device})).outcome


@pytest.mark.parametrize(
    ("config_served", "outcome"),
    [(True, RestoreOutcome.UNAVAILABLE), (False, RestoreOutcome.UNCONVERGED)],
    ids=["form answers", "form unreachable"],
)
async def test_a_missing_net_device_reads_unfixable_only_while_the_daemons_form_can_say_it_is_gone(
    http_daemon: dict[str, Any],
    http_manager_factory: ManagerFactory,
    *,
    config_served: bool,
    outcome: RestoreOutcome,
) -> None:
    if not config_served:
        http_daemon["_fail_paths"] = ["/config"]
    manager = http_manager_factory(http_daemon)
    assert await _outcome(manager, "GHOST/hw:CARD=Gone,DEV=0") is outcome
