"""Auto-pilot's four off-switches, and the acting loop, in the audit log.

Auto-pilot is one stored flag a background task acts on, and four different code
paths can turn it off: the user's own switch, a hand write of the junk filter on
the live lane, applying a live snapshot saved without it, and loading a config
preset the store holds no flag for. A user who finds the switch off has no way to
tell which of the four did it unless the log says so, which is what ``source``
on the ``autopilot.set`` record is for.

Every case here drives the real REST route or the real ops entry point — never
``AuditLog``'s emitter methods, which would only assert the arguments the test
itself passed. The log is read back with a plain ``json.loads`` per line, the way
``test_audit_wiring`` reads it: a record only its own reader can parse is not a
forensic record.

The route cases run on both lanes at once, because a live junk-filter write needs
the 4321 control daemon and a config-preset load needs the 8088 one.
"""

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from audit_records import last, records
from conftest import wait_for_api
from fake_config_xml import cfg_xml
from fake_http import state
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.presets.store.presets import PresetStore

#: The volume trace's records all carry a `volume.`-prefixed event, and it takes
#: its observations on checkpoints across the app rather than on this suite's
#: subject.
VOLUME_EVENT_PREFIX = "volume."


# --- reading the log back, independently of the module that writes it ---------
#
# `records` and `last` are the shared readers in tests/support/audit_records.py;
# what is local here is the marking, because every case below runs after a
# switch that recorded a record of its own.


def highest_seq(path: Path) -> int:
    """The newest record's ``seq``, or 0 for a log nothing has written yet — a
    mark a case takes before the write it is actually interested in."""
    return max((int(record["seq"]) for record in records(path)), default=0)


def events_after(path: Path, mark: int) -> list[str]:
    """Every event recorded after the mark. Switching auto-pilot on records too,
    so a case about switching it off has to look past that."""
    return [str(record.get("event")) for record in records(path) if int(record["seq"]) > mark]


def events_after_excluding_volume(path: Path, mark: int) -> list[str]:
    """``events_after`` with the volume trace's own records dropped. The trace
    observes the volume at checkpoints of its own choosing, on paths that have
    nothing to do with auto-pilot's off-switches; a case about those switches
    sets its records aside rather than pinning where it happens to fire."""
    return [event for event in events_after(path, mark) if not event.startswith(VOLUME_EVENT_PREFIX)]


def first_after(path: Path, mark: int, event: str) -> dict[str, Any]:
    """The first record of that event past the mark, or an empty one if none
    came. Never the newest record in the file: switching auto-pilot on goes
    through the same route and records its own `autopilot.set` with the same
    `switch` source, so a case reading the newest record would pass against a
    build where switching OFF recorded nothing at all."""
    for record in records(path):
        if int(record["seq"]) > mark and record.get("event") == event:
            return record
    return {}


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
    """Drop the ``autopilot`` key from a stored live snapshot — what a record saved
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
    # the question the record exists to answer: which of the four paths did it.
    # Read past the mark, never off the newest record: switching ON records its
    # own `switch` record, which would answer this case for a build where
    # switching off recorded nothing.
    switch_on(autopilot_client)
    mark = highest_seq(audit_log)
    autopilot_client.post("/api/autopilot", json={"enabled": False})
    assert first_after(audit_log, mark, "autopilot.set")["source"] == "switch"


def test_switching_off_a_store_that_was_on_records_the_previous_state(
    autopilot_client: TestClient, audit_log: Path
) -> None:
    # what it was before, not only what it became: a record of the new state
    # alone cannot tell a real change from a switch that was already off
    switch_on(autopilot_client)
    mark = highest_seq(audit_log)
    autopilot_client.post("/api/autopilot", json={"enabled": False})
    assert first_after(audit_log, mark, "autopilot.set")["previous"] is True


def test_switching_off_a_store_that_was_already_off_records_the_previous_state(
    autopilot_client: TestClient, audit_log: Path
) -> None:
    # the pairing case: an implementation that never reads the store and writes
    # `previous` as the negation of what was asked for answers True here too,
    # and only a switch-off against an already-off store tells the two apart
    mark = highest_seq(audit_log)
    autopilot_client.post("/api/autopilot", json={"enabled": False})
    assert first_after(audit_log, mark, "autopilot.set")["previous"] is False


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
    # a log that recorded one anyway would name a change that never happened.
    # Asserted as the write's own record ALONE rather than as an absence: a
    # write the daemon never accepted would satisfy an absence for free. The
    # volume trace's records are set aside first, so the list stays positive
    # without pinning a second subsystem's checkpoints.
    switch_on(autopilot_client)
    mark = highest_seq(audit_log)
    autopilot_client.post("/api/config/live", json={"fields": {"filter": "25"}})
    assert events_after_excluding_volume(audit_log, mark) == ["live.write"]


# --- applying a live snapshot saved without auto-pilot -------------------------


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
