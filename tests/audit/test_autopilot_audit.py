"""Auto-pilot's four off-switches, and the acting loop, in the audit log.

Auto-pilot is one stored flag a background task acts on, and four different code
paths can turn it off: the user's own switch, a hand write of the junk filter on
the live lane, applying a live preset saved without it, and loading a config
preset the store holds no flag for. A user who finds the switch off has no way to
tell which of the four did it unless the log says so, which is what ``source``
on the ``autopilot.set`` record is for.

Every case here drives the real REST route or the real ops entry point — never
``AuditLog``'s emitter methods, which would only assert the arguments the test
itself passed. The log is read back with a plain ``json.loads`` per line, the way
``test_audit_wiring`` reads it: a record only its own reader can parse is not a
forensic record.

The route cases run on both lanes at once, because a live junk-filter write needs
the 4321 control daemon and a config-preset load needs the 8088 one. The acting
case builds a manager the way ``tests/live/test_autopilot`` does — a real
``MeteringReader`` on the fake 4322 stream, fed a bounded batch of frames so the
advisor has earned a verdict — with the audit log pointed into ``tmp_path``.
"""

import asyncio
import json
from collections.abc import AsyncIterator, Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from conftest import DaemonFactory, eventually, wait_for_api
from fake_config_xml import cfg_xml
from fake_http import state
from fake_metering import MeteringStream
from fastapi.testclient import TestClient
from junk_spectra import FAKE_HIRES_FRAME

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.core.autopilotops import act
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.metering import MeteringReader, context_from
from hqptuner.presets.store.presets import PresetStore

#: The engine is reported playing a 96 kHz PCM track: the metering reader only
#: holds its socket while something plays (protocol.md §7).
METADATA_96K_PCM = '<metadata samplerate="96000" sdm="0"/>'

#: 60 frames at ~0.7 s of coverage apiece — past the advisor's minimum, and a
#: bounded batch, so the evidence is what crossed the socket rather than elapsed
#: wall clock.
COVERING_FRAMES = 60

#: The corner the fake-hi-res signature's verdict recommends, as the fake
#: daemon's built-in junk-filter enumeration names it.
RECOMMENDED = "20k"


async def _instant(_seconds: float) -> None:
    """The reader's idle re-check, paced by the loop instead of the clock."""
    await asyncio.sleep(0)


# --- reading the log back, independently of the module that writes it ---------


