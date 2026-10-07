"""Behavior of the log tail (System-tab live view): the pure tail helper, the
config-form field reader, and read_log_tail fetching GET /log off the fake
daemon's 8088 lane (docs/testing.md — public API, fake speaks the wire)."""

import asyncio
from collections.abc import Iterator
from typing import Any

import fake_http
import httpx
import pytest
from conftest import ManagerFactory
from virtual_clock import VirtualClock

from hqptuner.conf.httpforms import ConfigForm
from hqptuner.config import Config
from hqptuner.core import engineread
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine import logtail


def test_tail_text_returns_the_last_n_lines() -> None:
    text = "\n".join(f"line{i}" for i in range(10))
    assert logtail.tail_text(text, 3) == ["line7", "line8", "line9"]


def test_tail_text_returns_all_lines_when_fewer_than_requested() -> None:
    assert logtail.tail_text("only\ntwo", 50) == ["only", "two"]


CONFIGURED_LOG: ConfigForm = {
    "fields": [
        {"name": "log_file", "value": "/tmp/hqplayerd.log"},
        {"name": "log_enabled", "value": True},
    ],
    "profiles": None,
}


@pytest.mark.parametrize(
    ("form", "expected"),
    [(None, (None, False)), (CONFIGURED_LOG, ("/tmp/hqplayerd.log", True))],
    ids=["no form", "configured form"],
)
def test_log_file_field_reads_the_configured_path_and_state_and_nothing_with_no_form(
    form: ConfigForm | None, expected: tuple[str | None, bool]
) -> None:
    assert logtail.log_file_field(form) == expected


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


# --- what a read costs: one GET /log serves every caller a recent copy suits --


@pytest.fixture
def moved_daemon() -> Iterator[dict[str, Any]]:
    """A second fake 8088 daemon, the address a manager is retargeted onto."""
    yield from fake_http.spawn(fake_http.state())


def _manager(factory: ManagerFactory, daemon: dict[str, Any]) -> ConnectionManager:
    return factory(daemon, hqp_host="127.0.0.1", hqp_http_port=daemon["_port"])


async def test_two_log_tail_reads_inside_the_max_age_cost_one_log_fetch(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any]
) -> None:
    # two browser tabs polling the same tail: the second read is served the first one's text
    manager = _manager(http_manager_factory, http_daemon)
    await engineread.read_log_tail(manager)
    await engineread.read_log_tail(manager)
    assert http_daemon["_log_reads"] == 1


async def test_concurrent_log_tail_reads_share_one_log_fetch(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any]
) -> None:
    # both reads arrive before either fetch has answered, so neither has a held copy to serve
    manager = _manager(http_manager_factory, http_daemon)
    await asyncio.gather(engineread.read_log_tail(manager), engineread.read_log_tail(manager))
    assert http_daemon["_log_reads"] == 1


async def test_a_log_tail_read_after_the_max_age_fetches_the_log_again(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any], clock: VirtualClock
) -> None:
    manager = _manager(http_manager_factory, http_daemon)
    await engineread.read_log_tail(manager)
    await clock.advance(engineread.LOG_MAX_AGE)
    await engineread.read_log_tail(manager)
    assert http_daemon["_log_reads"] == 2


async def test_a_retargeted_manager_reads_the_new_daemons_log_inside_the_max_age(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any], moved_daemon: dict[str, Any]
) -> None:
    # the held text is the old daemon's log, which says nothing about the new one
    manager = _manager(http_manager_factory, http_daemon)
    await engineread.read_log_tail(manager)
    manager.cfg.hqp_http_port = moved_daemon["_port"]
    await engineread.read_log_tail(manager)
    assert moved_daemon["_log_reads"] == 1
