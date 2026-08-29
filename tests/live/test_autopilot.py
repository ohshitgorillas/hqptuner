"""High-frequency filter auto-pilot: HQPTuner acting on the junk-filter advisor.

Three layers, all through public surface (docs/testing.md):

* ``lanes.autopilot.desired_junk_filter`` is pure, so the baseline/verdict/
  treatment cases are verdicts built by the advisor itself (``classify`` over the
  synthesized spectra in ``junk_spectra``) handed straight in.
* ``MeteringReader.verdict()`` runs against a fake 4322 stream speaking the real
  binary frame layout over a real socket (``fake_metering``, protocol.md §7).
* Everything user-facing — the routes, the live presets, whether the engine's
  junk filter is written at all — runs the whole app under ``TestClient`` against
  the threaded fake control daemon, so the engine's junk filter is read back off
  the daemon's own ``State`` (protocol.md §6: ``result="OK"`` is not proof).

Every store file lands under ``tmp_path``; nothing here writes into the repo's
state dir, and no case touches a real daemon.

Known gaps, stated rather than papered over:

* "The engine's junk filter is never written" is a negative, so each case that
  asserts it bounds its wait by a milestone a write would have beaten. The
  auto-pilot-off case waits for the advisor's verdict to reach ``/api/status``,
  which a write demonstrably precedes; the metering-disabled case, which never
  earns a verdict, waits out ``POLLS_PAST_A_WRITE`` of the app's own poll passes.
  Neither waits on the wall clock.
* The rate-relative baseline case (2x/4x/8x) is pinned at
  ``desired_junk_filter`` only: the fake daemon's ``GetJunkFilters`` enumeration
  carries none of those filters, so there is no engine-level situation to put one
  in as a baseline.
* A live-preset store stamped by a newer HQPTuner is already pinned, unchanged by
  the schema bump, in ``tests/live/test_live_presets.py`` and
  ``tests/presets/test_live_preset_store.py``; it is not restated here.
"""

import json
from collections.abc import Callable, Iterator
from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
from conftest import PLAYING, ManagerFactory, eventually, running_reader, spawn_threaded_daemon, wait_for_api
from fake_metering import spawn_threaded_stream
from fastapi.testclient import TestClient
from junk_spectra import FAKE_HIRES_FRAME, decaying_176, fake_hires_96k, spur_min_176

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.engine.junkadvisor import classify
from hqptuner.lanes.autopilot import desired_junk_filter, junk_filter_index, junk_filter_name
from hqptuner.presets.store.autopilot import AutopilotSchemaError, AutopilotStore

if TYPE_CHECKING:  # the reader's context type is named in annotations only
    from hqptuner.engine.metering import TrackContext

#: Junk-filter NAMES, the domain auto-pilot's baseline and the advisor's verdicts
#: both speak (architecture §2: the running engine names the enumeration).
NONE = "none"
JUNK_20K = "20k"
JUNK_30K = "30k"

#: The same two filters as the fake daemon's `GetJunkFilters` enumerates them
#: (`fake_control`): index domain, which is what `SetJunkFilter` and `State`
#: carry (protocol.md §6).
INDEX_NONE = "0"
INDEX_20K = "1"

#: Filters that are always a deliberate user choice — never recommended by the
#: advisor and never overridden by auto-pilot (architecture §5).
RATE_RELATIVE = ["2x", "4x", "8x"]

#: A main resampling filter inside one of the spur verdict's offered families,
#: and one outside every one of them.
FAMILY_FILTER = "poly-sinc-gauss-hires-lp"
OUTSIDE_FILTER = "poly-sinc-gauss-long"

#: The main filter's enum ID on the fake's PCM chain (sinc-M) — a live field that
#: is not the junk filter.
SINC_M = "25"

#: A playing 96 kHz PCM track, which is what puts the metering reader on the wire.
PLAYING_TRACK = {"state": "2", "_metadata": '<metadata samplerate="96000" sdm="0"/>'}

#: A stamp no released HQPTuner can claim to understand.
TOO_NEW = 99


