"""Auto-pilot: the advisor's write path — decision, acting, state, routes.

Four layers, each driven at the smallest surface that reaches it.

`desired_junk_filter` is pure, so the decision cases hand it verdicts built by
`junkadvisor.classify` over the synthesized spectra in `junk_spectra` — never a
hand-written verdict dict, which would pin this suite to a shape the advisor is
free to change.

The acting cases call `core.autopilotops.act` directly against a real
`ConnectionManager` on the fake control daemon, with a real `MeteringReader`
attached to it the way the app's lifespan attaches one, fed by the fake 4322
stream speaking real binary frames (`fake_metering`, protocol.md §7). One `act`
is one decision and at most one write, so there is no poll loop to turn over,
and the fixture hands back a manager whose advisor already has a verdict — a
fixed batch of frames, waited out on the reader's own recommendation rather than
on a clock, so a negative case is never a case where nothing had been advised
yet.

A negative here ("the junk filter is never written") is asserted on the daemon's
own command log, not on a State readback: the baseline in most of these cases is
the `none` the engine already sits at, so a loop that rewrites the baseline every
pass reads back exactly like one that writes nothing. `SetJunkFilter` reaching
the daemon at all is the observable.
"""

import asyncio
import json
from collections.abc import AsyncIterator, Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from conftest import DaemonFactory, eventually, spawn_threaded_daemon, wait_for_api
from fake_control import CommandLog
from fake_metering import MeteringStream
from fastapi.testclient import TestClient
from junk_spectra import FAKE_HIRES_FRAME, decaying_176, fake_hires_96k, spur_min_176

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.core.autopilotops import act
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.junkadvisor import classify
from hqptuner.engine.metering import MeteringReader, context_from
from hqptuner.lanes.autopilot import desired_junk_filter, junk_filter_index, junk_filter_name
from hqptuner.presets import presetlane
from hqptuner.presets.store.autopilot import AutopilotSchemaError, AutopilotStore
from hqptuner.presets.store.presets import PresetStore

#: A 96 kHz PCM track with content cut dead at 22 kHz — the fake-hi-res
#: signature, whose verdict recommends the 20k corner.
BRICKWALL = classify(fake_hires_96k(), 48000.0, 60.0, samplerate=96000, sdm=False)

#: A 176.4 kHz track carrying a persistent 40 kHz tone — the spur signature,
#: whose verdict recommends the 30k corner and offers hi-res filter families.
SPUR = classify(
    decaying_176(),
    88200.0,
    60.0,
    samplerate=176400,
    sdm=False,
    min_levels_db=spur_min_176(40000.0),
)

#: A junk-filter enumeration in the shape the daemon answers `GetJunkFilters`
#: with (protocol.md §6: `<JunkFiltersItem index name value/>`).
ITEMS = [
    {"index": "0", "name": "none", "value": "0"},
    {"index": "1", "name": "20k", "value": "1"},
    {"index": "2", "name": "30k", "value": "2"},
]

METADATA_96K_PCM = '<metadata samplerate="96000" sdm="0"/>'

#: 60 frames at 0.7 s of coverage apiece ≈ 42 s, comfortably past the advisor's
#: minimum — a bounded batch, so the evidence is a fact about what crossed the
#: socket rather than about how long the test ran.
COVERING_FRAMES = 60


async def _instant(_seconds: float) -> None:
    """The reader's idle re-check, paced by the loop instead of the clock."""
    await asyncio.sleep(0)


# --- the decision (pure) ----------------------------------------------------


def test_no_verdict_leaves_the_engine_on_the_baseline() -> None:
    assert desired_junk_filter(None, "30k", None) == "30k"


def test_a_verdict_the_baseline_does_not_treat_asks_for_the_verdicts_filter() -> None:
    assert desired_junk_filter(BRICKWALL, "none", None) == "20k"


def test_a_verdict_the_baseline_already_treats_leaves_the_baseline_alone() -> None:
    # the 20k corner sits below the spur verdict's recommended 30k, so it
    # already covers the signature and nothing is overridden
    assert desired_junk_filter(SPUR, "20k", None) == "20k"


@pytest.mark.parametrize("baseline", ["2x", "4x", "8x"])
def test_a_rate_relative_baseline_is_never_overridden(baseline: str) -> None:
    assert desired_junk_filter(BRICKWALL, baseline, None) == baseline


@pytest.mark.parametrize("active", ["poly-sinc-gauss-hires-lp", "poly-sinc-ext2-hires-mp"])
def test_an_active_filter_from_the_verdicts_families_leaves_the_baseline_alone(active: str) -> None:
    assert desired_junk_filter(SPUR, "none", active) == "none"


