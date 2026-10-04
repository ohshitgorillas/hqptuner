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
from apps import wait_for_api
from conftest import ManagerFactory, StartManager
from fastapi.testclient import TestClient
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.conf.httpforms import ConfigForm
from hqptuner.config import Config
from hqptuner.core import engineread
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine import devicecaps
from hqptuner.engine.devicecaps import DeviceCaps
from hqptuner.presets import fileconfig

#: The zero value of ``DeviceCaps | None``, so an assertion reads a field without a conjunction (docs/testing.md 2).
NO_CAPS = DeviceCaps(device="", pcm_rates=[], dsd_rates=[])

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


def form(**fields: str) -> ConfigForm:
    return {"fields": [{"name": name, "value": value} for name, value in fields.items()], "profiles": None}


def _device(caps: DeviceCaps | None) -> str | None:
    """The capability's device, or None where no capability is known."""
    return None if caps is None else caps.device


def _pcm_rates(caps: DeviceCaps | None) -> list[int] | None:
    """The capability's PCM rates, or None where no capability is known."""
    return None if caps is None else caps.pcm_rates


def _dsd_rates(caps: DeviceCaps | None) -> list[int] | None:
    """The capability's DSD rates, or None where no capability is known."""
    return None if caps is None else caps.dsd_rates


# --- parse_caps: reading one announcement out of log text -------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("\n".join(f"log line {i}" for i in range(1, 61)), None),
        (
            announcement("naa-office", "hw:CARD=sndrpihifiberry,DEV=0", PI),
            "naa-office/hw:CARD=sndrpihifiberry,DEV=0",
        ),
    ],
    ids=["no announcement", "one announcement"],
)
def test_parse_caps_is_none_with_no_announcement_and_names_the_device_with_one(text: str, expected: str | None) -> None:
    assert _device(devicecaps.parse_caps(text)) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (PREAMBLE + announcement("naa-office", "hw:CARD=X,DEV=0", []), None),
        (announcement("naa-office", "hw:CARD=X,DEV=0", PI), [44100, 192000]),
    ],
    ids=["no format lines", "format lines"],
)
def test_parse_caps_is_none_with_no_format_lines_and_reads_pcm_rates_with_some(
    text: str, expected: list[int] | None
) -> None:
    assert _pcm_rates(devicecaps.parse_caps(text)) == expected


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
    assert (caps or NO_CAPS).pcm_rates == [44100, 96000, 192000]


def test_dsd_rates_come_back_sorted_ascending_whatever_order_the_log_listed() -> None:
    caps = devicecaps.parse_caps(announcement("naa-office", "hw:CARD=X,DEV=0", UNTIDY))
    assert (caps or NO_CAPS).dsd_rates == [2822400, 3072000, 5644800]


def test_a_pcm_rate_announced_twice_appears_once() -> None:
    caps = devicecaps.parse_caps(announcement("naa-office", "hw:CARD=X,DEV=0", UNTIDY))
    assert (caps or NO_CAPS).pcm_rates.count(44100) == 1


def test_a_dsd_rate_announced_twice_appears_once() -> None:
    caps = devicecaps.parse_caps(announcement("naa-office", "hw:CARD=X,DEV=0", UNTIDY))
    assert (caps or NO_CAPS).dsd_rates.count(2822400) == 1


PCM_ONLY = [f"{rate}/24/2 [pcm]" for rate in (32000, 44100, 48000, 64000, 88200, 96000, 176400, 192000)]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (announcement("naa-pi2aes", "hw:CARD=Pi2AES,DEV=0", PCM_ONLY), []),
        (announcement("naa-office", "hw:CARD=X,DEV=0", PI), [2822400, 3072000]),
    ],
    ids=["no dsd path", "dsd announced"],
)
def test_dsd_rates_are_empty_with_no_dsd_path_and_populated_when_the_log_announces_dsd(
    text: str, expected: list[int]
) -> None:
    assert _dsd_rates(devicecaps.parse_caps(text)) == expected


def test_a_device_with_no_dsd_path_is_still_a_capability() -> None:
    caps = devicecaps.parse_caps(announcement("naa-pi2aes", "hw:CARD=Pi2AES,DEV=0", PCM_ONLY))
    assert (caps or NO_CAPS).device == "naa-pi2aes/hw:CARD=Pi2AES,DEV=0"


def test_only_the_most_recent_announcement_names_the_device() -> None:
    text = announcement("old", "hw:CARD=Old,DEV=0", PCM_ONLY) + announcement("new", "hw:CARD=New,DEV=0", PI)
    caps = devicecaps.parse_caps(text)
    assert (caps or NO_CAPS).device == "new/hw:CARD=New,DEV=0"


