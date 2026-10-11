"""HTTP-lane persistent apply, end to end through a faithful fake config daemon.
The fake (conftest `http_daemon` and its variants) speaks the real wire contract
discovered on 6.0.4: it rejects a partial form, rejects a
checkbox sent as anything but "1", answers HTTP 200 even when it rejects, and
its GET renders the running state. So a change only round-trips if
`manager.apply` built a restore archive the real daemon would accept — a wrong
form->XML mapping in the writer surfaces as a failed readback."""

from collections.abc import Iterator
from typing import Any

import fake_http
import pytest
from conftest import ManagerFactory

from hqptuner.conf import presetconf
from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes.http import restore
from hqptuner.lanes.http.restore import RestoreConverged, RestoreOutcome, RestoreUnavailable
from hqptuner.presets import presetlane
from hqptuner.presets.presetfields import restore_hooks


@pytest.fixture
def apply_via(http_manager: ConnectionManager) -> tuple[ConnectionManager, HttpConfigClient]:
    """The manager plus its config client — several assertions read the daemon's
    own form back rather than the manager's cached one."""
    return http_manager, http_manager.require_http()


@pytest.fixture
def once_refusing_http_daemon() -> Iterator[dict[str, Any]]:
    # refuses the first POST /restore with 5xx, then accepts on the retry
    yield from fake_http.spawn(fake_http.state(_restore_refusals=1))


async def test_apply_converges_after_one_5xx_restore_refusal(
    once_refusing_http_daemon: dict[str, Any],
    http_manager_factory: ManagerFactory,
) -> None:
    manager = http_manager_factory(once_refusing_http_daemon)
    result = await restore.apply(manager, {"title": "Renamed"}, restore_hooks(manager))
    assert isinstance(result, RestoreConverged)
    assert result.attempts == 2


async def _readback(http: HttpConfigClient) -> dict[str, Any]:
    return {f["name"]: f["value"] for f in (await http.get_config())["fields"] if f["name"] is not None}


async def test_staged_persistent_change_is_applied(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    manager, http = apply_via
    await manager.applyops.apply({}, {"title": "Renamed"})
    assert (await _readback(http))["title"] == "Renamed"


async def test_enabling_a_checkbox_is_applied(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    manager, http = apply_via
    await manager.applyops.apply({}, {"net_ipv6": "1"})
    assert (await _readback(http))["net_ipv6"] is True


@pytest.mark.parametrize(
    ("field", "expected"),
    [("auto_family", True), ("samplerate", "0"), ("bitrate", "0")],
)
async def test_config_write_pins_the_field_regardless_of_staging(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
    field: str,
    expected: object,
) -> None:
    # HQPTuner's friendly-rate UI only holds if every config write forces
    # auto_family on and the fixed sample/bit rate to Auto (0). The daemon starts
    # with the opposite values (see _http_state), and nothing here stages these
    # fields — so seeing the pinned value proves the write forced it.
    manager, http = apply_via
    await manager.applyops.apply({}, {"title": "Renamed"})
    assert (await _readback(http))[field] == expected


async def test_a_value_the_daemon_refuses_reports_not_applied(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    # the daemon refuses the value on restore, so the running config never
    # reflects it — the apply must report not-applied, never a silent success
    manager, _ = apply_via
    result = await restore.apply(manager, {"title": "REJECT"}, restore_hooks(manager))
    assert result.outcome is RestoreOutcome.UNCONVERGED


async def test_a_daemon_that_never_returns_reports_not_applied(
    dying_http_daemon: dict[str, Any],
    http_manager_factory: ManagerFactory,
) -> None:
    # the daemon accepts the restore then never comes back; the apply must report
    # not-applied so the caller keeps the staging, not a false success
    manager = http_manager_factory(dying_http_daemon)
    result = await restore.apply(manager, {"title": "Renamed"}, restore_hooks(manager))
    assert result.outcome is RestoreOutcome.UNCONVERGED


async def test_apply_verifies_through_the_post_restart_stale_window(
    stale_http_daemon: dict[str, Any],
    http_manager_factory: ManagerFactory,
) -> None:
    # the daemon serves the old form for a read after the POST; a single-GET
    # verify would false-negative here — the poll must ride through the stale read
    manager = http_manager_factory(stale_http_daemon, alarm_threshold=3.0)
    result = await restore.apply(manager, {"title": "Renamed"}, restore_hooks(manager))
    assert result.outcome is RestoreOutcome.APPLIED


async def test_save_as_new_persists_the_applied_config_under_a_new_preset(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    # Save as New = apply the working config, then persist it under a fresh preset
    # in the HQPTuner store; reading that preset back carries the change
    manager, _ = apply_via
    await manager.applyops.apply({}, {"title": "Renamed"})
    await manager.presetops.save_preset("Fresh")
    assert (await presetlane.read(manager, "Fresh"))["title"] == "Renamed"


@pytest.mark.parametrize(
    ("device", "outcome"),
    [("GHOST/hw:CARD=Gone,DEV=0", RestoreOutcome.UNAVAILABLE), ("S30/hw:CARD=Other,DEV=0", RestoreOutcome.APPLIED)],
    ids=["no longer offered", "offered, not running"],
)
async def test_a_net_device_converges_only_when_the_daemon_offers_it(
    apply_via: tuple[ConnectionManager, HttpConfigClient], device: str, outcome: RestoreOutcome
) -> None:
    """An endpoint missing from the daemon's bindable devices can never converge, so it reads unfixable rather than a
    false success; one on the list, though not the one running, is a real change that converges."""
    manager, _ = apply_via
    result = await restore.apply(manager, {"net_device": device}, restore_hooks(manager))
    assert result.outcome is outcome


async def test_a_net_device_the_daemon_no_longer_offers_names_it_unfixable(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    manager, _ = apply_via
    result = await restore.apply(manager, {"net_device": "GHOST/hw:CARD=Gone,DEV=0"}, restore_hooks(manager))
    assert isinstance(result, RestoreUnavailable)
    assert result.unfixable[presetconf.NET_DEVICE].want == "GHOST/hw:CARD=Gone,DEV=0"


async def test_loudness_edit_persists_to_the_loudness_plugin(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    # a staged loudness bass-frequency change must ride the restore/XML lane into
    # <plugin type="loudness"> low_frequency — proving the post_loudness_lowfreq ->
    # low_frequency mapping, not just that some field moved
    manager, http = apply_via
    await manager.applyops.apply({}, {"post_loudness_enabled": "1", "post_loudness_lowfreq": "120"})
    matrix = {f["name"]: f["value"] for f in (await http.get_matrix())["fields"]}
    assert matrix["post_loudness_lowfreq"] == 120