def brickwall_verdict() -> dict[str, Any] | None:
    """The signature a fake-hi-res track carries: content cliffed at ~22 kHz."""
    return classify(fake_hires_96k(), 48000.0, 60.0, samplerate=96000, sdm=False)


def spur_verdict() -> dict[str, Any] | None:
    """The signature a persistent 40 kHz tone carries — the verdict that names
    filter families as well as a corner."""
    return classify(decaying_176(), 88200.0, 60.0, samplerate=176400, sdm=False, min_levels_db=spur_min_176(40000.0))


# --- what auto-pilot wants engaged ------------------------------------------------


@pytest.mark.parametrize("baseline", [NONE, JUNK_20K])
def test_no_verdict_leaves_the_baseline_engaged(baseline: str) -> None:
    assert desired_junk_filter(None, baseline, OUTSIDE_FILTER) == baseline


def test_a_verdict_the_baseline_does_not_treat_engages_the_verdicts_own_filter() -> None:
    assert desired_junk_filter(brickwall_verdict(), NONE, OUTSIDE_FILTER) == JUNK_20K


def test_a_verdict_the_baseline_already_treats_leaves_the_baseline_engaged() -> None:
    # a corner at or below the recommended one already deals with the signature
    assert desired_junk_filter(spur_verdict(), JUNK_20K, OUTSIDE_FILTER) == JUNK_20K


@pytest.mark.parametrize("baseline", RATE_RELATIVE)
def test_a_rate_relative_baseline_is_never_overridden(baseline: str) -> None:
    assert desired_junk_filter(spur_verdict(), baseline, OUTSIDE_FILTER) == baseline


def test_an_active_filter_in_the_verdicts_families_leaves_the_baseline_engaged() -> None:
    assert desired_junk_filter(spur_verdict(), NONE, FAMILY_FILTER) == NONE


def test_an_active_filter_outside_the_verdicts_families_engages_the_verdicts_filter() -> None:
    assert desired_junk_filter(spur_verdict(), NONE, OUTSIDE_FILTER) == JUNK_30K


# --- the latched verdict the loop reads -------------------------------------------


async def test_the_verdict_stands_while_a_filter_that_treats_it_is_engaged(
    metering_stream: Callable[..., Any],
) -> None:
    # auto-pilot's own write must not erase the reason it wrote: the verdict is a
    # property of the SOURCE, and the tap runs at the source rate
    _, port = await metering_stream(repeat=FAKE_HIRES_FRAME)
    cell: list[TrackContext | None] = [replace(PLAYING, junk_filter=JUNK_20K)]
    async with running_reader(port, cell) as (reader, _):
        await eventually(lambda: reader.verdict() is not None)
        verdict = reader.verdict()
        assert verdict is not None and verdict["filter"] == JUNK_20K


async def test_a_track_change_clears_the_verdict(metering_stream: Callable[..., Any]) -> None:
    # 30 frames ≈ 21 s: enough for a verdict, small enough that the backlog left
    # over cannot re-earn the minimum coverage for track-2
    stream, port = await metering_stream()
    cell: list[TrackContext | None] = [PLAYING]
    async with running_reader(port, cell) as (reader, _):
        stream.send(FAKE_HIRES_FRAME, count=30)
        await eventually(lambda: reader.verdict() is not None)
        await stream.flushed()
        cell[0] = replace(PLAYING, track_serial="track-2")
        stream.send(FAKE_HIRES_FRAME, count=2)  # ≈ 1.4 s — nowhere near re-earned
        await eventually(lambda: reader.verdict() is None)
        assert reader.verdict() is None


# --- the whole app: whether the engine's junk filter is written -------------------

AutopilotApi = Callable[..., TestClient]


