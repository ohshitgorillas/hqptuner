"""Live-routed staged batches over REST, end to end through both fake daemons.

A staged batch of nothing but live-capable /config fields rides the Control API
alone: the matching setter goes out (`SetShaping` for dither, list-index
domain), no restore is posted, and the report's ``persistent`` lane is null.
The moment a restart-required field shares the batch, the live routing
stands down entirely: no setter is sent, one restore carries every staged value
into the daemon's config file, and the file view serves them back. Live truth a
pure-live apply created survives the file's staleness: a live mode round trip
(PCM -> SDM -> PCM) ends with the engine back on the applied shaper index.

An Apply & save rides those same restarts: a live-only batch saves without
one, a restarting batch restarts once and brings the station up in
hqplayerd's own profile list, and a station saved without a restart reaches
that list at the next one. A save that fails leaves no station in that list,
and a station name the name rule refuses stops the apply before anything
reaches the engine.

The control fake starts with the PCM chain loaded (mode="1"); the 8088 fake's
config file is pinned to agree (mode "pcm", dither enum "0"). On the fake's PCM
shaper list enum ID "5" (NS9) sits at list index "1", so a correctly translated
`SetShaping` carries value="1" and `State` reads shaper="1" back.
"""

import io
import os
import zipfile
from collections.abc import Iterator
from contextlib import contextmanager, nullcontext
from pathlib import Path
from typing import Any

import fake_http
import pytest
from apps import wait_for_api
from conftest import spawn_threaded_daemon
from fake_config_xml import elem_attr
from fake_control import DEFAULTS, CommandLog, restart_into
from fastapi.testclient import TestClient
from narrow import FixtureError
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.config import Config


@pytest.fixture
def control_log() -> CommandLog:
    """The control fake's side of the wire: every command it was asked."""
    return []


@pytest.fixture
def control_state() -> dict[str, str]:
    """The control fake's live State, shared across its connections — the
    handle a restore's self-restart moves (see ``pcm_file_daemon``). The
    ``_cfg_*`` knobs mirror the 8088 fake's config file (dither enum "0",
    modulator enum "0"), so a ``SetMode`` loads the entered chain on the FILE's
    shaper rather than carrying the previous chain's pin across — which is what
    makes a skipped re-pin after a mode round trip readable on ``State``."""
    return {**DEFAULTS, "_cfg_dither": "0", "_cfg_modulator": "0"}


@pytest.fixture
def control_port(control_log: CommandLog, control_state: dict[str, str]) -> Iterator[int]:
    yield from spawn_threaded_daemon(state=control_state, log=control_log)


@pytest.fixture
def pcm_file_daemon(control_state: dict[str, str]) -> Iterator[dict[str, Any]]:
    """The 8088 fake with a config file that agrees with the loaded PCM chain:
    dither enum "0" so a staged "5" is a real change, and a modulator the fake's
    SDM shaper list actually offers (enum "0" = ASDM5).

    An adopted restore self-restarts the daemon, after which the Control API's
    State reflects the restored config file — so the ``_on_restore`` hook moves
    the control fake's State to the config the 8088 fake just adopted, the way
    one real daemon would."""
    server = fake_http.spawn(fake_http.state(mode="pcm", dither="0", modulator="0"))
    daemon = next(server)
    daemon["_on_restore"] = lambda: restart_into(control_state, daemon["mode"], daemon["dither"], daemon["modulator"])
    yield daemon
    next(server, None)


def _config_loaded(client: TestClient) -> bool:
    """Connect-and-load finished: the /config file view is grounded."""
    resp = client.get("/api/config")
    return resp.status_code == 200 and "title" in resp.json()["data"]["file"]


