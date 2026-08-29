"""Auto-pilot: the advisor's write path — decision, acting, state, routes.

Four layers, each driven at the smallest surface that reaches it.

Auto-pilot switched on means the resting junk filter is `none`: it engages only
what a track's signature asks for, and releases back to `none` as soon as the
verdict clears. There is no baseline anywhere — not in the store, not in the
decision, not in a payload.

`desired_junk_filter` is pure, so the decision cases hand it verdicts built by
`junkadvisor.classify` over the synthesized spectra in `junk_spectra` — never a
hand-written verdict dict, which would pin this suite to a shape the advisor is
free to change.

The acting cases call `core.autopilotops.act` directly against a real
`ConnectionManager` on the fake control daemon, with a real `MeteringReader`
attached to it the way the app's lifespan attaches one, fed by the fake 4322
stream speaking real binary frames (`fake_metering`, protocol.md §7). One `act`
is one decision and at most one write, so there is no poll loop to turn over.
The fixture takes the number of frames to feed: a covering batch hands back a
manager whose advisor already has a verdict — waited out on the reader's own
recommendation rather than on a clock, so a case is never one where nothing had
been advised yet — and zero frames hands back one that will never earn a
verdict, which is the resting case.

A negative here ("the junk filter is never written") is asserted on the daemon's
own command log, not on a State readback: the engine in most of these cases
already sits at the `none` auto-pilot rests on, so a loop that rewrites `none`
every pass reads back exactly like one that writes nothing. `SetJunkFilter`
reaching the daemon at all is the observable.

One gap, stated rather than papered over: "a verdict plus an active main filter
from its families rests on `none`" is pinned on `desired_junk_filter` only. At
the acting layer it has no distinct observable — the one verdict the metering
fixture can earn off `FAKE_HIRES_FRAME` offers no families at all, and for a
spur verdict an active hi-res filter is exactly the condition the advisor goes
quiet under, which is already the no-verdict case below.
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
from hqptuner.lanes.autopilot import desired_junk_filter, junk_filter_index
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

#: An engine build whose junk-filter enumeration carries the rate-relative
#: corners, in this order — index 1 is 2x, 2 is 4x, 3 is 8x, and 0 is `none`.
RATE_RELATIVE_ENUM = "none 2x 4x 8x 20k"

#: 60 frames at 0.7 s of coverage apiece ≈ 42 s, comfortably past the advisor's
#: minimum — a bounded batch, so the evidence is a fact about what crossed the
#: socket rather than about how long the test ran.
COVERING_FRAMES = 60

#: The hi-res filter families the spur verdict offers as an alternative to a
#: corner; an active main filter from one of them covers the signature.
HIRES_FILTERS = ["poly-sinc-gauss-hires-lp", "poly-sinc-ext2-hires-mp"]


async def _instant(_seconds: float) -> None:
    """The reader's idle re-check, paced by the loop instead of the clock."""
    await asyncio.sleep(0)


# --- the decision (pure) ----------------------------------------------------


@pytest.mark.parametrize("active", [None, "poly-sinc-gauss-long", "poly-sinc-gauss-hires-lp"])
def test_no_verdict_rests_on_none(active: str | None) -> None:
    assert desired_junk_filter(None, active) == "none"


def test_a_verdict_nothing_covers_asks_for_the_verdicts_filter() -> None:
    assert desired_junk_filter(BRICKWALL, None) == "20k"


def test_an_active_filter_outside_the_verdicts_families_asks_for_the_verdicts_filter() -> None:
    assert desired_junk_filter(SPUR, "poly-sinc-gauss-long") == "30k"


@pytest.mark.parametrize("active", HIRES_FILTERS)
def test_an_active_filter_from_the_verdicts_families_rests_on_none(active: str) -> None:
    assert desired_junk_filter(SPUR, active) == "none"


# --- resolving names against the running enumeration ------------------------


def test_a_name_the_enumeration_does_not_carry_resolves_to_no_index() -> None:
    assert junk_filter_index(ITEMS, "50k") is None


# --- acting: a manager on the fake daemon, with or without a verdict --------

Advising = Callable[..., Any]


@pytest.fixture
async def advising(daemon: DaemonFactory, tmp_path: Path) -> AsyncIterator[Advising]:
    """A running manager whose control lane is the fake daemon and whose
    advisor has been fed `frames` metering frames off the fake stream.

    A covering batch (the default) earns a verdict before the fixture hands the
    manager back; zero frames means no verdict will ever be earned, which is the
    resting case. Keyword arguments are the daemon's State overrides, as for
    `live_manager`. The engine is reported playing a 96 kHz PCM track, because
    the reader only holds the metering socket while something is playing
    (protocol.md §7)."""
    started: list[tuple[ConnectionManager, asyncio.Task[None]]] = []
    readers: list[tuple[MeteringReader, asyncio.Task[None]]] = []
    streams: list[MeteringStream] = []

    async def build(
        frames: int = COVERING_FRAMES, **overrides: str
    ) -> tuple[ConnectionManager, CommandLog, dict[str, str]]:
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
        if frames:
            stream.send(FAKE_HIRES_FRAME, count=frames)
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