@pytest.fixture
def autopilot_api(tmp_path: Path) -> Iterator[AutopilotApi]:
    """Build the app on a threaded fake control daemon reporting a playing 96 kHz
    PCM track, with every store under ``tmp_path``.

    ``metering=True`` wires the metering lane to a threaded fake 4322 stream
    carrying the fake-hi-res spectrum, so the advisor reaches a verdict; without
    it the metering port is the closed one the session guard pins, and there is
    never any advice. ``metering_enabled=False`` is the reader switched off
    outright. Remaining keyword arguments are the daemon's State overrides.

    Control lane only — no credentials, so the app never opens the 8088 lane."""
    daemons: list[Iterator[int]] = []
    streams: list[Iterator[int]] = []
    clients: list[TestClient] = []

    def build(*, metering: bool = False, metering_enabled: bool = True, **overrides: str) -> TestClient:
        daemon = spawn_threaded_daemon({**PLAYING_TRACK, **overrides})
        daemons.append(daemon)
        settings: dict[str, Any] = {
            "hqp_host": "127.0.0.1",
            "hqp_control_port": next(daemon),
            "hqp_username": "",
            "hqp_password": "",
            "metering_enabled": metering_enabled,
            "backup_dir": tmp_path,
            "preset_dir": tmp_path / "presets",
            "live_preset_file": tmp_path / "live-presets.json",
            "autopilot_file": tmp_path / "autopilot.json",
            "poll_interval": 0.02,
        }
        if metering:
            stream = spawn_threaded_stream(FAKE_HIRES_FRAME)
            streams.append(stream)
            settings["hqp_metering_port"] = next(stream)
        client = TestClient(create_app(Config(**settings)))
        clients.append(client)
        client.__enter__()
        wait_for_api(client, lambda c: bool(c.get("/api/health").json()["reachable"]))
        return client

    yield build
    for client in clients:
        client.__exit__(None, None, None)
    for stream in streams:
        next(stream, None)
    for daemon in daemons:
        next(daemon, None)


def engaged(client: TestClient) -> str:
    """The junk filter the engine has engaged, as its own State reports it."""
    return str(client.get("/api/state").json()["data"]["filter_junk"])


def advised(client: TestClient) -> bool:
    """The advisor has reached a verdict on the playing track: the poll loop has
    everything it needs to act, so a loop that was going to write has written."""
    return bool((client.get("/api/status").json().get("data") or {}).get("junk"))


#: How many of the app's own poll passes a negative case waits out before it may
#: claim nothing was written. Auto-pilot runs as its own task, so turning the app
#: over with requests proves nothing by itself: measured against this fixture,
#: with metering on and auto-pilot enabled the write lands within 51 polls, so
#: this is a threefold margin over a write that was going to happen.
POLLS_PAST_A_WRITE = 150


def polls(client: TestClient, count: int) -> None:
    """Wait until the app has turned its own poll loop over ``count`` times,
    counted by the distinct ``loaded_at`` stamps ``/api/status`` reports. A
    milestone in the app's own passes, never a wall-clock wait (docs/testing.md
    §7); the request bound only turns an app that stopped polling into a loud
    failure rather than a hang."""
    seen: set[object] = set()
    for _ in range(200_000):
        if len(seen) >= count:
            return
        seen.add(client.get("/api/status").json()["loaded_at"])
    pytest.fail(f"the app never completed {count} polls")


def enable(client: TestClient) -> None:
    client.post("/api/autopilot", json={"enabled": True})


def test_autopilot_off_leaves_the_engines_junk_filter_alone(autopilot_api: AutopilotApi) -> None:
    client = autopilot_api(metering=True)
    wait_for_api(client, advised)
    assert engaged(client) == INDEX_NONE


def test_autopilot_engages_the_filter_the_verdict_names(autopilot_api: AutopilotApi) -> None:
    client = autopilot_api(metering=True)
    enable(client)
    wait_for_api(client, lambda c: engaged(c) == INDEX_20K)
    assert engaged(client) == INDEX_20K


def test_metering_switched_off_leaves_the_engines_junk_filter_alone(autopilot_api: AutopilotApi) -> None:
    client = autopilot_api(metering=True, metering_enabled=False)
    enable(client)
    polls(client, POLLS_PAST_A_WRITE)
    assert engaged(client) == INDEX_NONE


# --- the routes -------------------------------------------------------------------


def test_enabling_autopilot_records_the_engaged_filter_as_the_baseline(autopilot_api: AutopilotApi) -> None:
    client = autopilot_api(filter_junk=INDEX_20K)
    # reachable is not loaded: wait until the app has actually read the engine's
    # engaged filter, or "what was engaged when auto-pilot came on" is a race
    wait_for_api(client, lambda c: engaged(c) == INDEX_20K)
    enable(client)
    assert client.get("/api/autopilot").json()["baseline"] == JUNK_20K