@pytest.fixture
def client(control_port: int, pcm_file_daemon: dict[str, Any], tmp_path: Path) -> Iterator[TestClient]:
    """Both lanes live: control on the threaded fake, config on the fake 8088."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=control_port,
        hqp_http_port=pcm_file_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
    )
    with TestClient(create_app(cfg, VirtualClock())) as test_client:
        wait_for_api(test_client, _config_loaded)
        yield test_client


def _sent(log: CommandLog, name: str) -> list[dict[str, str]]:
    return [attrs for command, attrs in log if command == name]


def _apply_staged(client: TestClient, fields: dict[str, str]) -> dict[str, Any]:
    client.post("/api/config/stage", json={"http": fields})
    report: dict[str, Any] = client.post("/api/config/apply").json()["report"]
    return report


# --- a batch of nothing but live-capable fields rides the Control API --------


def _sent_during_apply(client: TestClient, log: CommandLog, fields: dict[str, str], command: str) -> list[str | None]:
    """The ``value`` of every ``command`` the apply of ``fields`` put on the wire."""
    before = len(log)
    _apply_staged(client, fields)
    return [attrs.get("value") for attrs in _sent(log[before:], command)]


#: How a report's persistent lane reads: absent, applied, or present and not applied.
NO_LANE, APPLIED, NOT_APPLIED = "no lane", "applied", "not applied"


def _persistent_lane(report: dict[str, Any]) -> str:
    """Which of ``NO_LANE``, ``APPLIED`` or ``NOT_APPLIED`` the report's persistent lane reads as."""
    persistent = report["persistent"]
    if persistent is None:
        return NO_LANE
    return APPLIED if persistent.get("applied") is True else NOT_APPLIED


@pytest.mark.parametrize(
    ("fields", "expected"),
    [({"dither": "5"}, NO_LANE), ({"dither": "5", "title": "Renamed"}, APPLIED)],
    ids=["pure_live", "beside_restart"],
)
def test_a_pure_live_dither_apply_reports_no_persistent_lane_but_a_restart_field_gets_one_applied(
    client: TestClient, fields: dict[str, str], expected: str
) -> None:
    assert _persistent_lane(_apply_staged(client, fields)) == expected


def test_a_pure_live_dither_apply_never_restarts_the_daemon(
    client: TestClient, pcm_file_daemon: dict[str, Any]
) -> None:
    # asserted at the wire: POST /restore self-restarts the daemon, so the fake's
    # arrival count is what says no restart happened
    before = pcm_file_daemon["_restore_attempts"]
    _apply_staged(client, {"dither": "5"})
    assert pcm_file_daemon["_restore_attempts"] == before


# --- one restart-required field defers the whole batch to the restore --------


@pytest.mark.parametrize(
    ("fields", "expected"),
    [({"dither": "5"}, ["1"]), ({"dither": "5", "title": "Renamed"}, [])],
    ids=["alone", "beside_restart"],
)
def test_a_dither_beside_a_restart_field_sends_no_setshaping_but_alone_it_does(
    client: TestClient, control_log: CommandLog, fields: dict[str, str], expected: list[str]
) -> None:
    # enum ID "5" is NS9 at PCM list index "1": the setter speaks indices, the
    # file speaks enum IDs — so applied alone exactly one SetShaping goes out and
    # it carries the index, never the ID; sharing the batch with a restart field
    # defers it entirely.
    assert _sent_during_apply(client, control_log, fields, "SetShaping") == expected


def test_a_dither_beside_a_restart_field_lands_exactly_one_restore(
    client: TestClient, pcm_file_daemon: dict[str, Any]
) -> None:
    before = pcm_file_daemon["_restore_attempts"]
    _apply_staged(client, {"dither": "5", "title": "Renamed"})
    assert pcm_file_daemon["_restore_attempts"] == before + 1


def test_the_shared_restore_carries_the_new_dither_in_the_config_file(
    client: TestClient, pcm_file_daemon: dict[str, Any]
) -> None:
    _apply_staged(client, {"dither": "5", "title": "Renamed"})
    assert pcm_file_daemon["dither"] == "5"


