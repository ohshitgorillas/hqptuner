"""HTTP-lane persistent apply, end to end through a faithful fake config daemon
(docs/testing.md). The fake (conftest `http_daemon` and its variants) speaks the
real wire contract discovered on 6.0.4: it rejects a partial form, rejects a
checkbox sent as anything but "1", answers HTTP 200 even when it rejects, and
its GET renders the running state. So a change only round-trips if
`manager.apply` built a restore archive the real daemon would accept — a wrong
form->XML mapping in the writer surfaces as a failed readback."""

from pathlib import Path
from typing import Any

import pytest
from conftest import ManagerFactory

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.manager import ConnectionManager


@pytest.fixture
def apply_via(http_manager: ConnectionManager) -> tuple[ConnectionManager, HttpConfigClient]:
    """The manager plus its config client — several assertions read the daemon's
    own form back rather than the manager's cached one."""
    return http_manager, http_manager.require_http()


async def _readback(http: HttpConfigClient) -> dict[str, Any]:
    return {f["name"]: f["value"] for f in (await http.get_config())["fields"]}


async def test_staged_persistent_change_is_applied(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    manager, http = apply_via
    await manager.apply({}, {"title": "Renamed"})
    assert (await _readback(http))["title"] == "Renamed"


async def test_enabling_a_checkbox_is_applied(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    manager, http = apply_via
    await manager.apply({}, {"net_ipv6": "1"})
    assert (await _readback(http))["net_ipv6"] is True


@pytest.mark.parametrize(
    ("field", "expected"),
    [("auto_family", True), ("samplerate", "0"), ("bitrate", "0")],
)
async def test_config_write_pins_the_field_regardless_of_staging(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
    field: str,
    expected: Any,
) -> None:
    # HQPTuner's friendly-rate UI only holds if every config write forces
    # auto_family on and the fixed sample/bit rate to Auto (0). The daemon starts
    # with the opposite values (see _http_state), and nothing here stages these
    # fields — so seeing the pinned value proves the write forced it.
    manager, http = apply_via
    await manager.apply({}, {"title": "Renamed"})
    assert (await _readback(http))[field] == expected


async def test_a_value_the_daemon_refuses_reports_not_applied(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    # the daemon refuses the value on restore, so the running config never
    # reflects it — the apply must report not-applied, never a silent success
    manager, _ = apply_via
    report = await manager.apply({}, {"title": "REJECT"})
    assert report["persistent"]["applied"] is False


async def test_a_daemon_that_never_returns_reports_not_applied(
    dying_http_daemon: dict[str, Any],
    http_manager_factory: ManagerFactory,
) -> None:
    # the daemon accepts the restore then never comes back; the apply must report
    # not-applied so the caller keeps the staging, not a false success
    manager = http_manager_factory(dying_http_daemon)
    report = await manager.apply({}, {"title": "Renamed"})
    assert report["persistent"]["applied"] is False


async def test_the_pre_apply_backup_is_written_to_disk(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
    tmp_path: Path,
) -> None:
    # a crash mid-apply must leave a recoverable copy behind, so the backup is
    # persisted before the POST, not just held in memory
    manager, _ = apply_via
    await manager.apply({}, {"title": "Renamed"})
    assert (tmp_path / "pre-apply-settings.zip").read_bytes().startswith(b"PK\x03\x04")


async def test_apply_verifies_through_the_post_restart_stale_window(
    stale_http_daemon: dict[str, Any],
    http_manager_factory: ManagerFactory,
) -> None:
    # the daemon serves the old form for a read after the POST; a single-GET
    # verify would false-negative here — the poll must ride through the stale read
    manager = http_manager_factory(stale_http_daemon, alarm_threshold=3.0)
    report = await manager.apply({}, {"title": "Renamed"})
    assert report["persistent"]["applied"] is True


async def test_save_as_new_persists_the_applied_config_under_a_new_preset(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    # Save as New = apply the working config, then persist it under a fresh preset
    # in the HQPTuner store; reading that preset back carries the change
    manager, _ = apply_via
    await manager.apply({}, {"title": "Renamed"})
    await manager.save_preset("Fresh")
    assert (await manager.read_preset("Fresh"))["title"] == "Renamed"


async def test_a_net_device_the_daemon_no_longer_offers_is_reported_unfixable(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    # the staged endpoint is not among the daemon's bindable devices, so no restart
    # can converge it — the apply must surface it as unfixable, never a false success
    manager, _ = apply_via
    report = await manager.apply({}, {"net_device": "GHOST/hw:CARD=Gone,DEV=0"})
    assert "net_device" in report["persistent"]["unfixable"]


async def test_loudness_edit_persists_to_the_loudness_plugin(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    # a staged loudness bass-frequency change must ride the restore/XML lane into
    # <plugin type="loudness"> low_frequency — proving the post_loudness_lowfreq ->
    # low_frequency mapping, not just that some field moved
    manager, http = apply_via
    await manager.apply({}, {"post_loudness_enabled": "1", "post_loudness_lowfreq": "120"})
    matrix = {f["name"]: f["value"] for f in (await http.get_matrix())["fields"]}
    assert matrix["post_loudness_lowfreq"] == 120


async def test_rescan_surfaces_a_newly_present_output_device(
    http_daemon: dict[str, Any],
    http_manager: ConnectionManager,
) -> None:
    # an endpoint that was powered off is absent from the device list until a
    # rescan; refresh_devices must trigger it AND refetch the form so the new
    # device is actually offered — a bare POST that skipped the refetch would not
    http_daemon["_hidden_endpoints"] = ["S99/hw:CARD=WokeUp,DEV=0"]
    await http_manager.refresh_devices()
    fields = (http_manager.config_form or {}).get("fields", [])
    offered = {o["value"] for f in fields if f["name"] == "net_device" for o in f["options"]}
    assert "S99/hw:CARD=WokeUp,DEV=0" in offered


async def test_read_preset_reads_the_store_and_survives_an_empty_backup(
    http_daemon: dict[str, Any],
    http_manager: ConnectionManager,
) -> None:
    # a preview reads the HQPTuner store, never the daemon — so it still works when
    # the daemon's /backup goes empty (the 6.0.4 post-load bug, protocol §3.6)
    await http_manager.save_preset("Kept")  # snapshot the running config into the store
    http_daemon["_empty"] = True
    cfg = await http_manager.read_preset("Kept")
    assert cfg["title"] == "Opal"