async def test_no_verdict_releases_the_engine_to_none(advising: Advising) -> None:
    # the user's own 20k corner is not a baseline to return to: with nothing
    # advised, auto-pilot's resting place is `none`
    manager, _log, state = await advising(frames=0, filter_junk="1")
    await eventually(lambda: engaged(manager) == "20k")
    manager.presetops.autopilot.enable()
    await act(manager)
    assert state["filter_junk"] == "0"


async def test_an_untreated_verdict_engages_the_recommended_filter(advising: Advising) -> None:
    # 20k is index 1 of the fake's built-in enumeration; that the index is
    # resolved against the RUNNING list is the whole point of writing one
    manager, log, _ = await advising()
    manager.presetops.autopilot.enable()
    await act(manager)
    assert junk_writes(log) == ["1"]


async def test_a_fixed_corner_is_released_when_no_verdict_asks_for_it(advising: Advising) -> None:
    # index 2 of the built-in enumeration is the 30k corner; index 0 is `none`.
    # The case above reads the release off the engine's own State, which cannot
    # tell one write from a loop that rewrites `none` every pass; this one reads
    # the command log, so the release is pinned as exactly one write.
    manager, log, _ = await advising(frames=0, filter_junk="2")
    await eventually(lambda: engaged(manager) == "30k")
    manager.presetops.autopilot.enable()
    await act(manager)
    assert junk_writes(log) == ["0"]


@pytest.mark.parametrize(("name", "index"), [("2x", "1"), ("4x", "2"), ("8x", "3")])
async def test_a_rate_relative_filter_is_released_when_no_verdict_asks_for_it(
    advising: Advising, name: str, index: str
) -> None:
    # rate-relative corners are no longer protected inside auto-pilot: on means
    # the resting filter is `none`, whatever the user left engaged
    manager, log, _ = await advising(frames=0, _junk_filters=RATE_RELATIVE_ENUM, filter_junk=index)
    await eventually(lambda: engaged(manager) == name)
    manager.presetops.autopilot.enable()
    await act(manager)
    assert junk_writes(log) == ["0"]


async def test_an_engine_already_resting_on_none_is_never_written_to(advising: Advising) -> None:
    manager, log, _ = await advising(frames=0)
    await eventually(lambda: engaged(manager) == "none")
    manager.presetops.autopilot.enable()
    await act(manager)
    assert junk_writes(log) == []


async def test_auto_pilot_switched_off_never_writes_the_junk_filter(advising: Advising) -> None:
    manager, log, _ = await advising()
    await act(manager)
    assert junk_writes(log) == []


async def test_a_filter_absent_from_the_running_enumeration_is_never_written(advising: Advising) -> None:
    # this engine build offers no 20k corner at all; an index resolved against a
    # list it does not serve would engage a filter nobody asked for
    manager, log, _ = await advising(_junk_filters="none 30k")
    manager.presetops.autopilot.enable()
    await act(manager)
    assert junk_writes(log) == []


async def test_a_store_stamped_newer_than_understood_writes_nothing(advising: Advising, tmp_path: Path) -> None:
    # switched on first, so the only thing standing between this verdict and a
    # write is the stamp: a build that read the file anyway would engage 20k
    manager, log, _ = await advising()
    manager.presetops.autopilot.enable()
    (tmp_path / "autopilot.json").write_text(json.dumps({"schema": 99}))
    await act(manager)
    assert junk_writes(log) == []


async def test_a_write_the_engine_refuses_is_still_attempted(advising: Advising) -> None:
    # the precondition the case below rests on, stated rather than assumed: a
    # daemon that answers SetJunkFilter with an error is still asked to engage
    # 20k, so "refused" there is a refusal and not a write that never happened
    manager, log, _ = await advising(_error="SetJunkFilter")
    manager.presetops.autopilot.enable()
    await act(manager)
    assert junk_writes(log) == ["1"]


async def test_a_refused_write_leaves_auto_pilot_enabled(advising: Advising) -> None:
    # the engine says no; that is the engine's business, not a reason to hand
    # the user back a switch they never touched
    manager, _log, _ = await advising(_error="SetJunkFilter")
    manager.presetops.autopilot.enable()
    await act(manager)
    assert manager.presetops.autopilot.enabled is True


# --- the store on disk ------------------------------------------------------


def store(tmp_path: Path) -> AutopilotStore:
    return AutopilotStore(tmp_path / "autopilot.json")


def seed(tmp_path: Path, body: str) -> None:
    (tmp_path / "autopilot.json").write_text(body)