def test_an_earlier_devices_rates_are_not_merged_into_the_later_one() -> None:
    text = announcement("old", "hw:CARD=Old,DEV=0", PCM_ONLY) + announcement("new", "hw:CARD=New,DEV=0", PI)
    caps = devicecaps.parse_caps(text)
    # 32000 is the old device's alone; seeing it would mean the blocks were merged
    assert 32000 not in (caps or NO_CAPS).pcm_rates


def test_format_lines_before_any_announcement_are_ignored() -> None:
    stray = "2026/08/01 02:03:20 NAA output network format: 384000/32/2 [pcm]\n"
    caps = devicecaps.parse_caps(stray + announcement("naa-office", "hw:CARD=X,DEV=0", PI))
    assert 384000 not in (caps or NO_CAPS).pcm_rates


# --- selected_device: which device the menus should narrow to ---------------


@pytest.mark.parametrize(
    ("config_form", "expected"),
    [
        # combo drives an ALSA and a network device at once while the log announces
        # one: which device's limits bind is unknown, and unknown means no narrowing
        (form(backend="combo", net_device=SELECTED, alsa_device="hw:CARD=NVidia,DEV=3"), None),
        (form(backend="network", net_device=SELECTED, alsa_device="hw:CARD=NVidia,DEV=3"), SELECTED),
    ],
    ids=["combo", "network"],
)
def test_selected_device_is_none_for_combo_backend_and_the_net_device_for_network(
    config_form: ConfigForm, expected: str | None
) -> None:
    assert devicecaps.selected_device(config_form) == expected


@pytest.mark.parametrize(
    ("config_form", "expected"),
    [
        (None, None),
        (form(backend="alsa", net_device=SELECTED, alsa_device="hw:CARD=NVidia,DEV=3"), "hw:CARD=NVidia,DEV=3"),
    ],
    ids=["no form loaded", "alsa"],
)
def test_selected_device_is_none_with_no_form_loaded_and_the_alsa_device_for_alsa_backend(
    config_form: ConfigForm | None, expected: str | None
) -> None:
    assert devicecaps.selected_device(config_form) == expected


@pytest.mark.parametrize(
    ("config_form", "expected"),
    [
        (form(backend="network", net_device=""), None),
        (form(backend="network", net_device=SELECTED, alsa_device="hw:CARD=NVidia,DEV=3"), SELECTED),
    ],
    ids=["empty device field", "device field filled"],
)
def test_selected_device_is_none_with_an_empty_device_field_and_present_with_one_filled(
    config_form: ConfigForm, expected: str | None
) -> None:
    assert devicecaps.selected_device(config_form) == expected


# --- caps_for: matching the announcement against the selection --------------


@pytest.mark.parametrize(
    ("log", "expected"),
    [
        # staged device change: the daemon has not opened the new device yet, so the
        # log still describes the old one and must not narrow the new one
        (OTHER_LOG, None),
        (SELECTED_LOG, SELECTED),
    ],
    ids=["different device", "matching device"],
)
def test_caps_for_is_none_when_the_announcement_names_a_different_device_and_serves_it_when_it_matches(
    log: str, expected: str | None
) -> None:
    assert _device(devicecaps.caps_for(log, SELECTED)) == expected


@pytest.mark.parametrize(
    ("selected", "expected"), [(None, None), (SELECTED, SELECTED)], ids=["no device selected", "device selected"]
)
def test_caps_for_is_none_with_no_device_selected_and_serves_it_when_one_is(
    selected: str | None, expected: str | None
) -> None:
    assert _device(devicecaps.caps_for(SELECTED_LOG, selected)) == expected


# --- agreed_device: the two config views, compared --------------------------
# The /config form and the config file are read on different schedules, so a
# preset load leaves a window where they describe different devices. The file
# view arrives in the same form-field terms the form does (`backend`,
# `net_device`, `alsa_device`), which is what makes the two comparable.

ALSA = "hw:CARD=NVidia,DEV=3"
OTHER = "S30/hw:CARD=Other,DEV=0"
FORM = form(backend="network", net_device=SELECTED, alsa_device=ALSA)
FILE: dict[str, str] = {"backend": "network", "net_device": SELECTED, "alsa_device": ALSA}


