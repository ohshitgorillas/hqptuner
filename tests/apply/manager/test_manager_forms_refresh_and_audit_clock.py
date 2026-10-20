"""The manager's own forms refresh, and the clock its audit log stamps on.

A forms refresh asked of the manager does the whole of the 8088 read: the forms
land in the readings, the output device's capability is learned from the log
alongside them, and the caller is told what the refresh did. Everything is driven
off the fake 8088 daemon's table; the manager is never patched.

The audit log the manager builds stamps each record on the manager's clock, so a
manager handed a virtual clock writes that clock's instant, not the host's. The
record is read back off the JSONL file with a plain parse, not through the audit
module's own reader.
"""

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from audit_records import last
from conftest import ManagerFactory
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.http import forms

#: The matrix profile the fake daemon is told is active, one of the profiles its
#: table lists and not the one it starts on.
ACTIVE_PROFILE = "Mch-to-Stereo mixdown"

#: The endpoint and device the fake daemon's config form selects, as its log
#: names them when the device is opened.
ENDPOINT, DEVICE = "S26", "hw:CARD=Output,DEV=0"

#: The PCM rates this test's log announces for the selected device.
ANNOUNCED_PCM_RATES = [88200, 352800]

#: One device-open block as hqplayerd writes it: the endpoint/device line, then
#: one line per accepted format.
ANNOUNCING_LOG = (
    "2026/08/01 02:03:30 Engine started\n"
    "2026/08/01 02:03:31 Opening output device\n"
    f"2026/08/01 02:03:37 NAA output endpoint '{ENDPOINT}' : '{DEVICE}'\n"
    "2026/08/01 02:03:38 NAA output network format: 88200/32/2 [pcm]\n"
    "2026/08/01 02:03:38 NAA output network format: 352800/32/2 [pcm]\n"
    "2026/08/01 02:03:38 NAA output network format: 2822400/1/2 [dsd]\n"
)

#: A virtual wall-clock instant far from any real one, so a record stamped on
#: the host's clock cannot match it by accident.
VIRTUAL_INSTANT = datetime(2001, 2, 3, 4, 5, 6, tzinfo=UTC)


def _active_matrix_profile(manager: ConnectionManager) -> str | None:
    """The active profile the manager's matrix form reads, or None with no form loaded."""
    form = manager.readings.matrix_form
    return None if form is None else form["active"]


def _pcm_rates(manager: ConnectionManager) -> list[int] | None:
    """The PCM rates of the capability the manager holds, or None with none known."""
    caps = manager.readings.device_caps
    return None if caps is None else caps.pcm_rates


# --- the forms refresh, asked of the manager ----------------------------------


async def test_a_manager_forms_refresh_loads_the_forms_the_daemon_serves(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    http_daemon["matrix_active"] = ACTIVE_PROFILE
    await http_manager.refresh_http_forms()
    assert _active_matrix_profile(http_manager) == ACTIVE_PROFILE


async def test_a_manager_forms_refresh_learns_the_selected_devices_announced_capability(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any]
) -> None:
    # the stock form already selects S26/hw:CARD=Output,DEV=0; only the log is new.
    # The config names the fake daemon's port, so the log is read where it is served.
    http_daemon["_log"] = ANNOUNCING_LOG
    manager = http_manager_factory(http_daemon, hqp_http_port=http_daemon["_port"])
    await manager.refresh_http_forms()
    assert _pcm_rates(manager) == ANNOUNCED_PCM_RATES


@pytest.mark.parametrize("refuse_auth", [False, True], ids=["credential_accepted", "credential_refused"])
async def test_a_manager_forms_refresh_answers_what_the_forms_refresh_did(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any], *, refuse_auth: bool
) -> None:
    # a twin manager on the same daemon is refreshed through the forms lane
    # itself; the manager's own refresh must answer the outcome that lane reported
    http_daemon["_refuse_auth"] = refuse_auth
    lane_outcome = (await forms.refresh(http_manager_factory(http_daemon))).outcome
    assert await http_manager_factory(http_daemon).refresh_http_forms() == lane_outcome


# --- the audit log, on the manager's clock -------------------------------------


def test_the_managers_audit_log_stamps_records_on_the_managers_clock(tmp_path: Path) -> None:
    audit_path = tmp_path / "audit.jsonl"
    config = Config(debug_log=audit_path, backup_dir=tmp_path, preset_dir=tmp_path / "presets")
    manager = ConnectionManager(config, clock=VirtualClock(now=VIRTUAL_INSTANT))
    manager.audit.preset_write("alpha", "save", 10, "abc123", overwrote=False)
    assert datetime.fromisoformat(last(audit_path, "preset.write")["ts"]) == VIRTUAL_INSTANT
