"""AuditLog behavior through its public API (docs/testing.md).

Pure filesystem: the log is a line-per-record JSON file under pytest's
``tmp_path``, so nothing here touches a daemon, a socket or the repo. Ordering
is asserted on ``seq`` alone — never on the timestamps, which are wall clock.

Rotation cases pass a tiny ``max_bytes`` rather than writing the 16 MB
production default, and detect the roll by watching for the ``.1`` file instead
of counting bytes, which is the observable contract.
"""

import hashlib
import json
import logging
from collections.abc import Callable
from itertools import pairwise
from pathlib import Path
from typing import Any

import pytest

from hqptuner.audit import MAX_VALUE_BYTES, AuditLog, resolve_level

HTTP: dict[str, str] = {"filter": "poly-sinc-gauss-long", "rate": "2"}
LIVE: dict[str, dict[str, str]] = {"convolution": {"enabled": "1"}}
DROPPED: dict[str, Any] = {"volume": "-6"}

#: A pipeline row set as it travels on the wire: a JSON array string, which is
#: what ``row_count`` counts.
ROWS = json.dumps([["1", "0", "0"], ["0", "1", "0"], ["0", "0", "1"]])

#: One call per documented event name, each with plausible arguments — the
#: vocabulary a caller has to be able to emit.
EMITTERS: dict[str, Callable[[AuditLog], None]] = {
    "stage": lambda log: log.stage(HTTP, LIVE, DROPPED),
    "discard": lambda log: log.discard(HTTP, LIVE),
    "apply": lambda log: log.apply(HTTP, LIVE, "2", "profile-a", ok=True),
    "profile.write": lambda log: log.profile_write("alpha", ROWS, "matrix", replaced=False),
    "profile.delete": lambda log: log.profile_delete("alpha", "matrix", found=True),
    "preset.write": lambda log: log.preset_write("alpha", "save", 42, "abc123", overwrote=False),
    "preset.delete": lambda log: log.preset_delete("alpha", was_active=False),
    "preset.load": lambda log: log.preset_load("alpha", "bravo"),
    "active.set": lambda log: log.active_set("alpha", None),
    "autosave.set": lambda log: log.autosave_set(enabled=True, previous=False),
    "restore.upload": lambda log: log.restore_upload("backup.zip", 1024, "abc123"),
    "live.write": lambda log: log.live_write("convolution.enabled", "1", "1", ok=True),
}


def log_path(tmp_path: Path) -> Path:
    return tmp_path / "audit.jsonl"


def log_at(tmp_path: Path, **kwargs: Any) -> AuditLog:
    return AuditLog(log_path(tmp_path), **kwargs)


def rotated_path(tmp_path: Path) -> Path:
    return tmp_path / "audit.jsonl.1"


def last_seq(log: AuditLog) -> int:
    return int(log.records()[-1]["seq"])


def fill_until_rotated(log: AuditLog, rotation: Path, limit: int = 500) -> int:
    """Emit records until the log rolls; return the highest seq written before
    the roll, so a caller can show that numbering carries across it."""
    highest = 0
    for index in range(limit):
        seqs = [int(record["seq"]) for record in log.records()]
        highest = max([highest, *seqs])
        log.preset_write(f"preset-{index}", "save", 4096, "abc123", overwrote=False)
        if rotation.exists():
            return highest
    pytest.fail(f"log never rotated after {limit} records")


# --- the disabled instance --------------------------------------------------