def records(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def last(path: Path, event: str) -> dict[str, Any]:
    """The most recent record of that event, or an empty one if it never came."""
    matching = [record for record in records(path) if record.get("event") == event]
    return matching[-1] if matching else {}


def highest_seq(path: Path) -> int:
    """The newest record's ``seq``, or 0 for a log nothing has written yet — a
    mark a case takes before the write it is actually interested in."""
    return max((int(record["seq"]) for record in records(path)), default=0)


def events_after(path: Path, mark: int) -> list[str]:
    """Every event recorded after the mark. Switching auto-pilot on records too,
    so a case about switching it off has to look past that."""
    return [str(record.get("event")) for record in records(path) if int(record["seq"]) > mark]


# --- the app: both lanes, with auto-pilot and the audit log in tmp_path -------


@pytest.fixture
def audit_log(tmp_path: Path) -> Path:
    return tmp_path / "audit.jsonl"


@pytest.fixture
def autopilot_client(
    http_daemon: dict[str, Any], threaded_daemon_port: int, tmp_path: Path, audit_log: Path
) -> Iterator[TestClient]:
    """The REST surface on both fakes at once — control on the threaded 4321
    daemon, config on the 8088 one — with every store under ``tmp_path`` so no
    case here writes into the repo's state directory."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=threaded_daemon_port,
        hqp_http_port=http_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
        autopilot_file=tmp_path / "autopilot.json",
        hqp_home="/x/home",
        debug_log=audit_log,
    )
    with TestClient(create_app(cfg)) as client:
        wait_for_api(client, lambda c: bool(c.get("/api/health").json()["reachable"]))
        yield client


def switch_on(client: TestClient) -> None:
    client.post("/api/autopilot", json={"enabled": True})


def strip_autopilot(tmp_path: Path, name: str) -> None:
    """Drop the ``autopilot`` key from a stored live preset — what a record saved
    by an HQPTuner that had no auto-pilot to record looks like."""
    path = tmp_path / "live-presets.json"
    store: dict[str, Any] = json.loads(path.read_text())
    store["presets"][name].pop("autopilot", None)
    path.write_text(json.dumps(store))


def seed_config_preset(tmp_path: Path, name: str) -> None:
    """A stored config preset written straight into the preset store, so the
    auto-pilot store holds no flag for it — the pre-auto-pilot preset."""
    PresetStore(tmp_path / "presets").save(name, cfg_xml(state(title="Office desk")))


# --- the switch ---------------------------------------------------------------


def test_switching_auto_pilot_off_appends_an_autopilot_set_record(
    autopilot_client: TestClient, audit_log: Path
) -> None:
    # past the mark, because switching it on records one too: a case reading the
    # whole file would pass on a build where switching off recorded nothing
    switch_on(autopilot_client)
    mark = highest_seq(audit_log)
    autopilot_client.post("/api/autopilot", json={"enabled": False})
    assert "autopilot.set" in events_after(audit_log, mark)


def test_switching_auto_pilot_off_records_the_switch_as_the_source(
    autopilot_client: TestClient, audit_log: Path
) -> None:
    # the question the record exists to answer: which of the four paths did it
    switch_on(autopilot_client)
    autopilot_client.post("/api/autopilot", json={"enabled": False})
    assert last(audit_log, "autopilot.set")["source"] == "switch"


def test_switching_off_a_store_that_was_on_records_the_previous_state(
    autopilot_client: TestClient, audit_log: Path
) -> None:
    # what it was before, not only what it became: a record of the new state
    # alone cannot tell a real change from a switch that was already off
    switch_on(autopilot_client)
    autopilot_client.post("/api/autopilot", json={"enabled": False})
    assert last(audit_log, "autopilot.set")["previous"] is True


# --- a live write of the junk filter -----------------------------------------


def test_a_live_junk_filter_write_records_the_live_write_source(autopilot_client: TestClient, audit_log: Path) -> None:
    # the user reached for the junk filter by hand, which takes auto-pilot off
    # its own control; nothing in the UI announces it, so the log is the trace
    switch_on(autopilot_client)
    autopilot_client.post("/api/config/live", json={"fields": {"junk_filter": "1"}})
    assert last(audit_log, "autopilot.set")["source"] == "live.write"


def test_a_live_junk_filter_write_records_auto_pilot_as_left_off(autopilot_client: TestClient, audit_log: Path) -> None:
    switch_on(autopilot_client)
    autopilot_client.post("/api/config/live", json={"fields": {"junk_filter": "1"}})
    assert last(audit_log, "autopilot.set")["enabled"] is False


def test_a_live_write_that_is_not_the_junk_filter_records_no_autopilot_set(
    autopilot_client: TestClient, audit_log: Path
) -> None:
    # auto-pilot survives a main-filter write, so there is nothing to record;
    # a log that recorded one anyway would name a change that never happened
    switch_on(autopilot_client)
    mark = highest_seq(audit_log)
    autopilot_client.post("/api/config/live", json={"fields": {"filter": "25"}})
    assert "autopilot.set" not in events_after(audit_log, mark)


# --- applying a live preset saved without auto-pilot -------------------------


def test_applying_a_live_preset_carrying_no_auto_pilot_key_records_its_source(
    autopilot_client: TestClient, audit_log: Path, tmp_path: Path
) -> None:
    # the switch record from switching on is already in the file, so the last
    # autopilot.set is this source only if the apply wrote one of its own
    switch_on(autopilot_client)
    autopilot_client.put("/api/livepresets/Warm")
    strip_autopilot(tmp_path, "Warm")
    autopilot_client.post("/api/livepresets/Warm/apply")
    assert last(audit_log, "autopilot.set")["source"] == "livepreset.apply"


# --- loading a config preset the auto-pilot store never recorded -------------


def test_loading_a_config_preset_with_no_stored_flag_records_its_source(
    autopilot_client: TestClient, audit_log: Path, tmp_path: Path
) -> None:
    seed_config_preset(tmp_path, "Office")
    switch_on(autopilot_client)
    autopilot_client.post("/api/profile/load", json={"name": "Office"})
    assert last(audit_log, "autopilot.set")["source"] == "preset.load"


# --- the acting loop ---------------------------------------------------------

Advising = Callable[..., Any]


@pytest.fixture
async def advising(daemon: DaemonFactory, tmp_path: Path, audit_log: Path) -> AsyncIterator[Advising]:
    """A running manager on the fake control daemon, its advisor fed a covering
    batch of metering frames off the fake 4322 stream, with the audit log in
    ``tmp_path`` — the ``advising`` fixture of tests/live/test_autopilot, logged."""
    started: list[tuple[ConnectionManager, asyncio.Task[None]]] = []
    readers: list[tuple[MeteringReader, asyncio.Task[None]]] = []
    streams: list[MeteringStream] = []

    async def build(frames: int = COVERING_FRAMES, **overrides: str) -> ConnectionManager:
        port, _log, _state = await daemon(state="2", _metadata=METADATA_96K_PCM, **overrides)
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
                debug_log=audit_log,
            )
        )
        task = asyncio.create_task(manager.run())
        started.append((manager, task))
        await eventually(lambda: manager.reachable)
        reader = MeteringReader("127.0.0.1", metering_port, lambda: context_from(manager), sleep=_instant)
        manager.metering = reader
        readers.append((reader, asyncio.create_task(reader.run())))
        if frames:
            stream.send(FAKE_HIRES_FRAME, count=frames)
            await eventually(lambda: reader.recommendation() is not None)
        return manager

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


async def test_engaging_a_recommended_junk_filter_records_what_it_moved_to(advising: Advising, audit_log: Path) -> None:
    # the acting loop writes with nobody watching, so the record naming the
    # filter it moved to is the only account of why the engine changed
    manager = await advising()
    manager.presetops.autopilot.enable()
    await act(manager)
    assert last(audit_log, "autopilot.act")["want"] == RECOMMENDED