def test_an_active_filter_outside_the_verdicts_families_asks_for_the_verdicts_filter() -> None:
    assert desired_junk_filter(SPUR, "none", "poly-sinc-gauss-long") == "30k"


# --- resolving names against the running enumeration ------------------------


def test_a_name_the_enumeration_does_not_carry_resolves_to_no_index() -> None:
    assert junk_filter_index(ITEMS, "50k") is None


@pytest.mark.parametrize("index", ["9", None])
def test_an_index_the_enumeration_does_not_carry_resolves_to_no_name(index: str | None) -> None:
    assert junk_filter_name(ITEMS, index) is None


# --- acting: a manager whose advisor has a live verdict ---------------------

Advising = Callable[..., Any]


@pytest.fixture
async def advising(daemon: DaemonFactory, tmp_path: Path) -> AsyncIterator[Advising]:
    """A running manager whose control lane is the fake daemon and whose
    advisor has already earned a verdict off the fake metering stream.

    Keyword arguments are the daemon's State overrides, as for `live_manager`.
    The engine is reported playing a 96 kHz PCM track, because the reader only
    holds the metering socket while something is playing (protocol.md §7)."""
    started: list[tuple[ConnectionManager, asyncio.Task[None]]] = []
    readers: list[tuple[MeteringReader, asyncio.Task[None]]] = []
    streams: list[MeteringStream] = []

    async def build(**overrides: str) -> tuple[ConnectionManager, CommandLog, dict[str, str]]:
        port, log, state = await daemon(state="2", _metadata=METADATA_96K_PCM, **overrides)
        stream = MeteringStream()
        streams.append(stream)
        metering_port = await stream.start()
        manager = ConnectionManager(
            Config(
                hqp_host="127.0.0.1",
                hqp_control_port=port,
                hqp_metering_port=metering_port,
                poll_interval=0.02,
                backup_dir=tmp_path,
                preset_dir=tmp_path / "presets",
                live_preset_file=tmp_path / "live-presets.json",
                autopilot_file=tmp_path / "autopilot.json",
            )
        )
        task = asyncio.create_task(manager.run())
        started.append((manager, task))
        await eventually(lambda: manager.reachable)
        # the reader is the app's, not the manager's: the lifespan starts one
        # beside the manager and hands it over. This is that same reader, over
        # the same wire, with its idle re-check paced instantly.
        reader = MeteringReader("127.0.0.1", metering_port, lambda: context_from(manager), sleep=_instant)
        manager.metering = reader
        readers.append((reader, asyncio.create_task(reader.run())))
        stream.send(FAKE_HIRES_FRAME, count=COVERING_FRAMES)
        await eventually(lambda: reader.recommendation() is not None)
        return manager, log, state

    yield build
    for reader, reader_task in readers:
        reader.stop()
        reader_task.cancel()
        await asyncio.gather(reader_task, return_exceptions=True)
    for manager, task in started:
        manager.stop()
        await task
        await manager.aclose()
    for stream in streams:
        await stream.close()


def junk_writes(log: CommandLog) -> list[str]:
    """Every junk-filter index this daemon was actually asked to engage."""
    return [attrs.get("value", "") for name, attrs in log if name == "SetJunkFilter"]


def engaged(manager: ConnectionManager) -> str | None:
    """The junk filter the engine is running right now, as the advisor sees it."""
    context = context_from(manager)
    return None if context is None else context.junk_filter


async def test_an_untreated_verdict_engages_the_recommended_filter(advising: Advising) -> None:
    # 20k is index 1 of the fake's built-in enumeration; that the index is
    # resolved against the RUNNING list is the whole point of writing one
    manager, log, _ = await advising()
    manager.presetops.autopilot.enable(baseline="none")
    await act(manager)
    assert junk_writes(log) == ["1"]


async def test_auto_pilot_switched_off_never_writes_the_junk_filter(advising: Advising) -> None:
    manager, log, _ = await advising()
    await act(manager)
    assert junk_writes(log) == []


async def test_a_baseline_that_already_treats_the_verdict_writes_nothing(advising: Advising) -> None:
    # the user was already sitting on the 20k corner when they switched
    # auto-pilot on, and that corner covers this signature: nothing to do. The
    # engine is moved onto it after the verdict is earned, because a filter that
    # is already treating the track is exactly the case the advisor goes quiet
    # for, and the baseline still has to be left alone when it does.
    manager, log, state = await advising()
    state["filter_junk"] = "1"
    await eventually(lambda: engaged(manager) == "20k")
    manager.presetops.autopilot.enable(baseline="20k")
    await act(manager)
    assert junk_writes(log) == []


