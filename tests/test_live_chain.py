"""The per-chain filter/shaper memory LIVE keeps for the engine.

`GetFilters`/`GetShapers` enumerate the ACTIVE mode's chain only, and the two
chains number the same names differently — `poly-sinc-gauss-long` is enum ID 40
under PCM `filter` and 38 under SDM `oversampling` (protocol.md §4, readme
§1.5/§1.6). So the engine can only be told about the chain it has loaded, while
the LIVE page shows both: an edit to the dormant chain is HELD and put back on
the wire the moment that chain loads, resolved against the ENTERED chain's list
(the config form and hqplayerd.xml speak enum IDs, `Set*` speaks list indices,
and "the two domains must never be mixed").

Everything here runs against the stateful fake daemon over a real socket — the
assertions are on what the daemon reports afterwards, on the traffic that
reached it, and on what the config side is told, never on how any of it was
produced (docs/testing.md).
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from pathlib import Path

import pytest
from conftest import CommandLog, LiveManager, eventually, spawn_threaded_daemon, wait_for_api
from fake_control import DEFAULTS, serve
from fastapi.testclient import TestClient

from hqptuner.api import create_app
from hqptuner.config import Config
from hqptuner.lanes import livelane, liveoverrides
from hqptuner.manager import ConnectionManager

#: A manager whose daemon connections a test can cut with the listener left up.
SeverableManager = tuple[ConnectionManager, Callable[[], Awaitable[None]]]


@pytest.fixture
async def severable_manager() -> AsyncIterator[SeverableManager]:
    """A manager on a fake daemon whose open connections a test can sever while
    the listener stays up — hqplayerd restarting under HQPTuner, which is what
    makes the manager remake its connection. The severing is at the wire: the
    server-side transports are closed, never anything on the manager."""
    writers: list[asyncio.StreamWriter] = []
    state = dict(DEFAULTS)

    async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        writers.append(writer)
        await serve(reader, writer, state=state)

    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]
    manager = ConnectionManager(Config(hqp_host="127.0.0.1", hqp_control_port=port, poll_interval=0.02))
    task = asyncio.create_task(manager.run())
    await eventually(lambda: manager.reachable)

    async def sever() -> None:
        for writer in writers:
            writer.close()
        writers.clear()

    yield manager, sever
    manager.stop()
    await task
    await manager.aclose()
    server.close()
    # the writers list pins the server-side transports, so wait_closed() only
    # returns once they are explicitly closed (test_manager_connection.py)
    for writer in writers:
        writer.close()
    await server.wait_closed()


def _reachable(client: TestClient) -> bool:
    return bool(client.get("/api/health").json()["reachable"])


def _live_app(control_port: int, tmp_path: Path) -> Iterator[TestClient]:
    """Control lane only — no credentials, so the app talks 4321 alone."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=control_port,
        hqp_username="",
        hqp_password="",
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
    )
    with TestClient(create_app(cfg)) as client:
        wait_for_api(client, _reachable)
        yield client


@pytest.fixture
def chain_api(tmp_path: Path) -> Iterator[Callable[..., TestClient]]:
    """Build the control-only app on a fake daemon carrying the given State and
    Status overrides (the pattern in test_api_routes.py): which chain the engine
    has loaded is a different daemon situation per case."""
    daemons: list[Iterator[int]] = []
    apps: list[Iterator[TestClient]] = []

    def build(**overrides: str) -> TestClient:
        daemon = spawn_threaded_daemon(overrides)
        daemons.append(daemon)
        app = _live_app(next(daemon), tmp_path)
        apps.append(app)
        return next(app)

    yield build
    for app in apps:
        next(app, None)
    for daemon in daemons:
        next(daemon, None)


def _filter_writes(log: CommandLog) -> list[str]:
    """The `FiltersItem` index each `SetFilter` carried, in order."""
    return [attrs.get("value", "") for name, attrs in log if name == "SetFilter"]


def _shaper_writes(log: CommandLog) -> list[str]:
    return [attrs.get("value", "") for name, attrs in log if name == "SetShaping"]


