"""The audit log the existing write paths feed (docs/testing.md).

Every write HQPTuner makes is supposed to leave a JSONL record behind, one per
line, under an envelope of ``ts``/``seq``/``event`` plus the event's own fields.
These cases drive the real REST surface against the faithful fake 8088 daemon
and read the file back with a plain ``json.loads`` per line, never through the
audit module's own reader — a log nothing but its own reader can parse is not a
forensic record.

The file exists to answer one question after a bad apply: *what was staged when
the user pressed Apply*. The pending buffer is cleared by a successful apply, so
``test_the_apply_record_carries_the_staged_value_the_apply_itself_cleared`` is
the load-bearing case here: it can only pass if the record was captured at
entry, and it asserts the staged *value*, because a log of field names with no
payload answers nothing.
"""

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from conftest import wait_for_api
from fake_config_xml import cfg_xml
from fake_http import state
from fastapi.testclient import TestClient

from hqptuner.api import create_app
from hqptuner.config import Config
from hqptuner.presets.presetstore import PresetStore

#: The daemon credential the app is built with — distinctive enough that finding
#: it anywhere in the log is unambiguous.
CREDENTIAL = "s3cr3t-hqp-passphrase"

#: The value staged into a field literally keyed ``password`` — what a redactor
#: has to keep out of the file.
NEVER_LOG_ME = "hunter2-do-not-log-me"

ROW0 = {"source": "0", "gain": "0", "gainunit": "dB", "mixdown": "0", "process": ""}
ROW1 = {"source": "1", "gain": "-3", "gainunit": "dB", "mixdown": "1", "process": ""}


# --- the app under test, with and without a debug log -------------------------