@pytest.mark.parametrize(
    ("file_view", "expected"),
    [
        # the preset-load window: the file already carries the new preset's device
        # while the form still reports the previous one
        ({**FILE, "net_device": OTHER}, None),
        (FILE, SELECTED),
    ],
    ids=["views disagree", "views agree"],
)
def test_agreed_device_is_none_when_the_views_name_different_devices_and_agrees_when_they_match(
    file_view: dict[str, str], expected: str | None
) -> None:
    assert devicecaps.agreed_device(FORM, file_view) == expected


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
    ("form_backend", "file_backend", "expected"),
    [
        pytest.param("combo", "combo", None, id="both views say combo"),
        pytest.param("combo", "network", None, id="only the form says combo"),
        pytest.param("network", "combo", None, id="only the file says combo"),
        pytest.param("network", "network", SELECTED, id="both views name the network backend"),
    ],
)
def test_the_combo_backend_agrees_on_no_device_and_a_named_backend_agrees_on_it(
    form_backend: str, file_backend: str, expected: str | None
) -> None:
    # combo drives an ALSA and a network device at once while the daemon
    # announces one, so neither view can name the device whose limits bind
    parsed = form(backend=form_backend, net_device=SELECTED, alsa_device=ALSA)
    file_view = {**FILE, "backend": file_backend}
    assert devicecaps.agreed_device(parsed, file_view) == expected


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


@pytest.mark.parametrize(
    ("daemon", "overrides", "load", "expected"),
    [
        # the announcing daemon unread: loading is all that separates this from the loaded case
        pytest.param("announcing_daemon", {}, False, None, id="fresh"),
        pytest.param("http_daemon", {"_log": OTHER_LOG}, True, None, id="another device's log"),
        pytest.param("http_daemon", {}, True, None, id="no announcement"),
        # this daemon's config form has selected the device its log announces, so a
        # readable log narrows the menus — what stops it is the 8088 lane refusing
        # GET /log, which leaves nothing known about the device
        pytest.param("announcing_daemon", {"_fail_paths": ["/log"]}, True, None, id="log refused"),
        pytest.param("announcing_daemon", {}, True, [44100, 192000], id="loaded"),
    ],
)
async def test_a_manager_reports_the_capability_only_once_it_has_read_its_own_devices_announcement(
    request: pytest.FixtureRequest,
    http_manager_factory: ManagerFactory,
    daemon: str,
    overrides: dict[str, Any],
    *,
    load: bool,
    expected: list[int] | None,
) -> None:
    served: dict[str, Any] = request.getfixturevalue(daemon)
    served.update(overrides)
    manager = _manager(http_manager_factory, served)
    if load:
        await engineread.refresh_devices(manager)
    assert _pcm_rates(manager.readings.device_caps) == expected


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
    await fileconfig.load_file_config(manager)
    await engineread.refresh_devices(manager)
    return manager


@pytest.mark.parametrize(
    ("daemon", "expected"),
    [("disagreeing_daemon", None), ("announcing_daemon", [44100, 192000])],
    ids=["views disagree", "views agree"],
)
async def test_manager_serves_nothing_when_the_two_views_disagree_and_the_capability_when_they_agree(
    request: pytest.FixtureRequest, http_manager_factory: ManagerFactory, daemon: str, expected: list[int] | None
) -> None:
    # the log agrees with the form in the agreeing case, so the announcement
    # alone would narrow: what must stop it in the disagreeing case is the file
    # naming another generation's device
    manager = await _both_views(http_manager_factory, request.getfixturevalue(daemon))
    assert _pcm_rates(manager.readings.device_caps) == expected


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
    assert (manager.readings.device_caps or NO_CAPS).device == SELECTED


async def test_manager_serves_the_capability_when_the_archive_read_failed(
    start_manager: StartManager, backupless_daemon: dict[str, Any]
) -> None:
    # the connect path reads the settings archive and is refused, so no file view
    # exists to agree or disagree with: the form is the sole authority on the
    # selected device, exactly as before
    port = backupless_daemon["_port"]
    manager = await start_manager(port, hqp_http_port=port)
    await engineread.refresh_devices(manager)
    assert (manager.readings.device_caps or NO_CAPS).pcm_rates == [44100, 192000]


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
    with TestClient(create_app(cfg, VirtualClock())) as test_client:
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


def _served_pcm_rates(client: TestClient) -> object:
    """The PCM rates ``/api/config`` serves, or None where it carries a null capability."""
    caps = client.get("/api/config").json()["data"]["device_caps"]
    return None if caps is None else caps["pcm_rates"]


@pytest.mark.parametrize(
    ("client", "refresh", "expected"),
    [
        # the stock fake's log has no device announcement at all
        pytest.param("http_client", True, None, id="none known"),
        pytest.param("disagreeing_client", True, None, id="views disagree"),
        pytest.param("announcing_client", False, [44100, 192000], id="known and views agree"),
    ],
)
def test_api_config_carries_the_real_capability_only_when_it_is_known_and_the_two_views_agree(
    request: pytest.FixtureRequest, client: str, *, refresh: bool, expected: list[int] | None
) -> None:
    served: TestClient = request.getfixturevalue(client)
    if refresh:
        served.post("/api/config/refresh")
    assert _served_pcm_rates(served) == expected