async def test_a_filter_absent_from_the_running_enumeration_is_never_written(advising: Advising) -> None:
    # this engine build offers no 20k corner at all; an index resolved against a
    # list it does not serve would engage a filter nobody asked for
    manager, log, _ = await advising(_junk_filters="none 30k")
    manager.presetops.autopilot.enable(baseline="none")
    await act(manager)
    assert junk_writes(log) == []


async def test_a_store_stamped_newer_than_understood_writes_nothing(advising: Advising, tmp_path: Path) -> None:
    # switched on first, so the only thing standing between this verdict and a
    # write is the stamp: a build that read the file anyway would engage 20k
    manager, log, _ = await advising()
    manager.presetops.autopilot.enable(baseline="none")
    (tmp_path / "autopilot.json").write_text(json.dumps({"schema": 99}))
    await act(manager)
    assert junk_writes(log) == []


async def test_a_refused_write_leaves_auto_pilot_enabled(advising: Advising) -> None:
    # the engine says no; that is the engine's business, not a reason to hand
    # the user back a switch they never touched
    manager, _log, _ = await advising(_error="SetJunkFilter")
    manager.presetops.autopilot.enable(baseline="none")
    await act(manager)
    assert manager.presetops.autopilot.enabled is True


# --- the store on disk ------------------------------------------------------


def store(tmp_path: Path) -> AutopilotStore:
    return AutopilotStore(tmp_path / "autopilot.json")


def seed(tmp_path: Path, body: str) -> None:
    (tmp_path / "autopilot.json").write_text(body)


def test_a_store_that_was_never_written_reports_off(tmp_path: Path) -> None:
    assert store(tmp_path).enabled is False


def test_enabling_records_the_baseline_it_was_handed(tmp_path: Path) -> None:
    store(tmp_path).enable(baseline="30k")
    assert store(tmp_path).baseline == "30k"


def test_disabling_turns_auto_pilot_off(tmp_path: Path) -> None:
    store(tmp_path).enable(baseline="30k")
    store(tmp_path).disable()
    assert store(tmp_path).enabled is False


def test_a_store_stamped_newer_than_understood_is_refused_on_read(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps({"schema": 99}))
    with pytest.raises(AutopilotSchemaError):
        _ = store(tmp_path).enabled


def test_a_store_stamped_newer_than_understood_is_refused_on_write(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps({"schema": 99}))
    with pytest.raises(AutopilotSchemaError):
        store(tmp_path).enable(baseline="none")


def test_a_file_that_is_not_a_json_object_reports_off(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps(["not", "a", "store"]))
    assert store(tmp_path).enabled is False


# --- the routes -------------------------------------------------------------

ApiFactory = Callable[..., TestClient]


@pytest.fixture
def autopilot_api(tmp_path: Path) -> Iterator[ApiFactory]:
    """The app over a threaded fake control daemon, with every store path under
    tmp_path — auto-pilot's own file included, so no case here can write into
    the repo's state directory. Keyword arguments are the daemon's State."""
    daemons: list[Iterator[int]] = []
    clients: list[TestClient] = []

    def build(**overrides: str) -> TestClient:
        spawned = spawn_threaded_daemon(overrides)
        daemons.append(spawned)
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=next(spawned),
            hqp_username="",
            hqp_password="",
            backup_dir=tmp_path,
            preset_dir=tmp_path / "presets",
            live_preset_file=tmp_path / "live-presets.json",
            autopilot_file=tmp_path / "autopilot.json",
        )
        client = TestClient(create_app(cfg))
        client.__enter__()
        clients.append(client)
        wait_for_api(client, lambda c: bool(c.get("/api/health").json()["reachable"]))
        return client

    yield build
    for client in clients:
        client.__exit__(None, None, None)
    for spawned in daemons:
        next(spawned, None)


def test_switching_on_records_the_engaged_junk_filter_as_the_baseline(autopilot_api: ApiFactory) -> None:
    # index 2 of the fake's enumeration is the 30k corner
    client = autopilot_api(filter_junk="2")
    assert client.post("/api/autopilot", json={"enabled": True}).json()["baseline"] == "30k"


def test_setting_the_junk_filter_by_hand_switches_auto_pilot_off(autopilot_api: ApiFactory) -> None:
    client = autopilot_api()
    client.post("/api/autopilot", json={"enabled": True})
    client.post("/api/config/live", json={"fields": {"junk_filter": "1"}})
    assert client.get("/api/autopilot").json()["enabled"] is False