def test_the_shared_restore_carries_the_restart_field_too(client: TestClient, pcm_file_daemon: dict[str, Any]) -> None:
    _apply_staged(client, {"dither": "5", "title": "Renamed"})
    assert pcm_file_daemon["title"] == "Renamed"


def test_the_config_file_view_reports_the_restored_dither(client: TestClient) -> None:
    # the restore self-restarted the daemon, whose State now reports the
    # restored file (shaper index "1" = enum "5" on the PCM list); once the
    # manager's poll has caught up with the restarted engine, the file view's
    # live overlay must agree with the file instead of shadowing it
    _apply_staged(client, {"dither": "5", "title": "Renamed"})
    wait_for_api(client, lambda c: c.get("/api/state").json()["data"]["shaper"] == "1")
    assert client.get("/api/config").json()["data"]["file"]["dither"] == "5"


# --- the mode defers the same way ---------------------------------------------


@pytest.mark.parametrize(
    ("fields", "expected"),
    [({"mode": "sdm"}, ["2"]), ({"mode": "sdm", "title": "Renamed"}, [])],
    ids=["alone", "beside_restart"],
)
def test_a_mode_beside_a_restart_field_sends_no_setmode_but_alone_it_does(
    client: TestClient, control_log: CommandLog, fields: dict[str, str], expected: list[str]
) -> None:
    assert _sent_during_apply(client, control_log, fields, "SetMode") == expected


def test_the_shared_restore_carries_the_new_mode(client: TestClient, pcm_file_daemon: dict[str, Any]) -> None:
    _apply_staged(client, {"mode": "sdm", "title": "Renamed"})
    assert pcm_file_daemon["mode"] == "sdm"


# --- live truth outlives the stale config file --------------------------------


def test_a_live_mode_round_trip_ends_on_the_applied_shaper_index(client: TestClient) -> None:
    # SetMode swaps the shaper enumeration wholesale, so
    # coming back to PCM must land the engine on the dither the user applied —
    # index "1" is where enum "5" sits on the fake's PCM list
    _apply_staged(client, {"dither": "5"})
    client.post("/api/config/live", json={"fields": {"mode": "sdm"}})
    # prove the switch LANDED before coming back: a live route that no-ops
    # would leave the engine in PCM and the round trip would never happen
    wait_for_api(client, lambda c: c.get("/api/state").json()["data"]["mode"] == "2")
    client.post("/api/config/live", json={"fields": {"mode": "pcm"}})
    assert client.get("/api/state").json()["data"]["shaper"] == "1"


# --- Apply & save rides the restarts the apply makes anyway --------------------

#: The station an Apply & save names; the save makes it the active one.
STATION = "Studio"
#: Batches as ``_apply_staged`` stages them: one that rides the Control API
#: alone, and one that restarts the daemon.
LIVE_ONLY = {"dither": "5"}
RESTARTING = {"title": "Renamed"}
#: The title the 8088 fake's config file carries before any edit.
SAVED_TITLE = fake_http.state()["title"]
#: More POST /restore arrivals than any save makes: the daemon is still
#: restarting, and refusing restores, for as long as the save lasts.
STILL_RESTARTING = 10_000


def _apply_and_save(client: TestClient, fields: dict[str, str], name: str) -> dict[str, Any]:
    """Stage ``fields`` and apply them with a save target, the drawer's "Apply & save"; answer the apply."""
    client.post("/api/config/stage", json={"http": fields})
    answer: dict[str, Any] = client.post("/api/config/apply", json={"save": {"name": name}}).json()
    return answer


def _record_restarts(daemon: dict[str, Any]) -> list[bytes]:
    """Every archive the 8088 fake adopts from here on, in order: one per
    restart. The hook ``pcm_file_daemon`` hangs still runs after each."""
    adopted: list[bytes] = []
    restarted = daemon["_on_restore"]

    def record() -> None:
        adopted.append(daemon["_restore_bytes"])
        restarted()

    daemon["_on_restore"] = record
    return adopted


