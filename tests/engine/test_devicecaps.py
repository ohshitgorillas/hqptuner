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
from conftest import ManagerFactory, StartManager, wait_for_api
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.core import engineread
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


# --- agreed_device: the two config views, compared --------------------------
# The /config form and the config file are read on different schedules, so a
# preset load leaves a window where they describe different devices. The file
# view arrives in the same form-field terms the form does (`backend`,
# `net_device`, `alsa_device`), which is what makes the two comparable.

ALSA = "hw:CARD=NVidia,DEV=3"
OTHER = "S30/hw:CARD=Other,DEV=0"
FORM = form(backend="network", net_device=SELECTED, alsa_device=ALSA)
FILE: dict[str, str] = {"backend": "network", "net_device": SELECTED, "alsa_device": ALSA}


def test_both_views_naming_one_device_agree_on_it() -> None:
    assert devicecaps.agreed_device(FORM, FILE) == SELECTED


def test_views_naming_different_devices_agree_on_nothing() -> None:
    # the preset-load window: the file already carries the new preset's device
    # while the form still reports the previous one
    assert devicecaps.agreed_device(FORM, {**FILE, "net_device": OTHER}) is None


def test_no_file_view_leaves_the_form_the_sole_authority() -> None:
    # unauthenticated, or the archive read failed: nothing to disagree with
    assert devicecaps.agreed_device(FORM, None) == SELECTED


@pytest.mark.parametrize(
    "file_view",
    [
        pytest.param({}, id="file view carries no fields at all"),
        pytest.param({"backend": "network"}, id="file view names the backend but no device"),
    ],
)
def test_a_file_view_silent_about_the_device_falls_back_to_the_form(file_view: dict[str, str]) -> None:
    # silence is not disagreement: absence of evidence narrows nothing, and it
    # takes away nothing the form already established either
    assert devicecaps.agreed_device(FORM, file_view) == SELECTED