# --- an edit to the chain the engine has not loaded ---------------------------
# The engine cannot be told about it, so it is held rather than refused: the LIVE
# page shows both chains and has no Apply button to come back to.


@pytest.mark.parametrize(("field", "value"), [("oversampling1x", "38"), ("oversampling", "23"), ("modulator", "3")])
def test_an_edit_to_the_dormant_sdm_chain_is_accepted(
    chain_api: Callable[..., TestClient], field: str, value: str
) -> None:
    client = chain_api(mode="1")
    assert client.post("/api/config/live", json={"fields": {field: value}}).status_code == 200


@pytest.mark.parametrize(("field", "value"), [("oversampling1x", "38"), ("oversampling", "23"), ("modulator", "3")])
def test_an_edit_to_the_dormant_sdm_chain_is_reported_as_held(
    chain_api: Callable[..., TestClient], field: str, value: str
) -> None:
    client = chain_api(mode="1")
    resp = client.post("/api/config/live", json={"fields": {field: value}})
    assert resp.json()["stored"] == {field: value}


@pytest.mark.parametrize(("field", "value"), [("filter1x", "40"), ("filter", "25"), ("dither", "5")])
def test_an_edit_to_the_dormant_pcm_chain_is_reported_as_held(
    chain_api: Callable[..., TestClient], field: str, value: str
) -> None:
    client = chain_api(mode="2")
    resp = client.post("/api/config/live", json={"fields": {field: value}})
    assert resp.json()["stored"] == {field: value}


def test_a_held_filter_edit_leaves_the_running_filter_alone(chain_api: Callable[..., TestClient]) -> None:
    # enum 23 is `sinc-M` on the SDM chain and index 1 there; the PCM chain the
    # engine is running has `sinc-M` at index 2. A held edit that leaked onto the
    # wire would move the filter the listener is hearing, either way.
    client = chain_api(mode="1", filterNx="2")
    client.post("/api/config/live", json={"fields": {"oversampling": "23"}})
    assert client.get("/api/state").json()["data"]["filterNx"] == "2"


def test_a_held_shaper_edit_leaves_the_running_shaper_alone(chain_api: Callable[..., TestClient]) -> None:
    # enum 5 is `NS9`, index 1 of the dormant PCM shaper list and absent from the
    # SDM list the engine is running. The engine sits at index 0, so a leak
    # resolved against either chain's list moves it.
    client = chain_api(mode="2", shaper="0")
    client.post("/api/config/live", json={"fields": {"dither": "5"}})
    assert client.get("/api/state").json()["data"]["shaper"] == "0"


@pytest.mark.parametrize(("field", "value"), [("filter", "40"), ("oversampling", "23")])
def test_an_edit_is_held_when_no_chain_can_be_named(
    chain_api: Callable[..., TestClient], field: str, value: str
) -> None:
    # [source] mode before playback starts: the configured mode cannot say which
    # chain is loaded and Status has no active mode to offer either, so NEITHER
    # chain's edit can be resolved — holding both beats refusing the page.
    client = chain_api(mode="0", _active_mode="")
    resp = client.post("/api/config/live", json={"fields": {field: value}})
    assert resp.json()["stored"] == {field: value}


# --- an edit to the chain the engine IS running -------------------------------


def test_an_edit_to_the_loaded_chain_is_reported_as_applied(chain_api: Callable[..., TestClient]) -> None:
    client = chain_api(mode="1")
    resp = client.post("/api/config/live", json={"fields": {"filter": "40"}})
    assert resp.json()["live"] == [{"setting": "filter", "ok": True}]


def test_an_edit_to_the_loaded_chain_holds_nothing(chain_api: Callable[..., TestClient]) -> None:
    client = chain_api(mode="1")
    resp = client.post("/api/config/live", json={"fields": {"filter": "40"}})
    assert resp.json()["stored"] == {}


# --- what the config side is told ---------------------------------------------


