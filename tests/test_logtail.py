"""Behavior of the log tail (System-tab live view): the pure tail helper, the
config-form field reader, and read_log_tail fetching GET /log off the fake
daemon's 8088 lane (docs/testing.md — public API, fake speaks the wire)."""

from typing import Any

from hqptuner import logtail
from hqptuner.config import Config
from hqptuner.manager import ConnectionManager


def test_tail_text_returns_the_last_n_lines() -> None:
    text = "\n".join(f"line{i}" for i in range(10))
    assert logtail.tail_text(text, 3) == ["line7", "line8", "line9"]


def test_tail_text_returns_all_lines_when_fewer_than_requested() -> None:
    assert logtail.tail_text("only\ntwo", 50) == ["only", "two"]


def test_log_file_field_reads_the_configured_path() -> None:
    form = {"fields": [{"name": "log_file", "value": "/tmp/hqplayerd.log"}]}
    assert logtail.log_file_field(form)[0] == "/tmp/hqplayerd.log"


def test_log_file_field_reports_logging_enabled() -> None:
    form = {"fields": [{"name": "log_enabled", "value": True}]}
    assert logtail.log_file_field(form)[1] is True


def test_log_file_field_is_empty_when_form_not_loaded() -> None:
    assert logtail.log_file_field(None) == (None, False)


async def test_read_log_tail_returns_the_last_lines_of_the_daemon_log(http_daemon: dict[str, Any]) -> None:
    cfg = Config(hqp_host="127.0.0.1", hqp_http_port=http_daemon["_port"])
    manager = ConnectionManager(cfg)
    result = await manager.read_log_tail(3)
    await manager.aclose()
    # the tail reaches the daemon's most recent log line — proves it fetched /log
    assert result["lines"][-1] == "log line 60"


async def test_read_log_tail_reports_unavailable_when_the_daemon_is_unreachable() -> None:
    cfg = Config(hqp_host="127.0.0.1", hqp_http_port=1)  # nothing listening
    manager = ConnectionManager(cfg)
    result = await manager.read_log_tail()
    await manager.aclose()
    assert result["available"] is False