@pytest.mark.parametrize(
    ("form_backend", "file_backend"),
    [
        pytest.param("combo", "combo", id="both views say combo"),
        pytest.param("combo", "network", id="only the form says combo"),
        pytest.param("network", "combo", id="only the file says combo"),
    ],
)
def test_the_combo_backend_agrees_on_no_device(form_backend: str, file_backend: str) -> None:
    # combo drives an ALSA and a network device at once while the daemon
    # announces one, so neither view can name the device whose limits bind
    parsed = form(backend=form_backend, net_device=SELECTED, alsa_device=ALSA)
    file_view = {**FILE, "backend": file_backend}
    assert devicecaps.agreed_device(parsed, file_view) is None


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
    for it to be LEARNED separately: a manager that only learns caps when told
    to fails here. The re-read tests do call the refresh again by hand, on a
    manager already holding the capability — a different question, whether a
    second read of the log is paid for at all."""
    manager = _manager(factory, daemon)
    await engineread.refresh_devices(manager)
    return manager


def test_a_fresh_manager_reports_no_device_capability(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any]
) -> None:
    assert _manager(http_manager_factory, http_daemon).readings.device_caps is None


async def test_manager_reports_the_capability_of_the_announced_selected_device(
    http_manager_factory: ManagerFactory, announcing_daemon: dict[str, Any]
) -> None:
    manager = await _loaded(http_manager_factory, announcing_daemon)
    assert (manager.readings.device_caps or {})["pcm_rates"] == [44100, 192000]


async def test_manager_reports_nothing_when_the_log_announces_another_device(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any]
) -> None:
    http_daemon["_log"] = OTHER_LOG
    manager = await _loaded(http_manager_factory, http_daemon)
    assert manager.readings.device_caps is None


async def test_manager_reports_nothing_when_the_log_carries_no_announcement(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any]
) -> None:
    manager = await _loaded(http_manager_factory, http_daemon)
    assert manager.readings.device_caps is None


async def test_a_log_that_cannot_be_fetched_stores_no_capability(
    http_manager_factory: ManagerFactory, announcing_daemon: dict[str, Any]
) -> None:
    # this daemon's config form has selected the device its log announces, so a
    # readable log narrows the menus here (the announced-device case above) —
    # what must stop it is the 8088 lane refusing GET /log, which leaves nothing
    # known about the device
    announcing_daemon["_fail_paths"] = ["/log"]
    manager = await _loaded(http_manager_factory, announcing_daemon)
    assert manager.readings.device_caps is None


# --- what a refresh costs: the log is re-read only when there is something to
# learn, because reading it costs a whole GET /log ---------------------------


async def test_a_refresh_reads_no_log_while_the_held_capability_still_stands(
    http_manager_factory: ManagerFactory, announcing_daemon: dict[str, Any]
) -> None:
    # the capability is held and the selected device has not moved, so a second
    # read could only announce the same device again
    manager = await _loaded(http_manager_factory, announcing_daemon)
    already_read = announcing_daemon["_log_reads"]
    await engineread.refresh_device_caps(manager)
    assert announcing_daemon["_log_reads"] == already_read


async def test_a_forced_refresh_reads_the_log_again(
    http_manager_factory: ManagerFactory, announcing_daemon: dict[str, Any]
) -> None:
    # what a fresh connection does: the held capability describes whatever the
    # daemon had open before, so the log is read again on its own account
    manager = await _loaded(http_manager_factory, announcing_daemon)
    already_read = announcing_daemon["_log_reads"]
    await engineread.refresh_device_caps(manager, force=True)
    assert announcing_daemon["_log_reads"] == already_read + 1


# --- the manager, with both config views in hand ----------------------------


@pytest.fixture
def disagreeing_daemon() -> Iterator[dict[str, Any]]:
    """The daemon mid preset-load: the config file already carries the new
    preset's device, while GET /config still renders the previous one — which is
    the device the engine still has open, and the one its log announces."""
    yield from fake_http.spawn(fake_http.state(_log=OTHER_LOG, _form_net_device=OTHER))


@pytest.fixture
def backupless_daemon() -> Iterator[dict[str, Any]]:
    """A daemon announcing its selected device whose settings archive cannot be
    read — a failed archive read, so no file view exists.

    Its config FILE names another device than its form and log do, so a readable
    archive here would put the two views a generation apart and withhold the
    capability: the refusal is what the case turns on, not an unfetched view."""
    yield from fake_http.spawn(
        fake_http.state(
            _log=SELECTED_LOG,
            net_device=OTHER,
            _form_net_device=SELECTED,
            _fail_paths=["/backup/settings.zip"],
        )
    )


async def _both_views(factory: ManagerFactory, daemon: dict[str, Any]) -> ConnectionManager:
    """A manager holding both config views: the file read and the forms loaded,
    which is the state every ordinary poll leaves it in."""
    manager = _manager(factory, daemon)
    await manager.load_file_config()
    await engineread.refresh_devices(manager)
    return manager


async def test_manager_serves_the_capability_when_both_views_name_the_announced_device(
    http_manager_factory: ManagerFactory, announcing_daemon: dict[str, Any]
) -> None:
    manager = await _both_views(http_manager_factory, announcing_daemon)
    assert (manager.readings.device_caps or {})["pcm_rates"] == [44100, 192000]


async def test_manager_serves_nothing_while_the_two_views_name_different_devices(
    http_manager_factory: ManagerFactory, disagreeing_daemon: dict[str, Any]
) -> None:
    # the log agrees with the form here, so the announcement alone would narrow:
    # what must stop it is the file naming another generation's device
    manager = await _both_views(http_manager_factory, disagreeing_daemon)
    assert manager.readings.device_caps is None


async def test_the_capability_comes_back_at_the_next_refresh_once_the_views_agree(
    http_manager_factory: ManagerFactory, disagreeing_daemon: dict[str, Any]
) -> None:
    manager = await _both_views(http_manager_factory, disagreeing_daemon)
    # the daemon opens the preset's device and the form catches up
    disagreeing_daemon["_form_net_device"] = None
    disagreeing_daemon["_log"] = SELECTED_LOG
    # one ordinary refresh, unforced and with no virtual time passed: a retry
    # interval charged for the disagreement would still be closed here
    await engineread.refresh_devices(manager)
    assert (manager.readings.device_caps or {})["device"] == SELECTED


async def test_manager_serves_the_capability_when_the_archive_read_failed(
    start_manager: StartManager, backupless_daemon: dict[str, Any]
) -> None:
    # the connect path reads the settings archive and is refused, so no file view
    # exists to agree or disagree with: the form is the sole authority on the
    # selected device, exactly as before
    port = backupless_daemon["_port"]
    manager = await start_manager(port, hqp_http_port=port)
    await engineread.refresh_devices(manager)
    assert (manager.readings.device_caps or {})["pcm_rates"] == [44100, 192000]


# --- the REST surface -------------------------------------------------------


def _config_loaded(client: TestClient) -> bool:
    """The connect-and-load sequence has finished: the form is served and the
    file view is grounded (same readiness gate as the `wired_api` suite)."""
    resp = client.get("/api/config")
    return resp.status_code == 200 and "title" in resp.json()["data"]["file"]


def _wired_client(daemon: dict[str, Any], control_port: int, tmp_path: Path) -> Iterator[TestClient]:
    """The app with both lanes live against the given 8088 fake, ready once its
    connect-and-load sequence has finished."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=control_port,
        hqp_http_port=daemon["_port"],
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


@pytest.fixture
def announcing_client(
    announcing_daemon: dict[str, Any], threaded_daemon_port: int, tmp_path: Path
) -> Iterator[TestClient]:
    """Both lanes live, with the 8088 daemon announcing the device its own config
    form has selected — the ordinary connected app."""
    yield from _wired_client(announcing_daemon, threaded_daemon_port, tmp_path)


@pytest.fixture
def disagreeing_client(
    disagreeing_daemon: dict[str, Any], threaded_daemon_port: int, tmp_path: Path
) -> Iterator[TestClient]:
    """The connected app mid preset-load, its two config views a generation
    apart."""
    yield from _wired_client(disagreeing_daemon, threaded_daemon_port, tmp_path)


def test_api_config_carries_the_selected_devices_capability(announcing_client: TestClient) -> None:
    body = announcing_client.get("/api/config").json()
    assert (body["data"]["device_caps"] or {})["pcm_rates"] == [44100, 192000]


def test_api_config_carries_a_null_capability_when_none_is_known(http_client: TestClient) -> None:
    # the stock fake's log has no device announcement at all
    http_client.post("/api/config/refresh")
    assert http_client.get("/api/config").json()["data"]["device_caps"] is None


def test_api_config_carries_a_null_capability_while_the_two_views_disagree(
    disagreeing_client: TestClient,
) -> None:
    disagreeing_client.post("/api/config/refresh")
    assert disagreeing_client.get("/api/config").json()["data"]["device_caps"] is None