def _app(daemon: dict[str, Any], tmp_path: Path, port: int, debug_log: Path | None) -> Iterator[TestClient]:
    """The REST surface on the fake 8088 daemon (the `http_client` shape), with
    the audit log pointed wherever the case wants it — or disabled."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=port,
        hqp_http_port=daemon["_port"],
        hqp_username="u",
        hqp_password=CREDENTIAL,
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        hqp_home="/x/home",
        debug_log=debug_log,
    )
    with TestClient(create_app(cfg)) as client:
        yield client


@pytest.fixture
def audit_log(tmp_path: Path) -> Path:
    return tmp_path / "audit.jsonl"


@pytest.fixture
def audit_client(
    http_daemon: dict[str, Any], tmp_path: Path, closed_port: int, audit_log: Path
) -> Iterator[TestClient]:
    yield from _app(http_daemon, tmp_path, closed_port, audit_log)


@pytest.fixture
def unlogged_client(http_daemon: dict[str, Any], tmp_path: Path, closed_port: int) -> Iterator[TestClient]:
    """The same app with the audit log unset — the disabled case."""
    yield from _app(http_daemon, tmp_path, closed_port, None)


@pytest.fixture
def dual_lane_client(
    http_daemon: dict[str, Any], threaded_daemon_port: int, tmp_path: Path, audit_log: Path
) -> Iterator[TestClient]:
    """Both lanes at once — control on the threaded fake 4321 daemon, http on
    the fake 8088 one — which is what a live control-lane write needs before it
    can happen at all (the `_dual_lane_client` shape in tests/presets)."""
    for client in _app(http_daemon, tmp_path, threaded_daemon_port, audit_log):
        wait_for_api(client, lambda c: bool(c.get("/api/health").json()["reachable"]))
        yield client


# --- reading the log back, independently of the module that writes it ---------


def records(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def events(path: Path) -> list[str]:
    return [str(rec.get("event")) for rec in records(path)]


def last(path: Path, event: str) -> dict[str, Any]:
    """The most recent record of that event, or an empty one if it never came."""
    matching = [rec for rec in records(path) if rec.get("event") == event]
    return matching[-1] if matching else {}


def profile_targets(path: Path) -> list[Any]:
    """Every ``profile.write`` record's ``target`` — where that write landed.
    Compared by equality, never by substring: the seeded preset's own title
    contains its name, so a substring test over a record would pass on the
    running-config write too."""
    return [rec.get("target") for rec in records(path) if rec.get("event") == "profile.write"]


def stray_files(root: Path) -> list[str]:
    """Everything under the app's directories that is not one of its documented
    artefacts — the pre-apply backup archive and the preset store. Any other
    file the app wrote is a log by another name."""
    return sorted(
        str(p.relative_to(root))
        for p in root.rglob("*")
        if p.is_file() and p.name != "pre-apply-settings.zip" and "presets" not in p.relative_to(root).parts
    )


# --- driving the write paths --------------------------------------------------


def stage_title(client: TestClient, value: str = "Renamed") -> None:
    client.post("/api/config/stage", json={"http": {"title": value}})


def apply_profile_save(client: TestClient, name: str, *rows: dict[str, str], presets: list[str] | None = None) -> None:
    """Stage the matrix profile-save verb the way the UI does (an http-lane
    field carrying a JSON payload) and apply it."""
    payload: dict[str, Any] = {"name": name, "rows": list(rows) or [ROW0]}
    if presets is not None:
        payload["presets"] = presets
    client.post("/api/config/stage", json={"http": {"matrix_profile_save": json.dumps(payload)}})
    client.post("/api/config/apply")


def seed_preset(tmp_path: Path, name: str = "Office") -> None:
    """A stored preset for a fan-out to land in — a full 6.0.4-shaped snapshot."""
    PresetStore(tmp_path / "presets").save(name, cfg_xml(state(title="Office desk")))


def arm_autosave(client: TestClient, name: str = "Kept") -> None:
    client.post("/api/profile/save", json={"name": name})
    client.post("/api/autosave", json={"enabled": True})


# --- the log is off unless asked for -----------------------------------------


def test_an_unset_debug_log_writes_no_audit_file_at_all(unlogged_client: TestClient, tmp_path: Path) -> None:
    # a full stage-then-apply cycle leaves the app's own directories carrying
    # nothing but the artefacts it legitimately owns — checked by what is there
    # rather than by a name a log would have to be unlucky enough to use
    stage_title(unlogged_client)
    unlogged_client.post("/api/config/apply")
    assert stray_files(tmp_path) == []


# --- staging ------------------------------------------------------------------


def test_staging_an_edit_appends_a_stage_record(audit_client: TestClient, audit_log: Path) -> None:
    stage_title(audit_client)
    assert "stage" in events(audit_log)


def test_the_stage_record_carries_the_staged_http_value(audit_client: TestClient, audit_log: Path) -> None:
    # the value, not just the field name: a log of names with no payload cannot
    # answer what the user actually asked the daemon to do
    stage_title(audit_client, "Renamed")
    assert last(audit_log, "stage")["http"]["title"] == "Renamed"


# --- discard ------------------------------------------------------------------


def test_discarding_the_pending_buffer_appends_a_discard_record(audit_client: TestClient, audit_log: Path) -> None:
    stage_title(audit_client)
    audit_client.delete("/api/config/pending")
    assert "discard" in events(audit_log)


def test_the_discard_record_carries_the_http_value_it_destroyed(audit_client: TestClient, audit_log: Path) -> None:
    # the discard is the one operation whose whole effect is to make the buffer
    # unreadable, so the record is the only surviving copy of what was thrown
    # away — which means the value, not merely the field name
    stage_title(audit_client, "Abandoned")
    audit_client.delete("/api/config/pending")
    assert last(audit_log, "discard")["http"]["title"] == "Abandoned"


# --- apply --------------------------------------------------------------------


def test_a_successful_apply_appends_an_apply_record(audit_client: TestClient, audit_log: Path) -> None:
    stage_title(audit_client)
    audit_client.post("/api/config/apply")
    assert "apply" in events(audit_log)


def test_the_apply_record_carries_the_staged_value_the_apply_itself_cleared(
    audit_client: TestClient, audit_log: Path
) -> None:
    # THE forensic case. A successful apply empties the pending buffer, so a
    # record built from the buffer after the apply ran would carry nothing; the
    # staged value can only appear here if the record was captured at entry —
    # and it is the value that says what the daemon was asked to become.
    stage_title(audit_client, "Renamed")
    audit_client.post("/api/config/apply")
    assert last(audit_log, "apply")["http"]["title"] == "Renamed"


def test_a_successful_apply_records_the_outcome_as_ok(audit_client: TestClient, audit_log: Path) -> None:
    stage_title(audit_client)
    audit_client.post("/api/config/apply")
    assert last(audit_log, "apply")["ok"] is True


def test_the_apply_record_names_the_preset_the_apply_switched_to(audit_client: TestClient, audit_log: Path) -> None:
    # switching preset is the write with the largest blast radius — the whole
    # config changes — so which preset was loaded belongs in the same record
    audit_client.post("/api/profile/save", json={"name": "Kept"})
    audit_client.post("/api/config/apply", json={"switch_to": "Kept"})
    assert last(audit_log, "apply")["switch_to"] == "Kept"


# --- the apply that did not work: the reason anyone opens this file ------------
#
# The fake daemon refuses the literal value "REJECT" on restore while still
# answering HTTP 200 (fake_http, the 6.0.4 contract), so the apply comes back
# not-applied without an exception — the soft failure the log has to explain.


def test_a_refused_apply_records_the_outcome_as_not_ok(audit_client: TestClient, audit_log: Path) -> None:
    stage_title(audit_client, "REJECT")
    audit_client.post("/api/config/apply")
    assert last(audit_log, "apply")["ok"] is False


def test_a_refused_apply_still_records_the_staged_payload(audit_client: TestClient, audit_log: Path) -> None:
    # a record that only carries the failure and not the payload leaves the
    # reader knowing an apply broke and nothing about what it tried to do
    stage_title(audit_client, "REJECT")
    audit_client.post("/api/config/apply")
    assert last(audit_log, "apply")["http"]["title"] == "REJECT"


# --- matrix profile writes ----------------------------------------------------


def test_an_applied_profile_save_appends_a_profile_write_record(audit_client: TestClient, audit_log: Path) -> None:
    apply_profile_save(audit_client, "Crossfeed EQ", ROW0, ROW1)
    assert "profile.write" in events(audit_log)


def test_the_profile_write_record_names_the_saved_profile(audit_client: TestClient, audit_log: Path) -> None:
    apply_profile_save(audit_client, "Crossfeed EQ", ROW0, ROW1)
    assert last(audit_log, "profile.write")["name"] == "Crossfeed EQ"


def test_a_profile_save_over_an_existing_name_records_it_as_replaced(audit_client: TestClient, audit_log: Path) -> None:
    apply_profile_save(audit_client, "Crossfeed EQ", ROW0)
    apply_profile_save(audit_client, "Crossfeed EQ", ROW0, ROW1)
    assert last(audit_log, "profile.write")["replaced"] is True


def test_a_profile_save_under_a_new_name_records_it_as_not_replaced(audit_client: TestClient, audit_log: Path) -> None:
    apply_profile_save(audit_client, "Brand New", ROW0)
    assert last(audit_log, "profile.write")["replaced"] is False


def test_a_fanned_out_profile_write_names_the_stored_preset_it_landed_in(
    audit_client: TestClient, audit_log: Path, tmp_path: Path
) -> None:
    # a write into the stored preset "Office" must be tellable apart from the
    # write into the running config; the target is what tells them apart, and it
    # says which of the two it was — "config" there, "preset:<name>" here
    # (docs/architecture.md §8), so one pass over a mixed log reads both
    seed_preset(tmp_path)
    apply_profile_save(audit_client, "Crossfeed EQ", ROW0, presets=["Office"])
    assert "preset:Office" in profile_targets(audit_log)


# --- preset writes, by what triggered them ------------------------------------


def test_an_explicit_preset_save_records_the_save_trigger(audit_client: TestClient, audit_log: Path) -> None:
    audit_client.post("/api/profile/save", json={"name": "Studio"})
    assert last(audit_log, "preset.write")["trigger"] == "save"


def test_an_autosaved_apply_records_the_autosave_trigger(audit_client: TestClient, audit_log: Path) -> None:
    arm_autosave(audit_client)
    stage_title(audit_client)
    audit_client.post("/api/config/apply")
    assert last(audit_log, "preset.write")["trigger"] == "autosave"


def test_a_profile_fanout_into_a_stored_preset_records_the_fanout_trigger(
    audit_client: TestClient, audit_log: Path, tmp_path: Path
) -> None:
    seed_preset(tmp_path)
    apply_profile_save(audit_client, "Crossfeed EQ", ROW0, presets=["Office"])
    assert last(audit_log, "preset.write")["trigger"] == "fanout"


# --- the other write paths, one wiring case each ------------------------------


def test_an_applied_profile_delete_appends_a_profile_delete_record(audit_client: TestClient, audit_log: Path) -> None:
    # destructive and silent: a profile the user cannot find afterwards is only
    # explainable if the deletion left a record
    apply_profile_save(audit_client, "Crossfeed EQ", ROW0)
    audit_client.post("/api/config/stage", json={"http": {"matrix_profile_delete": "Crossfeed EQ"}})
    audit_client.post("/api/config/apply")
    assert "profile.delete" in events(audit_log)


def test_deleting_a_stored_preset_appends_a_preset_delete_record(audit_client: TestClient, audit_log: Path) -> None:
    audit_client.post("/api/profile/save", json={"name": "Doomed"})
    audit_client.delete("/api/preset/Doomed")
    assert "preset.delete" in events(audit_log)


def test_loading_a_preset_appends_a_preset_load_record(audit_client: TestClient, audit_log: Path) -> None:
    audit_client.post("/api/profile/save", json={"name": "Kept"})
    audit_client.post("/api/profile/load", json={"name": "Kept"})
    assert "preset.load" in events(audit_log)


def test_switching_the_active_preset_appends_an_active_set_record(audit_client: TestClient, audit_log: Path) -> None:
    audit_client.post("/api/profile/save", json={"name": "Kept"})
    audit_client.post("/api/config/apply", json={"switch_to": "Kept"})
    assert "active.set" in events(audit_log)


def test_turning_autosave_on_appends_an_autosave_set_record(audit_client: TestClient, audit_log: Path) -> None:
    audit_client.post("/api/autosave", json={"enabled": True})
    assert "autosave.set" in events(audit_log)


def test_uploading_a_settings_archive_appends_a_restore_upload_record(
    audit_client: TestClient, audit_log: Path
) -> None:
    # the biggest blast radius in the app: one upload replaces the whole config
    archive = audit_client.get("/api/backup").content
    audit_client.post("/api/restore", files={"cfgfile": ("settings.zip", archive, "application/zip")})
    assert "restore.upload" in events(audit_log)


def test_a_live_control_lane_write_appends_a_live_write_record(dual_lane_client: TestClient, audit_log: Path) -> None:
    # a live write never touches the config file, so the log is the only place
    # it is ever recorded
    dual_lane_client.post("/api/config/live", json={"fields": {"filter": "25"}})
    assert "live.write" in events(audit_log)


# --- what must never be in the file ------------------------------------------


def test_a_staged_secret_valued_field_is_not_written_to_the_log_verbatim(
    audit_client: TestClient, audit_log: Path
) -> None:
    # a field literally keyed `password` is the shape the redactor exists for.
    # The record is indexed, not the whole file, so a stage that never recorded
    # at all raises here instead of passing this test by absence.
    audit_client.post("/api/config/stage", json={"http": {"password": NEVER_LOG_ME}})
    assert NEVER_LOG_ME not in json.dumps(last(audit_log, "stage")["http"])


def test_the_audit_log_never_carries_the_daemon_credential(
    audit_client: TestClient, audit_log: Path, tmp_path: Path
) -> None:
    # every write path this file covers, through one app, then the whole file
    seed_preset(tmp_path)
    arm_autosave(audit_client)
    stage_title(audit_client)
    audit_client.post("/api/config/apply")
    apply_profile_save(audit_client, "Crossfeed EQ", ROW0, presets=["Office"])
    stage_title(audit_client, "Discarded")
    audit_client.delete("/api/config/pending")
    assert CREDENTIAL not in audit_log.read_text(encoding="utf-8")