def _listed_title(restarts: list[bytes], name: str) -> str | None:
    """The title of hqplayerd's own copy of ``name`` once ``restarts`` have
    landed, or None while its profile list lacks it. A restore writes its
    ``data/cfgs`` members additively (protocol.md, POST /restore), so the
    latest archive carrying the member is the copy listed."""
    member = f"data/cfgs/{name}.xml"
    title = None
    for archive in restarts:
        restored = zipfile.ZipFile(io.BytesIO(archive))
        if member in restored.namelist():
            title = elem_attr(restored.read(member), "title", "value")
    return title


def test_an_apply_and_save_of_a_live_only_change_never_restarts_the_daemon(
    client: TestClient, pcm_file_daemon: dict[str, Any]
) -> None:
    before = pcm_file_daemon["_restore_attempts"]
    _apply_and_save(client, LIVE_ONLY, STATION)
    assert pcm_file_daemon["_restore_attempts"] == before


def test_an_apply_and_save_of_a_restarting_change_restarts_the_daemon_once(
    client: TestClient, pcm_file_daemon: dict[str, Any]
) -> None:
    before = pcm_file_daemon["_restore_attempts"]
    _apply_and_save(client, RESTARTING, STATION)
    assert pcm_file_daemon["_restore_attempts"] == before + 1


def test_the_restart_an_apply_and_save_makes_lists_the_station_as_saved(
    client: TestClient, pcm_file_daemon: dict[str, Any]
) -> None:
    # the station holds the applied edit, so hqplayerd's copy of it must too,
    # as of the one restart the apply makes
    restarts = _record_restarts(pcm_file_daemon)
    _apply_and_save(client, RESTARTING, STATION)
    assert _listed_title(restarts[:1], STATION) == RESTARTING["title"]


def test_hqplayerds_profile_list_catches_up_with_a_saved_station_at_the_next_restart(
    client: TestClient, pcm_file_daemon: dict[str, Any]
) -> None:
    # saved while the daemon refuses every restore, so only the next restart
    # can bring the station up in its profile list, as it was saved
    restarts = _record_restarts(pcm_file_daemon)
    pcm_file_daemon["_restore_refusals"] = STILL_RESTARTING
    _apply_and_save(client, LIVE_ONLY, STATION)
    pcm_file_daemon["_restore_refusals"] = 0
    _apply_staged(client, RESTARTING)
    assert _listed_title(restarts, STATION) == SAVED_TITLE


def test_a_saved_station_is_reported_by_its_name_with_no_caveat(
    client: TestClient, pcm_file_daemon: dict[str, Any]
) -> None:
    # saved while the daemon is still restarting, so nothing can reach its
    # profile list until a later restart; the save is a save all the same
    pcm_file_daemon["_restore_refusals"] = STILL_RESTARTING
    saved = _apply_and_save(client, LIVE_ONLY, STATION)["saved"]
    assert {key: value for key, value in saved.items() if value is not None} == {"name": STATION}


# --- a save that fails leaves no station behind in hqplayerd's list ------------


@contextmanager
def _refusing_writes(root: Path) -> Iterator[None]:
    """The preset store's directory tree at ``root`` with every write bit
    cleared for the block, so a save into it fails while reads still answer. A
    process the bits do not bind refuses the fixture rather than pass a case
    that tested nothing."""
    root.mkdir(exist_ok=True)
    held = [root, *(path for path in root.rglob("*") if path.is_dir())]
    for directory in held:
        directory.chmod(0o500)
    try:
        if os.access(root, os.W_OK):
            raise FixtureError(reason="this process writes a directory whose write bits are clear")
        yield
    finally:
        for directory in held:
            directory.chmod(0o700)


def _store_holds(client: TestClient, name: str) -> bool:
    """Whether the preset store answers ``name`` with a preset rather than ``not_found``."""
    status: int = client.get(f"/api/preset/{name}").status_code
    return status == 200