def test_setting_the_junk_filter_by_hand_switches_autopilot_off(autopilot_api: AutopilotApi) -> None:
    client = autopilot_api()
    enable(client)
    client.post("/api/config/live", json={"fields": {"junk_filter": INDEX_20K}})
    assert client.get("/api/autopilot").json()["enabled"] is False


def test_a_live_write_that_names_no_junk_filter_leaves_autopilot_on(autopilot_api: AutopilotApi) -> None:
    client = autopilot_api()
    enable(client)
    client.post("/api/config/live", json={"fields": {"filter": SINC_M}})
    assert client.get("/api/autopilot").json()["enabled"] is True


def test_status_reports_autopilot_off_on_a_fresh_install(autopilot_api: AutopilotApi) -> None:
    assert autopilot_api().get("/api/status").json()["data"]["autopilot"] is False


def test_status_reports_autopilot_on_once_it_is_enabled(autopilot_api: AutopilotApi) -> None:
    client = autopilot_api()
    enable(client)
    assert client.get("/api/status").json()["data"]["autopilot"] is True


# --- presets carry it -------------------------------------------------------------


def test_a_live_preset_saved_with_autopilot_on_carries_it(autopilot_api: AutopilotApi) -> None:
    client = autopilot_api()
    enable(client)
    assert client.put("/api/livepresets/Warm").json()["autopilot"] is True


@pytest.mark.parametrize("saved", [True, False])
def test_applying_a_live_preset_sets_autopilot_to_what_it_carries(autopilot_api: AutopilotApi, *, saved: bool) -> None:
    client = autopilot_api()
    client.post("/api/autopilot", json={"enabled": saved})
    client.put("/api/livepresets/Warm")
    client.post("/api/autopilot", json={"enabled": not saved})
    client.post("/api/livepresets/Warm/apply")
    assert client.get("/api/autopilot").json()["enabled"] is saved


