"""Behavior of output-device capability: parsing the daemon's device-open
announcement out of its log, deciding which device the menus should narrow to,
matching announcement against selection, and the manager/REST surfaces over it.

The governing rule everywhere below is that absence of evidence narrows nothing:
every case the log cannot speak for resolves to None, never to a guess. The log
text used here is the shape the running daemon writes (spec block, captured
2026-08-01); the fake 8088 daemon serves it verbatim on GET /log, which is the
lane HQPTuner reads (docs/testing.md — fakes speak the wire)."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import fake_http
import pytest
from conftest import ManagerFactory, wait_for_api
from fastapi.testclient import TestClient

from hqptuner.api import create_app
from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine import devicecaps

PREAMBLE = "2026/08/01 02:03:30 Engine started\n2026/08/01 02:03:31 Opening output device\n"


def announcement(endpoint: str, device: str, formats: list[str]) -> str:
    """One device-open block as hqplayerd writes it: the endpoint/device line
    then one format line per accepted format."""
    head = f"2026/08/01 02:03:37 NAA output endpoint '{endpoint}' : '{device}'\n"
    body = "".join(f"2026/08/01 02:03:38 NAA output network format: {f}\n" for f in formats)
    return head + body


PI = ["44100/32/2 [pcm]", "192000/32/2 [pcm]", "2822400/1/2 [dsd]", "3072000/1/2 [dsd]"]
#: The endpoint/device the fake 8088 daemon's config form has selected.
SELECTED = "S26/hw:CARD=Output,DEV=0"
SELECTED_LOG = PREAMBLE + announcement("S26", "hw:CARD=Output,DEV=0", PI)
OTHER_LOG = PREAMBLE + announcement("S30", "hw:CARD=Other,DEV=0", PI)


def form(**fields: Any) -> dict[str, Any]:
    return {"fields": [{"name": name, "value": value} for name, value in fields.items()]}


# --- parse_caps: reading one announcement out of log text -------------------


def test_device_identity_is_endpoint_and_device_joined_by_slash() -> None:
    caps = devicecaps.parse_caps(announcement("naa-office", "hw:CARD=sndrpihifiberry,DEV=0", PI))
    assert (caps or {})["device"] == "naa-office/hw:CARD=sndrpihifiberry,DEV=0"


def test_pcm_marked_formats_become_integer_pcm_rates() -> None:
    caps = devicecaps.parse_caps(announcement("naa-office", "hw:CARD=X,DEV=0", PI))
    assert (caps or {})["pcm_rates"] == [44100, 192000]


def test_dsd_marked_formats_become_integer_dsd_rates() -> None:
    caps = devicecaps.parse_caps(announcement("naa-office", "hw:CARD=X,DEV=0", PI))
    assert (caps or {})["dsd_rates"] == [2822400, 3072000]


#: One announcement whose PCM lines and DSD lines are BOTH out of order and both
#: carry the same rate twice (at different bit depths, as the daemon does when a
#: device accepts one rate in two widths). Sorting and de-duplication are claimed
#: for both lists, so both lists are read out of the same untidy block.
UNTIDY = [
    "192000/32/2 [pcm]",
    "44100/32/2 [pcm]",
    "44100/24/2 [pcm]",
    "96000/32/2 [pcm]",
    "5644800/1/2 [dsd]",
    "2822400/1/2 [dsd]",
    "2822400/8/2 [dsd]",
    "3072000/1/2 [dsd]",
]


def test_pcm_rates_come_back_sorted_ascending_whatever_order_the_log_listed() -> None:
    caps = devicecaps.parse_caps(announcement("naa-office", "hw:CARD=X,DEV=0", UNTIDY))
    assert (caps or {})["pcm_rates"] == [44100, 96000, 192000]


def test_dsd_rates_come_back_sorted_ascending_whatever_order_the_log_listed() -> None:
    caps = devicecaps.parse_caps(announcement("naa-office", "hw:CARD=X,DEV=0", UNTIDY))
    assert (caps or {})["dsd_rates"] == [2822400, 3072000, 5644800]


def test_a_pcm_rate_announced_twice_appears_once() -> None:
    caps = devicecaps.parse_caps(announcement("naa-office", "hw:CARD=X,DEV=0", UNTIDY))
    assert (caps or {})["pcm_rates"].count(44100) == 1


def test_a_dsd_rate_announced_twice_appears_once() -> None:
    caps = devicecaps.parse_caps(announcement("naa-office", "hw:CARD=X,DEV=0", UNTIDY))
    assert (caps or {})["dsd_rates"].count(2822400) == 1


PCM_ONLY = [f"{rate}/24/2 [pcm]" for rate in (32000, 44100, 48000, 64000, 88200, 96000, 176400, 192000)]


def test_a_device_with_no_dsd_path_reports_an_empty_dsd_list() -> None:
    caps = devicecaps.parse_caps(announcement("naa-pi2aes", "hw:CARD=Pi2AES,DEV=0", PCM_ONLY))
    assert (caps or {})["dsd_rates"] == []


def test_a_device_with_no_dsd_path_is_still_a_capability() -> None:
    assert devicecaps.parse_caps(announcement("naa-pi2aes", "hw:CARD=Pi2AES,DEV=0", PCM_ONLY)) is not None


def test_log_without_any_announcement_yields_nothing() -> None:
    assert devicecaps.parse_caps("\n".join(f"log line {i}" for i in range(1, 61))) is None


def test_an_announcement_with_no_format_lines_yields_nothing() -> None:
    assert devicecaps.parse_caps(PREAMBLE + announcement("naa-office", "hw:CARD=X,DEV=0", [])) is None


def test_only_the_most_recent_announcement_names_the_device() -> None:
    text = announcement("old", "hw:CARD=Old,DEV=0", PCM_ONLY) + announcement("new", "hw:CARD=New,DEV=0", PI)
    caps = devicecaps.parse_caps(text)
    assert (caps or {})["device"] == "new/hw:CARD=New,DEV=0"


def test_an_earlier_devices_rates_are_not_merged_into_the_later_one() -> None:
    text = announcement("old", "hw:CARD=Old,DEV=0", PCM_ONLY) + announcement("new", "hw:CARD=New,DEV=0", PI)
    caps = devicecaps.parse_caps(text)
    # 32000 is the old device's alone; seeing it would mean the blocks were merged
    assert 32000 not in (caps or {})["pcm_rates"]


def test_format_lines_before_any_announcement_are_ignored() -> None:
    stray = "2026/08/01 02:03:20 NAA output network format: 384000/32/2 [pcm]\n"
    caps = devicecaps.parse_caps(stray + announcement("naa-office", "hw:CARD=X,DEV=0", PI))
    assert 384000 not in (caps or {})["pcm_rates"]


# --- selected_device: which device the menus should narrow to ---------------


def test_network_backend_narrows_to_the_net_device() -> None:
    parsed = form(backend="network", net_device=SELECTED, alsa_device="hw:CARD=NVidia,DEV=3")
    assert devicecaps.selected_device(parsed) == SELECTED


def test_alsa_backend_narrows_to_the_alsa_device() -> None:
    parsed = form(backend="alsa", net_device=SELECTED, alsa_device="hw:CARD=NVidia,DEV=3")
    assert devicecaps.selected_device(parsed) == "hw:CARD=NVidia,DEV=3"


def test_combo_backend_narrows_nothing() -> None:
    # combo drives an ALSA and a network device at once while the log announces
    # one: which device's limits bind is unknown, and unknown means no narrowing
    parsed = form(backend="combo", net_device=SELECTED, alsa_device="hw:CARD=NVidia,DEV=3")
    assert devicecaps.selected_device(parsed) is None


def test_no_form_loaded_yet_narrows_nothing() -> None:
    assert devicecaps.selected_device(None) is None


def test_an_empty_device_field_narrows_nothing() -> None:
    assert devicecaps.selected_device(form(backend="network", net_device="")) is None


# --- caps_for: matching the announcement against the selection --------------


def test_capability_comes_back_when_the_announcement_names_the_selected_device() -> None:
    assert (devicecaps.caps_for(SELECTED_LOG, SELECTED) or {})["device"] == SELECTED


def test_capability_is_nothing_when_the_announcement_names_a_different_device() -> None:
    # staged device change: the daemon has not opened the new device yet, so the
    # log still describes the old one and must not narrow the new one
    assert devicecaps.caps_for(OTHER_LOG, SELECTED) is None


def test_capability_is_nothing_when_no_device_is_selected() -> None:
    assert devicecaps.caps_for(SELECTED_LOG, None) is None


# --- the connection manager -------------------------------------------------


@pytest.fixture
def announcing_daemon() -> Iterator[dict[str, Any]]:
    """The fake 8088 daemon whose log announces the device its config form has
    selected — the ordinary case, a daemon playing out of the picked device."""
    yield from fake_http.spawn(fake_http.state(_log=SELECTED_LOG))


def _manager(factory: ManagerFactory, daemon: dict[str, Any]) -> ConnectionManager:
    return factory(daemon, hqp_host="127.0.0.1", hqp_http_port=daemon["_port"])


async def _loaded(factory: ManagerFactory, daemon: dict[str, Any]) -> ConnectionManager:
    """A manager that has loaded the daemon's config forms — and nothing else.
    Learning the device capability is part of that load, so no test below asks
    for it separately: a manager that only learns caps when told to fails here."""
    manager = _manager(factory, daemon)
    await manager.refresh_devices()
    return manager


def test_a_fresh_manager_reports_no_device_capability(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any]
) -> None:
    assert _manager(http_manager_factory, http_daemon).device_caps is None


async def test_manager_reports_the_capability_of_the_announced_selected_device(
    http_manager_factory: ManagerFactory, announcing_daemon: dict[str, Any]
) -> None:
    manager = await _loaded(http_manager_factory, announcing_daemon)
    assert (manager.device_caps or {})["pcm_rates"] == [44100, 192000]


async def test_manager_reports_nothing_when_the_log_announces_another_device(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any]
) -> None:
    http_daemon["_log"] = OTHER_LOG
    manager = await _loaded(http_manager_factory, http_daemon)
    assert manager.device_caps is None


async def test_manager_reports_nothing_when_the_log_carries_no_announcement(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any]
) -> None:
    manager = await _loaded(http_manager_factory, http_daemon)
    assert manager.device_caps is None


# --- the REST surface -------------------------------------------------------


def _config_loaded(client: TestClient) -> bool:
    """The connect-and-load sequence has finished: the form is served and the
    file view is grounded (same readiness gate as the `wired_api` suite)."""
    resp = client.get("/api/config")
    return resp.status_code == 200 and "title" in resp.json()["data"]["file"]


@pytest.fixture
def announcing_client(
    announcing_daemon: dict[str, Any], threaded_daemon_port: int, tmp_path: Path
) -> Iterator[TestClient]:
    """Both lanes live, with the 8088 daemon announcing the device its own config
    form has selected — the ordinary connected app."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=threaded_daemon_port,
        hqp_http_port=announcing_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
    )
    with TestClient(create_app(cfg)) as test_client:
        wait_for_api(test_client, _config_loaded)
        yield test_client


def test_api_config_carries_the_selected_devices_capability(announcing_client: TestClient) -> None:
    body = announcing_client.get("/api/config").json()
    assert (body["data"]["device_caps"] or {})["pcm_rates"] == [44100, 192000]


def test_api_config_carries_a_null_capability_when_none_is_known(http_client: TestClient) -> None:
    # the stock fake's log has no device announcement at all
    http_client.post("/api/config/refresh")
    assert http_client.get("/api/config").json()["data"]["device_caps"] is None