@pytest.mark.parametrize(
    ("refuse_writes", "expected"),
    [pytest.param(False, RESTARTING["title"], id="saved"), pytest.param(True, None, id="save_failed")],
)
def test_a_restarting_apply_lists_the_station_in_hqplayerds_profile_list_only_when_its_save_lands(
    client: TestClient, pcm_file_daemon: dict[str, Any], tmp_path: Path, expected: str | None, *, refuse_writes: bool
) -> None:
    restarts = _record_restarts(pcm_file_daemon)
    with _refusing_writes(tmp_path / "presets") if refuse_writes else nullcontext():
        _apply_and_save(client, RESTARTING, STATION)
    if not restarts:
        raise FixtureError(reason="the apply never restarted the daemon, so nothing could have listed the station")
    if _store_holds(client, STATION) is refuse_writes:
        raise FixtureError(reason="the store's holding of the station disagrees with whether its writes were refused")
    assert _listed_title(restarts, STATION) == expected


# --- a station name the rule refuses stops the apply before the engine --------

#: A station name the shared name rule refuses: the separator breaks both the
#: store's filename and the ``data/cfgs`` member that would mirror it.
BAD_STATION = "a/b"
#: A station name the store has never held whose first letter is CYRILLIC
#: SMALL LETTER A (U+0430) among Latin ones: it reads as "admin" and is not.
MIXED_SCRIPT_STATION = chr(0x0430) + "dmin"
#: Every refused station name, each a different reason for the refusal.
REFUSED_STATIONS = [
    pytest.param(BAD_STATION, id="separator"),
    pytest.param(MIXED_SCRIPT_STATION, id="mixed_script"),
]


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        pytest.param(STATION, ["1"], id="allowed"),
        pytest.param(BAD_STATION, [], id="separator"),
        pytest.param(MIXED_SCRIPT_STATION, [], id="mixed_script"),
    ],
)
def test_an_apply_and_save_of_a_live_only_change_sends_its_setter_into_an_allowed_station_name_but_not_a_refused_one(
    client: TestClient, control_log: CommandLog, name: str, expected: list[str]
) -> None:
    # enum ID "5" goes out as PCM list index "1", as in the batches above
    before = len(control_log)
    _apply_and_save(client, LIVE_ONLY, name)
    assert [attrs.get("value") for attrs in _sent(control_log[before:], "SetShaping")] == expected


@pytest.mark.parametrize("name", REFUSED_STATIONS)
def test_an_apply_and_save_of_a_live_only_change_into_a_refused_station_name_leaves_it_staged(
    client: TestClient, name: str
) -> None:
    _apply_and_save(client, LIVE_ONLY, name)
    assert client.get("/api/config/pending").json()["http"] == LIVE_ONLY


@pytest.mark.parametrize(
    ("name", "expected"),
    [pytest.param(STATION, 1, id="allowed"), pytest.param(MIXED_SCRIPT_STATION, 0, id="mixed_script")],
)
def test_a_restarting_apply_and_save_restarts_the_daemon_for_an_allowed_station_name_but_not_a_mixed_script_one(
    client: TestClient, pcm_file_daemon: dict[str, Any], name: str, expected: int
) -> None:
    before = pcm_file_daemon["_restore_attempts"]
    _apply_and_save(client, RESTARTING, name)
    assert pcm_file_daemon["_restore_attempts"] - before == expected


@pytest.mark.parametrize(
    ("name", "expected"),
    [pytest.param(STATION, {}, id="allowed"), pytest.param(MIXED_SCRIPT_STATION, RESTARTING, id="mixed_script")],
)
def test_a_restarting_apply_and_save_clears_the_stage_for_an_allowed_station_name_but_not_a_mixed_script_one(
    client: TestClient, name: str, expected: dict[str, str]
) -> None:
    _apply_and_save(client, RESTARTING, name)
    assert client.get("/api/config/pending").json()["http"] == expected