async def test_saving_a_general_preset_records_autopilot_under_its_name(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # hqplayerd's own /config form carries no junk-filter field, so a general
    # preset's XML snapshot cannot hold this: HQPTuner's store does, by name
    path = tmp_path / "autopilot.json"
    AutopilotStore(path).enable(baseline=NONE)
    manager = http_manager_factory(http_daemon, autopilot_file=path)
    await manager.presetops.save_preset("Studio")
    assert AutopilotStore(path).for_preset("Studio") is True


async def test_loading_a_general_preset_restores_the_autopilot_state_it_recorded(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    path = tmp_path / "autopilot.json"
    AutopilotStore(path).enable(baseline=NONE)
    manager = http_manager_factory(http_daemon, autopilot_file=path)
    await manager.presetops.save_preset("Studio")
    AutopilotStore(path).disable()
    await manager.presetops.load_preset("Studio")
    assert AutopilotStore(path).enabled is True


# --- the store itself -------------------------------------------------------------


def seed_stamped(tmp_path: Path, schema: object) -> Path:
    """A store file another HQPTuner version wrote, stamped with its own layout
    number — hand-written for the same reason a wire test hand-writes a frame."""
    path = tmp_path / "autopilot.json"
    path.write_text(json.dumps({"schema": schema, "enabled": True, "baseline": JUNK_20K, "presets": {}}))
    return path


def test_a_store_whose_file_was_never_written_reports_autopilot_off(tmp_path: Path) -> None:
    assert AutopilotStore(tmp_path / "never-created" / "autopilot.json").enabled is False


def test_enabling_records_the_baseline_it_was_handed(tmp_path: Path) -> None:
    store = AutopilotStore(tmp_path / "autopilot.json")
    store.enable(baseline=JUNK_20K)
    assert store.baseline == JUNK_20K


def test_disabling_turns_autopilot_off(tmp_path: Path) -> None:
    store = AutopilotStore(tmp_path / "autopilot.json")
    store.enable(baseline=JUNK_20K)
    store.disable()
    assert store.enabled is False


def test_a_store_stamped_by_a_newer_hqptuner_is_refused_on_read(tmp_path: Path) -> None:
    seed_stamped(tmp_path, TOO_NEW)
    with pytest.raises(AutopilotSchemaError):
        AutopilotStore(tmp_path / "autopilot.json").for_preset("Studio")


def test_a_store_stamped_by_a_newer_hqptuner_is_refused_on_write(tmp_path: Path) -> None:
    seed_stamped(tmp_path, TOO_NEW)
    with pytest.raises(AutopilotSchemaError):
        AutopilotStore(tmp_path / "autopilot.json").enable(baseline=NONE)


# --- resolving a filter between the name domain and the index domain --------------

#: The enumeration as `manager.enums["junk_filters"]` holds it: the running
#: engine's own rows, name and index (architecture §2).
JUNK_ENUM = [{"index": INDEX_NONE, "name": NONE}, {"index": INDEX_20K, "name": JUNK_20K}]

#: A name and an index this enumeration does not carry — a filter another engine
#: build lists, or a row a re-enumeration dropped.
ABSENT_NAME = "40k"
ABSENT_INDEX = "7"


def test_a_name_the_enumeration_does_not_carry_resolves_to_no_index() -> None:
    assert junk_filter_index(JUNK_ENUM, ABSENT_NAME) is None


def test_an_index_the_enumeration_does_not_carry_resolves_to_no_name() -> None:
    assert junk_filter_name(JUNK_ENUM, ABSENT_INDEX) is None


def test_no_index_at_all_resolves_to_no_name() -> None:
    assert junk_filter_name(JUNK_ENUM, None) is None


# --- failure paths: auto-pilot does nothing, and survives -------------------------


def test_a_store_stamped_by_a_newer_hqptuner_leaves_the_engines_junk_filter_alone(
    tmp_path: Path, autopilot_api: AutopilotApi
) -> None:
    # the same milestone the auto-pilot-off case waits for: a write that was going
    # to happen precedes the verdict reaching /api/status
    seed_stamped(tmp_path, TOO_NEW)
    client = autopilot_api(metering=True)
    wait_for_api(client, advised)
    assert engaged(client) == INDEX_NONE


def test_no_usable_answer_about_the_engine_leaves_the_junk_filter_alone(autopilot_api: AutopilotApi) -> None:
    # the daemon refuses `Status` (protocol.md §6), so there is no track context to
    # act on however good the advice is
    client = autopilot_api(metering=True, _error="Status")
    enable(client)
    polls(client, POLLS_PAST_A_WRITE)
    assert engaged(client) == INDEX_NONE


def test_a_verdict_naming_a_filter_the_engine_does_not_enumerate_writes_nothing(autopilot_api: AutopilotApi) -> None:
    # enumerations are engine-built: this daemon lists no 20k, and the verdict on
    # the fake-hi-res spectrum names one. Writing an index resolved against any
    # other list would engage a filter nobody asked for.
    client = autopilot_api(metering=True, _junk_filters=f"{NONE} {JUNK_30K}")
    enable(client)
    polls(client, POLLS_PAST_A_WRITE)
    assert engaged(client) == INDEX_NONE


def test_the_autopilot_route_refuses_a_store_stamped_by_a_newer_hqptuner(
    tmp_path: Path, autopilot_api: AutopilotApi
) -> None:
    seed_stamped(tmp_path, TOO_NEW)
    assert autopilot_api().get("/api/autopilot").status_code == 409


def test_switching_autopilot_is_refused_on_a_store_stamped_by_a_newer_hqptuner(
    tmp_path: Path, autopilot_api: AutopilotApi
) -> None:
    seed_stamped(tmp_path, TOO_NEW)
    assert autopilot_api().post("/api/autopilot", json={"enabled": True}).status_code == 409


def test_a_store_file_that_is_not_an_object_reports_autopilot_off(tmp_path: Path) -> None:
    path = tmp_path / "autopilot.json"
    path.write_text(json.dumps([{"enabled": True}]))
    assert AutopilotStore(path).enabled is False
