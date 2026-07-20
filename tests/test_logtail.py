"""Behavior of the log-tail helpers (System-tab live view)."""

from pathlib import Path

from hqptuner import logtail


def test_tail_file_returns_the_last_n_lines(tmp_path: Path) -> None:
    log = tmp_path / "hqplayerd.log"
    log.write_text("\n".join(f"line{i}" for i in range(10)))
    assert logtail.tail_file(str(log), 3) == ["line7", "line8", "line9"]


def test_tail_file_returns_all_lines_when_fewer_than_requested(tmp_path: Path) -> None:
    log = tmp_path / "hqplayerd.log"
    log.write_text("only\ntwo")
    assert logtail.tail_file(str(log), 50) == ["only", "two"]


def test_log_file_field_reads_the_configured_path() -> None:
    form = {"fields": [{"name": "log_file", "value": "/tmp/hqplayerd.log"}]}
    assert logtail.log_file_field(form)[0] == "/tmp/hqplayerd.log"


def test_log_file_field_reports_logging_enabled() -> None:
    form = {"fields": [{"name": "log_enabled", "value": True}]}
    assert logtail.log_file_field(form)[1] is True


def test_log_file_field_is_empty_when_form_not_loaded() -> None:
    assert logtail.log_file_field(None) == (None, False)