def stored(tmp_path: Path) -> dict[str, Any]:
    """The store's file as it sits on disk."""
    loaded: dict[str, Any] = json.loads((tmp_path / "autopilot.json").read_text())
    return loaded


def add_leftover_baseline(tmp_path: Path) -> None:
    """Put a `baseline` key back into a store file written by this build — what
    a file written by an older HQPTuner carries."""
    seed(tmp_path, json.dumps({**stored(tmp_path), "baseline": "30k"}))


def test_a_store_that_was_never_written_reports_off(tmp_path: Path) -> None:
    assert store(tmp_path).enabled is False


def test_enabling_turns_auto_pilot_on(tmp_path: Path) -> None:
    store(tmp_path).enable()
    assert store(tmp_path).enabled is True


def test_disabling_turns_auto_pilot_off(tmp_path: Path) -> None:
    store(tmp_path).enable()
    store(tmp_path).disable()
    assert store(tmp_path).enabled is False


def test_a_leftover_baseline_key_reads_as_the_state_it_was_stored_with(tmp_path: Path) -> None:
    store(tmp_path).enable()
    add_leftover_baseline(tmp_path)
    assert store(tmp_path).enabled is True


def test_writing_over_a_leftover_baseline_key_drops_it(tmp_path: Path) -> None:
    store(tmp_path).enable()
    add_leftover_baseline(tmp_path)
    store(tmp_path).enable()
    assert "baseline" not in stored(tmp_path)


def test_a_store_stamped_newer_than_understood_is_refused_on_read(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps({"schema": 99}))
    with pytest.raises(AutopilotSchemaError):
        _ = store(tmp_path).enabled


def test_a_store_stamped_newer_than_understood_is_refused_on_write(tmp_path: Path) -> None:
    seed(tmp_path, json.dumps({"schema": 99}))
    with pytest.raises(AutopilotSchemaError):
        store(tmp_path).enable()


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


def test_switching_on_answers_switched_on(autopilot_api: ApiFactory) -> None:
    # the engine is sitting on the 30k corner, which auto-pilot no longer has
    # any opinion about at the moment it is switched on
    client = autopilot_api(filter_junk="2")
    assert client.post("/api/autopilot", json={"enabled": True}).json()["enabled"] is True


def test_switching_on_answers_no_baseline(autopilot_api: ApiFactory) -> None:
    client = autopilot_api(filter_junk="2")
    assert "baseline" not in client.post("/api/autopilot", json={"enabled": True}).json()


def test_reading_the_state_answers_what_was_stored(autopilot_api: ApiFactory) -> None:
    client = autopilot_api()
    client.post("/api/autopilot", json={"enabled": True})
    assert client.get("/api/autopilot").json()["enabled"] is True


def test_reading_the_state_answers_no_baseline(autopilot_api: ApiFactory) -> None:
    client = autopilot_api()
    client.post("/api/autopilot", json={"enabled": True})
    assert "baseline" not in client.get("/api/autopilot").json()


def test_setting_the_junk_filter_by_hand_switches_auto_pilot_off(autopilot_api: ApiFactory) -> None:
    client = autopilot_api()
    client.post("/api/autopilot", json={"enabled": True})
    client.post("/api/config/live", json={"fields": {"junk_filter": "1"}})
    assert client.get("/api/autopilot").json()["enabled"] is False


def test_a_live_write_of_the_main_filter_is_accepted(autopilot_api: ApiFactory) -> None:
    # the precondition the case below rests on: that write really does land, so
    # "auto-pilot survived it" is a fact about a write and not about a no-op
    client = autopilot_api()
    client.post("/api/autopilot", json={"enabled": True})
    assert client.post("/api/config/live", json={"fields": {"filter": "25"}}).json()["live"][0]["ok"] is True


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
    manager.presetops.autopilot.enable()
    await manager.presetops.save_preset("Studio")
    assert manager.presetops.autopilot.for_preset("Studio") is True


async def test_saving_a_general_preset_records_nothing_for_a_preset_it_did_not_save(
    http_manager_factory: Callable[..., ConnectionManager], http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    # a store that answered the same for every name would have recorded nothing
    manager = preset_manager(http_manager_factory, http_daemon, tmp_path)
    manager.presetops.autopilot.enable()
    await manager.presetops.save_preset("Studio")
    assert manager.presetops.autopilot.for_preset("Den") is False


async def test_loading_a_general_preset_restores_the_auto_pilot_state_it_was_saved_with(
    http_manager_factory: Callable[..., ConnectionManager], http_daemon: dict[str, Any], tmp_path: Path
) -> None:
    manager = preset_manager(http_manager_factory, http_daemon, tmp_path)
    manager.presetops.autopilot.enable()
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
    manager.presetops.autopilot.enable()
    await presetlane.autosave(manager)
    assert manager.presetops.autopilot.for_preset("Studio") is True
