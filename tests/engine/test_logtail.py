"""Behavior of the log tail (System-tab live view): the pure tail helper, the
config-form field reader, and read_log_tail fetching GET /log off the fake
daemon's 8088 lane (docs/testing.md — public API, fake speaks the wire)."""

from typing import TYPE_CHECKING, Any

import httpx
import pytest
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core import engineread
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine import logtail

if TYPE_CHECKING:
    from hqptuner.conf.httpforms import ConfigForm


def test_tail_text_returns_the_last_n_lines() -> None:
    text = "\n".join(f"line{i}" for i in range(10))
    assert logtail.tail_text(text, 3) == ["line7", "line8", "line9"]


def test_tail_text_returns_all_lines_when_fewer_than_requested() -> None:
    assert logtail.tail_text("only\ntwo", 50) == ["only", "two"]


def test_log_file_field_is_empty_with_no_form_and_reads_the_configured_path_and_state() -> None:
    absent = logtail.log_file_field(None)
    form: ConfigForm = {
        "fields": [
            {"name": "log_file", "value": "/tmp/hqplayerd.log"},
            {"name": "log_enabled", "value": True},
        ],
        "profiles": None,
    }
    acting = logtail.log_file_field(form)
    assert (absent, acting) == ((None, False), ("/tmp/hqplayerd.log", True))


async def test_read_log_tail_returns_the_last_lines_of_the_daemon_log(http_daemon: dict[str, Any]) -> None:
    cfg = Config(hqp_host="127.0.0.1", hqp_http_port=http_daemon["_port"])
    manager = ConnectionManager(cfg, clock=VirtualClock())
    result = await engineread.read_log_tail(manager, 3)
    await manager.aclose()
    # the tail reaches the daemon's most recent log line — proves it fetched /log
    assert result.lines[-1] == "log line 60"


async def test_read_log_tail_raises_when_the_daemon_is_unreachable() -> None:
    cfg = Config(hqp_host="127.0.0.1", hqp_http_port=1)  # nothing listening
    manager = ConnectionManager(cfg, clock=VirtualClock())
    with pytest.raises(httpx.HTTPError):
        await engineread.read_log_tail(manager)
    await manager.aclose()


async def test_read_log_tail_raises_when_the_daemon_answers_a_server_error(http_daemon: dict[str, Any]) -> None:
    http_daemon["_fail_paths"] = ["/log"]
    cfg = Config(hqp_host="127.0.0.1", hqp_http_port=http_daemon["_port"])
    manager = ConnectionManager(cfg, clock=VirtualClock())
    with pytest.raises(httpx.HTTPError):
        await engineread.read_log_tail(manager)
    await manager.aclose()