async def test_a_held_edit_is_reported_as_a_config_setting(live_manager: LiveManager) -> None:
    # The rest of the app reads the engine's live settings as config-form fields,
    # so what LIVE set on the dormant chain has to reach it the same way.
    manager, _, _ = await live_manager()
    await livelane.apply_now(manager, {"oversampling": "23"})
    assert liveoverrides.live_overrides(manager)["oversampling"] == "23"


async def test_the_engines_own_filter_outranks_a_held_one(live_manager: LiveManager) -> None:
    # For the chain the engine is running, the engine is the truth. The move is
    # made from OUTSIDE HQPTuner — a `SetFilter` no LIVE write issued — so the
    # engine reports index 1 (enum 40) while nothing told the memory anything.
    manager, _, _ = await live_manager(poll_interval=0.02, mode="2")
    await livelane.apply_now(manager, {"filter": "25"})  # held: PCM chain is dormant
    await livelane.apply_now(manager, {"mode": "pcm"})  # 25 goes on the wire here
    await manager.control.set_command("SetFilter", value="1")
    await eventually(lambda: manager.state.get("filterNx") == "1")  # the poll has seen it
    assert liveoverrides.live_overrides(manager)["filter"] == "40"


# --- putting the held edit back when its chain loads --------------------------


async def test_entering_a_chain_writes_the_held_filter_at_the_entered_chains_index(live_manager: LiveManager) -> None:
    # enum 23 is `sinc-M`, index 1 of the SDM list. The PCM list the engine
    # offered BEFORE the switch carries `sinc-M` at index 2 under a different
    # enum ID, so an index resolved against it lands on a different filter.
    manager, log, _ = await live_manager()
    await livelane.apply_now(manager, {"oversampling": "23"})
    log.clear()
    await livelane.apply_now(manager, {"mode": "sdm"})
    assert _filter_writes(log) == ["1"]


async def test_entering_a_chain_writes_the_held_shaper_at_the_entered_chains_index(live_manager: LiveManager) -> None:
    # The shaper half of the same fact: enum 3 is `ASDM7EC` at index 1 of the SDM
    # list and appears nowhere in the PCM one.
    manager, log, _ = await live_manager()
    await livelane.apply_now(manager, {"modulator": "3"})
    log.clear()
    await livelane.apply_now(manager, {"mode": "sdm"})
    assert _shaper_writes(log) == ["1"]


async def test_a_held_value_the_entered_chain_lacks_is_never_written(live_manager: LiveManager) -> None:
    # enum 40 is the PCM chain's `poly-sinc-gauss-long`; the SDM chain numbers
    # that filter 38. Writing the nearest thing would be a filter the user never
    # picked, so nothing goes out at all.
    manager, log, _ = await live_manager()
    await livelane.apply_now(manager, {"oversampling": "40"})
    log.clear()
    await livelane.apply_now(manager, {"mode": "sdm"})
    assert _filter_writes(log) == []


async def test_a_held_value_is_reported_until_its_chain_comes_round(live_manager: LiveManager) -> None:
    # The near side of the transition below, on the same value: while the SDM
    # chain is dormant, enum 40 is held and reported however unplaceable it will
    # turn out to be — nothing can know that until the chain loads.
    manager, _, _ = await live_manager()
    await livelane.apply_now(manager, {"oversampling": "40"})
    assert liveoverrides.live_overrides(manager)["oversampling"] == "40"


async def test_a_held_value_the_entered_chain_lacks_is_forgotten(live_manager: LiveManager) -> None:
    # Once the chain has come round and the value could not be placed, it is gone
    # — the config side must stop being told about it when the chain goes dormant
    # again, or the page would keep showing an edit the engine refused.
    manager, _, _ = await live_manager()
    await livelane.apply_now(manager, {"oversampling": "40"})
    await livelane.apply_now(manager, {"mode": "sdm"})
    await livelane.apply_now(manager, {"mode": "pcm"})
    assert "oversampling" not in liveoverrides.live_overrides(manager)


