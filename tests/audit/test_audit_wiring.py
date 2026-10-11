"""The audit log the existing write paths feed.

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
from audit_records import last, records
from fake_config_xml import cfg_xml
from fake_http import state
from fastapi.testclient import TestClient
from fixtures_clients import CREDENTIAL, app
from state_import import export, store_config, upload

from hqptuner.presets.store.presets import PresetStore

ROW0 = {"source": "0", "gain": "0", "gainunit": "dB", "mixdown": "0", "process": ""}
ROW1 = {"source": "1", "gain": "-3", "gainunit": "dB", "mixdown": "1", "process": ""}


# --- the app under test, with and without a debug log -------------------------


@pytest.fixture
def audit_log(tmp_path: Path) -> Path:
    return tmp_path / "audit.jsonl"


@pytest.fixture
def audit_client(
    http_daemon: dict[str, Any], tmp_path: Path, closed_port: int, audit_log: Path
) -> Iterator[TestClient]:
    yield from app(http_daemon, tmp_path, closed_port, audit_log)


@pytest.fixture
def unlogged_client(http_daemon: dict[str, Any], tmp_path: Path, closed_port: int) -> Iterator[TestClient]:
    """The same app with the audit log unset — the disabled case."""
    yield from app(http_daemon, tmp_path, closed_port, None)


# --- reading the log back, independently of the module that writes it ---------


def events(path: Path) -> list[str]:
    return [str(rec.get("event")) for rec in records(path)]


def stray_files(root: Path) -> list[str]:
    """Everything under the app's directories that is not one of its documented
    artifacts — the pre-apply backup archive and the preset store. Any other
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


def save_preset(client: TestClient, name: str) -> None:
    # nothing is staged, so the save rides an apply of the "(no preset)" switch
    client.post("/api/config/apply", json={"switch_to": "", "save": {"name": name}})


def import_preset_store(client: TestClient, tmp_path: Path, *, autosave: bool) -> None:
    """Import an archive whose preset store holds no preset and carries the given autosave flag."""
    source = store_config(tmp_path / "source")
    PresetStore(source.preset_dir).set_autosave(enabled=autosave)
    upload(client, export(source))


def arm_autosave(client: TestClient, tmp_path: Path, name: str = "Kept") -> None:
    """Turn autosave on by a state import, then save ``name``, the active preset the autosave folds into."""
    import_preset_store(client, tmp_path, autosave=True)
    save_preset(client, name)


# --- the log is off unless asked for -----------------------------------------


@pytest.mark.parametrize(
    ("client_fixture", "expected"),
    [("unlogged_client", []), ("audit_client", ["audit.jsonl"])],
    ids=["unset", "configured"],
)
def test_an_unset_debug_log_writes_no_audit_file_but_a_configured_one_does(
    request: pytest.FixtureRequest, tmp_path: Path, client_fixture: str, expected: list[str]
) -> None:
    # a full stage-then-apply cycle leaves the app's own directories carrying
    # nothing but the artifacts it legitimately owns — checked by what is there
    # rather than by a name a log would have to be unlucky enough to use
    client: TestClient = request.getfixturevalue(client_fixture)
    stage_title(client)
    client.post("/api/config/apply")
    assert stray_files(tmp_path) == expected


# --- staging ------------------------------------------------------------------


def test_the_stage_record_carries_the_staged_http_value(audit_client: TestClient, audit_log: Path) -> None:
    # the value, not just the field name: a log of names with no payload cannot
    # answer what the user actually asked the daemon to do
    stage_title(audit_client, "Renamed")
    assert last(audit_log, "stage")["http"]["title"] == "Renamed"


# --- discard ------------------------------------------------------------------


def test_the_discard_record_carries_the_http_value_it_destroyed(audit_client: TestClient, audit_log: Path) -> None:
    # the discard is the one operation whose whole effect is to make the buffer
    # unreadable, so the record is the only surviving copy of what was thrown
    # away — which means the value, not merely the field name
    stage_title(audit_client, "Abandoned")
    audit_client.delete("/api/config/pending")
    assert last(audit_log, "discard")["http"]["title"] == "Abandoned"


# --- apply --------------------------------------------------------------------


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


def test_the_apply_record_names_the_preset_the_apply_switched_to(audit_client: TestClient, audit_log: Path) -> None:
    # switching preset is the write with the largest blast radius — the whole
    # config changes — so which preset was loaded belongs in the same record
    save_preset(audit_client, "Kept")
    audit_client.post("/api/config/apply", json={"switch_to": "Kept"})
    assert last(audit_log, "apply")["switch_to"] == "Kept"


# --- the apply that did not work: the reason anyone opens this file ------------
#
# The fake daemon refuses the literal value "REJECT" on restore while still
# answering HTTP 200 (fake_http, the 6.0.4 contract), so the apply comes back
# not-applied without an exception — the soft failure the log has to explain.