def test_disabled_log_writes_no_file_when_an_emitter_is_called(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # cwd moved under tmp_path so a relative default path would land here too,
    # not only the path the enabled fixture names
    monkeypatch.chdir(tmp_path)
    AuditLog(None).preset_write("alpha", "save", 10, "abc123", overwrote=False)
    assert not log_path(tmp_path).exists()


def test_disabled_log_has_no_records() -> None:
    log = AuditLog(None)
    log.stage(HTTP, LIVE, DROPPED)
    assert log.records() == []


def test_disabled_log_reports_itself_disabled() -> None:
    assert AuditLog(None).enabled is False


def test_log_given_a_path_reports_itself_enabled(tmp_path: Path) -> None:
    assert log_at(tmp_path).enabled is True


# --- the envelope -----------------------------------------------------------


def test_an_emitter_appends_exactly_one_record(tmp_path: Path) -> None:
    log = log_at(tmp_path)
    log.preset_delete("alpha", was_active=True)
    assert len(log.records()) == 1


def test_every_line_of_the_file_parses_as_json_on_its_own(tmp_path: Path) -> None:
    log = log_at(tmp_path)
    for index in range(3):
        log.preset_write(f"preset-{index}", "save", 10, "abc123", overwrote=False)
    lines = log_path(tmp_path).read_text().splitlines()
    assert len([json.loads(line) for line in lines]) == len(log.records())


def test_every_record_carries_a_timestamp(tmp_path: Path) -> None:
    # presence only: ``ts`` is wall clock, so its value is never asserted on
    log = log_at(tmp_path)
    log.active_set("alpha", None)
    assert "ts" in log.records()[0]


def test_seq_strictly_increases_across_successive_records(tmp_path: Path) -> None:
    log = log_at(tmp_path)
    for index in range(3):
        log.preset_write(f"preset-{index}", "save", 10, "abc123", overwrote=False)
    seqs = [record["seq"] for record in log.records()]
    assert all(later > earlier for earlier, later in pairwise(seqs))


def test_the_first_record_is_seq_one(tmp_path: Path) -> None:
    log = log_at(tmp_path)
    log.active_set("alpha", None)
    assert log.records()[0]["seq"] == 1


@pytest.mark.parametrize("event", list(EMITTERS))
def test_each_emitter_writes_its_documented_event_name(tmp_path: Path, event: str) -> None:
    log = log_at(tmp_path)
    EMITTERS[event](log)
    assert log.records()[0]["event"] == event


# --- per-event fields -------------------------------------------------------


def test_profile_write_records_the_profile_name(tmp_path: Path) -> None:
    log = log_at(tmp_path)
    log.profile_write("living-room", ROWS, "matrix", replaced=False)
    assert log.records()[0]["name"] == "living-room"


@pytest.mark.parametrize("replaced", [True, False])
def test_profile_write_records_whether_it_replaced_a_profile(tmp_path: Path, *, replaced: bool) -> None:
    log = log_at(tmp_path)
    log.profile_write("living-room", ROWS, "matrix", replaced=replaced)
    assert log.records()[0]["replaced"] is replaced


def test_profile_write_counts_the_rows_it_was_handed(tmp_path: Path) -> None:
    log = log_at(tmp_path)
    log.profile_write("living-room", ROWS, "matrix", replaced=False)
    assert log.records()[0]["row_count"] == len(json.loads(ROWS))


def test_profile_write_counts_no_rows_when_the_payload_is_not_a_list(tmp_path: Path) -> None:
    log = log_at(tmp_path)
    log.profile_write("living-room", "not json at all", "matrix", replaced=False)
    assert log.records()[0]["row_count"] == 0


def test_preset_write_records_its_trigger(tmp_path: Path) -> None:
    log = log_at(tmp_path)
    log.preset_write("alpha", "autosave", 128, "abc123", overwrote=True)
    assert log.records()[0]["trigger"] == "autosave"


# --- oversized values -------------------------------------------------------


def test_a_value_over_the_cap_is_stored_truncated_to_the_cap(tmp_path: Path) -> None:
    log = log_at(tmp_path)
    log.live_write("convolution.filter", "x" * (MAX_VALUE_BYTES + 500), None, ok=True)
    assert len(log.records()[0]["value"]) == MAX_VALUE_BYTES


def test_a_record_with_an_oversized_value_is_marked_truncated(tmp_path: Path) -> None:
    log = log_at(tmp_path)
    log.live_write("convolution.filter", "x" * (MAX_VALUE_BYTES + 500), None, ok=True)
    assert log.records()[0]["truncated"] is True


def test_a_truncated_record_carries_the_digest_of_the_full_value(tmp_path: Path) -> None:
    log = log_at(tmp_path)
    value = "x" * (MAX_VALUE_BYTES + 500)
    log.live_write("convolution.filter", value, None, ok=True)
    assert log.records()[0]["full_digests"]["value"] == hashlib.sha256(value.encode()).hexdigest()


def test_a_nested_oversized_value_is_keyed_by_its_dotted_path(tmp_path: Path) -> None:
    log = log_at(tmp_path)
    value = "x" * (MAX_VALUE_BYTES + 500)
    log.stage({"matrix_profile_save": value}, LIVE, DROPPED)
    digest = hashlib.sha256(value.encode()).hexdigest()
    assert log.records()[0]["full_digests"]["http.matrix_profile_save"] == digest


def test_two_oversized_values_in_one_record_get_a_digest_each(tmp_path: Path) -> None:
    log = log_at(tmp_path)
    oversized = "x" * (MAX_VALUE_BYTES + 500)
    second = oversized + "y"  # distinct value, so a shared digest cannot satisfy both
    log.stage({"matrix_profile_save": oversized, "convolution_filter": second}, LIVE, DROPPED)
    digests = log.records()[0]["full_digests"]
    assert digests["http.convolution_filter"] == hashlib.sha256(second.encode()).hexdigest()


def test_an_oversized_multibyte_value_is_capped_in_bytes_not_characters(tmp_path: Path) -> None:
    log = log_at(tmp_path)
    # two UTF-8 bytes per character: a character-counting cap stores twice the
    # bytes it should, and a byte-counting cap that cuts mid-codepoint cannot
    # round-trip through the file at all
    log.live_write("convolution.filter", "é" * MAX_VALUE_BYTES, None, ok=True)
    assert len(log.records()[0]["value"].encode("utf-8")) <= MAX_VALUE_BYTES


def test_a_value_under_the_cap_is_not_marked_truncated(tmp_path: Path) -> None:
    log = log_at(tmp_path)
    log.live_write("convolution.filter", "x" * 64, None, ok=True)
    assert "truncated" not in log.records()[0]


# --- redaction --------------------------------------------------------------


@pytest.mark.parametrize("key", ["password", "secret", "token", "PASSWORD", "Secret", "TOKEN"])
def test_a_sensitive_field_is_redacted(tmp_path: Path, key: str) -> None:
    log = log_at(tmp_path)
    log.stage({key: "hunter2"}, LIVE, DROPPED)
    assert log.records()[0]["http"][key] == "***"


@pytest.mark.parametrize("key", ["password", "secret", "token"])
def test_a_sensitive_field_nested_deeper_is_redacted(tmp_path: Path, key: str) -> None:
    log = log_at(tmp_path)
    log.discard(HTTP, {"convolution": {"enabled": "1", key: "hunter2"}})
    assert log.records()[0]["live"]["convolution"][key] == "***"


# --- tail -------------------------------------------------------------------


def test_tail_returns_the_most_recent_records_newest_last(tmp_path: Path) -> None:
    log = log_at(tmp_path)
    for index in range(4):
        log.preset_write(f"preset-{index}", "save", 10, "abc123", overwrote=False)
    assert [record["name"] for record in log.tail(2)] == ["preset-2", "preset-3"]


def test_tail_beyond_the_record_count_returns_every_record(tmp_path: Path) -> None:
    log = log_at(tmp_path)
    for index in range(3):
        log.preset_write(f"preset-{index}", "save", 10, "abc123", overwrote=False)
    assert len(log.tail(50)) == 3


# --- rotation ---------------------------------------------------------------


def test_a_log_past_its_size_limit_rotates_to_a_dot_one_file(tmp_path: Path) -> None:
    log = log_at(tmp_path, max_bytes=400)
    fill_until_rotated(log, rotated_path(tmp_path))
    assert rotated_path(tmp_path).exists()


def test_the_current_file_holds_records_appended_after_a_rotation(tmp_path: Path) -> None:
    log = log_at(tmp_path, max_bytes=400)
    fill_until_rotated(log, rotated_path(tmp_path))
    log.preset_write("after-the-roll", "save", 10, "abc123", overwrote=False)
    assert log.records()[-1]["name"] == "after-the-roll"


def test_seq_keeps_climbing_across_a_rotation(tmp_path: Path) -> None:
    log = log_at(tmp_path, max_bytes=400)
    before = fill_until_rotated(log, rotated_path(tmp_path))
    log.preset_write("after-the-roll", "save", 10, "abc123", overwrote=False)
    assert log.records()[-1]["seq"] > before


# --- reopening --------------------------------------------------------------


def test_reopening_the_same_path_appends_rather_than_truncates(tmp_path: Path) -> None:
    log_at(tmp_path).preset_write("first", "save", 10, "abc123", overwrote=False)
    reopened = log_at(tmp_path)
    reopened.preset_write("second", "save", 10, "abc123", overwrote=False)
    assert [record["name"] for record in reopened.records()] == ["first", "second"]


def test_seq_keeps_climbing_across_a_reopen(tmp_path: Path) -> None:
    first = log_at(tmp_path)
    first.preset_write("first", "save", 10, "abc123", overwrote=False)
    before = last_seq(first)
    reopened = log_at(tmp_path)
    reopened.preset_write("second", "save", 10, "abc123", overwrote=False)
    assert last_seq(reopened) > before


# --- level resolution -------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "level"),
    [
        ("debug", logging.DEBUG),
        ("DEBUG", logging.DEBUG),
        ("Debug", logging.DEBUG),
        ("info", logging.INFO),
        ("warning", logging.WARNING),
        ("WARNING", logging.WARNING),
        ("error", logging.ERROR),
        ("critical", logging.CRITICAL),
        ("Critical", logging.CRITICAL),
    ],
)
def test_resolve_level_reads_a_level_name_case_insensitively(value: str, level: int) -> None:
    assert resolve_level(value) == level


def test_resolve_level_falls_back_to_info_on_unparseable_input() -> None:
    assert resolve_level("not-a-level") == logging.INFO