async def test_a_held_edit_does_not_survive_the_connection_being_remade(
    severable_manager: SeverableManager,
) -> None:
    # A LIVE setting lasts only until the daemon restarts: the engine that comes
    # back has none of it, so holding an edit for it would be describing a
    # machine that no longer exists.
    manager, sever = severable_manager
    await livelane.apply_now(manager, {"oversampling": "23"})
    before = manager.loaded_at
    await sever()
    # Waits on `loaded_at`, not on the reachable flag, because the flag is not
    # observable: `manager._connect_and_load` lowers it and raises it again within
    # one handshake, so a 10 ms sampler can miss the entire window and time out on
    # a reconnect that did happen — which is how this test failed in CI while
    # passing locally. `loaded_at` is stamped once per handshake and never reverts,
    # so it is the same event with no race in reading it.
    await eventually(lambda: manager.loaded_at != before)
    assert "oversampling" not in liveoverrides.live_overrides(manager)


# --- the chain changing under a mode that never moved -------------------------
# `[source]` follows the source (readme §1.7): a track in the other family loads
# the other chain with no command sent and the configured mode standing still.
# The daemon's State is written directly here because that is what it is — a
# change on the daemon's side of the wire that HQPTuner did not cause.


async def test_a_source_change_serves_the_entered_chains_filters(live_manager: LiveManager) -> None:
    # The SDM chain numbers `poly-sinc-gauss-long` 38 and `sinc-M` 23; the PCM
    # chain it left numbers them 40 and 25 with a `none` ahead of both, so the
    # list being served says without ambiguity which chain was enumerated.
    manager, _, state = await live_manager(poll_interval=0.02, mode="0", _active_mode="PCM")
    state["_active_mode"] = "SDM (DSD)"
    await eventually(lambda: [i["value"] for i in (manager.enums or {}).get("filters", [])] == ["38", "23"])
    assert [i["value"] for i in manager.enums["filters"]] == ["38", "23"]


async def test_a_source_change_serves_the_entered_chains_shapers(live_manager: LiveManager) -> None:
    # The shaper half: the SDM chain's modulators are enum 0/3, the PCM chain's
    # dithers 0/5, so a lane that re-pulled the filters alone fails here.
    manager, _, state = await live_manager(poll_interval=0.02, mode="0", _active_mode="PCM")
    state["_active_mode"] = "SDM (DSD)"
    await eventually(lambda: [i["value"] for i in (manager.enums or {}).get("shapers", [])] == ["0", "3"])
    assert [i["value"] for i in manager.enums["shapers"]] == ["0", "3"]


async def test_a_source_change_writes_the_edit_held_for_the_chain_it_loaded(live_manager: LiveManager) -> None:
    # The held edit is put back by the chain being ENTERED, not by the mode being
    # written: no SetMode is sent here at all. enum 23 is index 1 of the SDM list
    # and index 2's `sinc-M` on the PCM list the engine was enumerating when the
    # edit was made.
    manager, log, state = await live_manager(poll_interval=0.02, mode="0", _active_mode="PCM")
    await livelane.apply_now(manager, {"oversampling": "23"})
    log.clear()
    state["_active_mode"] = "SDM (DSD)"
    await eventually(lambda: _filter_writes(log) == ["1"])
    assert _filter_writes(log) == ["1"]


# --- what is still refused ----------------------------------------------------


def test_a_value_in_no_list_the_loaded_chain_offers_is_refused(chain_api: Callable[..., TestClient]) -> None:
    # Holding is for the chain the engine cannot answer for. For the chain it CAN
    # answer for, a value its list does not carry is an error, not a memory.
    client = chain_api(mode="2")
    assert client.post("/api/config/live", json={"fields": {"oversampling": "9999"}}).status_code == 409


def test_a_mode_change_cannot_be_batched_with_a_chain_edit(chain_api: Callable[..., TestClient]) -> None:
    # SetMode swaps the enumerations the rest of the batch was resolved against,
    # so those indices would be stale by the time their setter ran — true whether
    # the chain edit would have applied or been held.
    client = chain_api(mode="1")
    resp = client.post("/api/config/live", json={"fields": {"mode": "sdm", "filter": "40"}})
    assert resp.status_code == 409