@pytest.mark.parametrize(("title", "expected"), [("Renamed", True), ("REJECT", False)], ids=["lands", "refused"])
def test_an_apply_records_the_outcome_as_ok_when_it_lands_and_not_ok_when_refused(
    audit_client: TestClient, audit_log: Path, title: str, *, expected: bool
) -> None:
    stage_title(audit_client, title)
    audit_client.post("/api/config/apply")
    assert last(audit_log, "apply")["ok"] is expected


def test_a_refused_apply_still_records_the_staged_payload(audit_client: TestClient, audit_log: Path) -> None:
    # a record that only carries the failure and not the payload leaves the
    # reader knowing an apply broke and nothing about what it tried to do
    stage_title(audit_client, "REJECT")
    audit_client.post("/api/config/apply")
    assert last(audit_log, "apply")["http"]["title"] == "REJECT"


# --- matrix profile writes ----------------------------------------------------


def test_the_profile_write_record_names_the_saved_profile(audit_client: TestClient, audit_log: Path) -> None:
    apply_profile_save(audit_client, "Crossfeed EQ", ROW0, ROW1)
    assert last(audit_log, "profile.write")["name"] == "Crossfeed EQ"


@pytest.mark.parametrize(("name", "expected"), [("Crossfeed EQ", True), ("Brand New", False)], ids=["same", "new"])
def test_a_profile_save_records_whether_it_replaced_an_existing_name(
    audit_client: TestClient, audit_log: Path, name: str, *, expected: bool
) -> None:
    apply_profile_save(audit_client, "Crossfeed EQ", ROW0)
    apply_profile_save(audit_client, name, ROW0, ROW1)
    assert last(audit_log, "profile.write")["replaced"] is expected


# --- preset writes, by what triggered them ------------------------------------


def test_an_explicit_preset_save_records_the_save_trigger(audit_client: TestClient, audit_log: Path) -> None:
    save_preset(audit_client, "Studio")
    assert last(audit_log, "preset.write")["trigger"] == "save"


def test_an_autosaved_apply_records_the_autosave_trigger(
    audit_client: TestClient, audit_log: Path, tmp_path: Path
) -> None:
    arm_autosave(audit_client, tmp_path)
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
    delete_payload = json.dumps({"name": "Crossfeed EQ", "presets": []})
    audit_client.post("/api/config/stage", json={"http": {"matrix_profile_delete": delete_payload}})
    audit_client.post("/api/config/apply")
    assert "profile.delete" in events(audit_log)


def test_deleting_a_stored_preset_appends_a_preset_delete_record(
    audit_client: TestClient, audit_log: Path, tmp_path: Path
) -> None:
    # an import replaces the whole preset store, deleting each preset the archive does not carry
    save_preset(audit_client, "Doomed")
    import_preset_store(audit_client, tmp_path, autosave=False)
    assert "preset.delete" in events(audit_log)


def test_loading_a_preset_appends_a_preset_load_record(audit_client: TestClient, audit_log: Path) -> None:
    save_preset(audit_client, "Kept")
    audit_client.post("/api/config/apply", json={"switch_to": "Kept"})
    assert "preset.load" in events(audit_log)


def test_switching_the_active_preset_appends_an_active_set_record(audit_client: TestClient, audit_log: Path) -> None:
    save_preset(audit_client, "Kept")
    audit_client.post("/api/config/apply", json={"switch_to": "Kept"})
    assert "active.set" in events(audit_log)


def test_turning_autosave_on_appends_an_autosave_set_record(
    audit_client: TestClient, audit_log: Path, tmp_path: Path
) -> None:
    import_preset_store(audit_client, tmp_path, autosave=True)
    assert "autosave.set" in events(audit_log)


def test_uploading_a_settings_archive_appends_a_restore_upload_record(
    audit_client: TestClient, audit_log: Path
) -> None:
    # the biggest blast radius in the app: one upload replaces the whole config
    archive = audit_client.get("/api/backup").content
    audit_client.post("/api/restore", files={"cfgfile": ("settings.zip", archive, "application/zip")})
    assert "restore.upload" in events(audit_log)


# --- what must never be in the file ------------------------------------------


def test_the_audit_log_never_carries_the_daemon_credential(
    audit_client: TestClient, audit_log: Path, tmp_path: Path
) -> None:
    # every write path this file covers, through one app, then the whole file
    # armed first: its import replaces the preset store, which would drop the seeded preset
    arm_autosave(audit_client, tmp_path)
    seed_preset(tmp_path)
    stage_title(audit_client)
    audit_client.post("/api/config/apply")
    apply_profile_save(audit_client, "Crossfeed EQ", ROW0, presets=["Office"])
    stage_title(audit_client, "Discarded")
    audit_client.delete("/api/config/pending")
    assert CREDENTIAL not in audit_log.read_text(encoding="utf-8")