def test_a_live_write_without_the_junk_filter_leaves_auto_pilot_alone(autopilot_api: ApiFactory) -> None:
    client = autopilot_api()
    client.post("/api/autopilot", json={"enabled": True})
    client.post("/api/config/live", json={"fields": {"filter": "25"}})
    assert client.get("/api/autopilot").json()["enabled"] is True


def test_status_carries_the_auto_pilot_state(autopilot_api: ApiFactory) -> None:
    client = autopilot_api()
    client.post("/api/autopilot", json={"enabled": True})
    assert client.get("/api/status").json()["data"]["autopilot"] is True


def test_a_live_preset_saved_with_auto_pilot_on_carries_it(autopilot_api: ApiFactory) -> None:
    # read back off the list rather than the save response: the list is what the
    # card renders from after a reload
    client = autopilot_api()
    client.post("/api/autopilot", json={"enabled": True})
    client.put("/api/livepresets/Warm")
    assert client.get("/api/livepresets").json()["presets"][0]["autopilot"] is True


def test_applying_a_live_preset_sets_auto_pilot_to_what_it_carries(autopilot_api: ApiFactory) -> None:
    client = autopilot_api()
    client.post("/api/autopilot", json={"enabled": True})
    client.put("/api/livepresets/Warm")
    client.post("/api/autopilot", json={"enabled": False})
    client.post("/api/livepresets/Warm/apply")
    assert client.get("/api/autopilot").json()["enabled"] is True


def test_reading_the_state_off_a_store_stamped_newer_than_understood_is_refused(
    autopilot_api: ApiFactory, tmp_path: Path
) -> None:
    # answering "off" would be a lie about a file that is there and full
    client = autopilot_api()
    seed(tmp_path, json.dumps({"schema": 99}))
    assert client.get("/api/autopilot").status_code == 409


def test_switching_a_store_stamped_newer_than_understood_is_refused(autopilot_api: ApiFactory, tmp_path: Path) -> None:
    client = autopilot_api()
    seed(tmp_path, json.dumps({"schema": 99}))
    assert client.post("/api/autopilot", json={"enabled": True}).status_code == 409


# --- general presets --------------------------------------------------------


def preset_manager(
    factory: Callable[..., ConnectionManager], daemon: dict[str, Any], tmp_path: Path
) -> ConnectionManager:
    """A manager on the fake 8088 daemon whose auto-pilot store is in tmp."""
    return factory(daemon, autopilot_file=tmp_path / "autopilot.json")


async def test_saving_a_general_preset_records_auto_pilot_under_its_own_name(
    http_manager_factory: Callable[..., ConnectionManager], http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager = preset_manager(http_manager_factory, http_daemon, tmp_path)
    manager.presetops.autopilot.enable(baseline="none")
    await manager.presetops.save_preset("Studio")
    assert manager.presetops.autopilot.for_preset("Studio") is True


async def test_saving_a_general_preset_records_nothing_for_a_preset_it_did_not_save(
    http_manager_factory: Callable[..., ConnectionManager], http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # a store that answered the same for every name would have recorded nothing
    manager = preset_manager(http_manager_factory, http_daemon, tmp_path)
    manager.presetops.autopilot.enable(baseline="none")
    await manager.presetops.save_preset("Studio")
    assert manager.presetops.autopilot.for_preset("Den") is False


async def test_loading_a_general_preset_restores_the_auto_pilot_state_it_was_saved_with(
    http_manager_factory: Callable[..., ConnectionManager], http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager = preset_manager(http_manager_factory, http_daemon, tmp_path)
    manager.presetops.autopilot.enable(baseline="none")
    await manager.presetops.save_preset("Studio")
    manager.presetops.autopilot.disable()
    await manager.presetops.load_preset("Studio")
    assert manager.presetops.autopilot.enabled is True


async def test_an_auto_save_records_auto_pilot_under_the_active_presets_name(
    http_manager_factory: Callable[..., ConnectionManager], http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # saved with auto-pilot off, switched on afterwards: a fold that skipped
    # auto-pilot would leave "Studio" frozen at the False the explicit save wrote
    manager = preset_manager(http_manager_factory, http_daemon, tmp_path)
    await manager.presetops.save_preset("Studio")
    PresetStore(tmp_path / "presets").set_autosave(enabled=True)
    manager.presetops.autopilot.enable(baseline="none")
    await presetlane.autosave(manager)
    assert manager.presetops.autopilot.for_preset("Studio") is True
