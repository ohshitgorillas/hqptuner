"""Fixture plugin (registered from conftest.py): `TestClient`s over the REST
app under test — daemonless, control-lane-only on the threaded fake, and http-
lane on the fake 8088 daemon. All built on conftest's `_live_app`/`_closed_port`
helpers, which stay there because test modules import them by that name."""

from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from conftest import _closed_port, _live_app, spawn_threaded_daemon
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config


@pytest.fixture
def live_api(threaded_daemon_port: int, tmp_path: Path) -> Iterator[TestClient]:
    yield from _live_app(threaded_daemon_port, tmp_path)


@pytest.fixture
def chain_api(tmp_path: Path) -> Iterator[Callable[..., TestClient]]:
    """Build the control-only app on a fake daemon carrying the given State and
    Status overrides. A factory rather than a fixture per case: which chain the
    engine has loaded is four different daemon situations, and a fixture pair for
    each would be six near-identical fixtures for four one-line tests.

    Every client built here shares one preset store (``tmp_path``), which is what
    lets a preset saved against one engine situation be applied against another."""
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


@pytest.fixture
def api_client() -> Iterator[TestClient]:
    """The REST surface with no daemon behind it (control lane at a closed port,
    no credentials) — for the routes whose behavior is guards and buffering
    rather than daemon traffic."""
    cfg = Config(hqp_host="127.0.0.1", hqp_control_port=_closed_port())
    with TestClient(create_app(cfg)) as test_client:
        yield test_client


@pytest.fixture
def http_client(http_daemon: dict[str, Any], tmp_path: Path, closed_port: int) -> Iterator[TestClient]:
    """The REST surface with its http lane wired to the faithful fake 8088
    daemon; control lane at a closed port (http-only operations never touch it).
    Small alarm so a rejected apply times out fast; backups, presets, and parked
    filters land in tmp, never in the repo; `hqp_home` is pinned so filter-upload
    path assertions read verbatim."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=closed_port,
        hqp_http_port=http_daemon["_port"],
        hqp_username="u",
        hqp_password="p",
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        # every state-file store in tmp too — a preset save through this client
        # records auto-pilot state, and the defaults are the dev container's
        # bind-mounted state/ (the conftest env guard backstops this)
        live_preset_file=tmp_path / "live-presets.json",
        favorites_file=tmp_path / "favorites.json",
        narrowing_file=tmp_path / "narrowing.json",
        description_file=tmp_path / "descriptions.json",
        matrix_mode_file=tmp_path / "matrixmodes.json",
        autopilot_file=tmp_path / "autopilot.json",
        hqp_home="/x/home",
    )
    with TestClient(create_app(cfg)) as test_client:
        yield test_client
