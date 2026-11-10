"""Fixture plugin (registered from conftest.py): `TestClient`s over the REST
app under test, each on the two lanes a working install needs: a fake 4321 daemon
and a fake 8088 daemon, answering, with `/api/health` reading `ready` before the
case gets the client."""

from collections.abc import Callable, Iterator
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fake_control
import fake_http
import pytest
from apps import live_app, log_in, ready_app
from conftest import spawn_threaded_daemon
from fake_control import CommandLog
from fastapi.testclient import TestClient
from httpx import Response
from virtual_clock import VirtualClock

from hqptuner.config import Config

#: The daemon credential ``app`` builds with — distinctive enough that finding it
#: anywhere in a log is unambiguous.
CREDENTIAL = "s3cr3t-hqp-passphrase"


def app(daemon: dict[str, Any], tmp_path: Path, port: int, debug_log: Path | None) -> Iterator[TestClient]:
    """The REST surface on the fake 8088 daemon and the fake 4321 daemon at ``port`` (the `http_client` shape),
    ready and logged in, with the audit log pointed wherever the case wants it — or disabled."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=port,
        hqp_http_port=daemon["_port"],
        hqp_username="u",
        hqp_password=CREDENTIAL,
        alarm_threshold=1.0,
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        # state-file stores in tmp — the preset saves and loads below write
        # auto-pilot and live-snapshot state, whose defaults are the dev
        # container's bind-mounted state/
        live_preset_file=tmp_path / "live-presets.json",
        # ADVISOR_ENABLED is off in every build; the suite keeps it on so the
        # switch, its background loop and the state they carry stay exercised
        advisor_enabled=True,
        favorites_file=tmp_path / "favorites.json",
        narrowing_file=tmp_path / "narrowing.json",
        description_file=tmp_path / "descriptions.json",
        matrix_mode_file=tmp_path / "matrixmodes.json",
        autopilot_file=tmp_path / "autopilot.json",
        hqp_home="/x/home",
        debug_log=debug_log,
    )
    with ready_app(cfg) as client:
        yield log_in(client)


@pytest.fixture
def live_api(threaded_daemon_port: int, tmp_path: Path) -> Iterator[TestClient]:
    """The REST surface on the threaded fake 4321 daemon and an 8088 fake of its own, ready and logged in."""
    yield from live_app(threaded_daemon_port, tmp_path)


@pytest.fixture
def daemonless_client(tmp_path: Path) -> Iterator[TestClient]:
    """An app ready on both lanes whose 4321 lane then goes away for good."""
    control_state = dict(fake_control.DEFAULTS)
    daemon = spawn_threaded_daemon(state=control_state)
    app = live_app(next(daemon), tmp_path)
    client = next(app)
    fake_control.take_lane_down(control_state)
    yield client
    next(app, None)
    next(daemon, None)


@pytest.fixture
def chain_api(tmp_path: Path) -> Iterator[Callable[..., TestClient]]:
    """Build the two-lane app on a fake control daemon carrying the given State and
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
        app = live_app(next(daemon), tmp_path)
        apps.append(app)
        return next(app)

    yield build
    for app in apps:
        next(app, None)
    for daemon in daemons:
        next(daemon, None)


@dataclass(frozen=True)
class Wire:
    """The two fake daemons an app runs on, and what they have been sent.

    ``sent`` is the count of Control API commands the 4321 fake has logged and of requests the 8088 fake has answered,
    so a case that must not reach hqplayerd compares it across the request under test.
    """

    control_port: int
    control_log: CommandLog
    http_daemon: dict[str, Any]
    tmp_path: Path

    def sent(self) -> tuple[int, int]:
        return len(self.control_log), int(self.http_daemon.get("_requests", 0))

    def config(self, **fields: object) -> Config:
        """A config for an app on both fakes, with credentials, every state path under ``tmp_path``, and ``fields`` on
        top."""
        defaults: dict[str, Any] = {
            "hqp_host": "127.0.0.1",
            "hqp_control_port": self.control_port,
            "hqp_http_port": self.http_daemon["_port"],
            "hqp_username": "u",
            "hqp_password": "p",
            "backup_dir": self.tmp_path,
            "preset_dir": self.tmp_path / "presets",
            "live_preset_file": self.tmp_path / "live-presets.json",
            "autopilot_file": self.tmp_path / "autopilot.json",
        }
        return Config(**{**defaults, **fields})


@pytest.fixture
def wire(http_daemon: dict[str, Any], tmp_path: Path) -> Iterator[Wire]:
    """Both fake daemons for an app, the 4321 one logging every command it receives."""
    log: CommandLog = []
    daemon = spawn_threaded_daemon(log=log)
    yield Wire(next(daemon), log, http_daemon, tmp_path)
    next(daemon, None)


def gated_config(
    tmp_path: Path, control_port: int, http_port: int, *, pair: tuple[str, str] = ("admin", "pw"), audit: bool = False
) -> Config:
    """The config of an app over the one state directory ``gated_app`` shares: its connection record, login secret and
    stores sit under ``tmp_path``."""
    return Config(
        hqp_host="127.0.0.1",
        hqp_control_port=control_port,
        hqp_http_port=http_port,
        hqp_username=pair[0],
        hqp_password=pair[1],
        connection_file=tmp_path / "connection.json",
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
        favorites_file=tmp_path / "favorites.json",
        narrowing_file=tmp_path / "narrowing.json",
        description_file=tmp_path / "descriptions.json",
        matrix_mode_file=tmp_path / "matrixmodes.json",
        autopilot_file=tmp_path / "autopilot.json",
        debug_log=tmp_path / "audit.jsonl" if audit else None,
    )


@pytest.fixture
def gated_app(
    http_daemon: dict[str, Any], threaded_daemon_port: int, tmp_path: Path
) -> Iterator[Callable[..., TestClient]]:
    """Build apps over ONE state directory, the pair admin/pw in force on the fake 8088 daemon and the fake 4321
    daemon answering, each handed over once it reads `ready`.

    Every app shares the connection record and the login secret under ``tmp_path``, so a second app is a restart of
    the first. ``clock`` sets the instant the app reads, ``pair`` the username and password in force, ``audit`` turns
    the audit log on so its router is registered. Nothing is logged in: the caller logs in, or sends a cookie.
    """
    with ExitStack() as stack:

        def build(
            clock: VirtualClock | None = None, *, pair: tuple[str, str] = ("admin", "pw"), audit: bool = False
        ) -> TestClient:
            cfg = gated_config(tmp_path, threaded_daemon_port, http_daemon["_port"], pair=pair, audit=audit)
            return stack.enter_context(ready_app(cfg, clock))

        yield build


@pytest.fixture
def api_client(threaded_daemon_port: int, tmp_path: Path) -> Iterator[TestClient]:
    """The REST surface on both lanes, ready and logged in — for the routes whose behavior is guards and buffering
    rather than daemon traffic."""
    yield from live_app(threaded_daemon_port, tmp_path)


@pytest.fixture
def http_client(http_daemon: dict[str, Any], tmp_path: Path, threaded_daemon_port: int) -> Iterator[TestClient]:
    """The REST surface with its http lane wired to the faithful fake 8088
    daemon and its control lane to the threaded fake 4321 daemon, ready and logged
    in. Small alarm so a rejected apply times out fast; backups, presets, and parked
    filters land in tmp, never in the repo; `hqp_home` is pinned so filter-upload
    path assertions read verbatim."""
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=threaded_daemon_port,
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
        # ADVISOR_ENABLED is off in every build; the suite keeps it on so the
        # switch, its background loop and the state they carry stay exercised
        advisor_enabled=True,
        favorites_file=tmp_path / "favorites.json",
        narrowing_file=tmp_path / "narrowing.json",
        description_file=tmp_path / "descriptions.json",
        matrix_mode_file=tmp_path / "matrixmodes.json",
        autopilot_file=tmp_path / "autopilot.json",
        hqp_home="/x/home",
    )
    with ready_app(cfg) as test_client:
        yield log_in(test_client)


@dataclass
class Lanes:
    """A ready, logged-in app and the live state of the two fakes it runs on.

    ``control`` is the 4321 fake's State, shared across its connections, and ``http`` the 8088 fake's: writing to either
    is how a case says a lane changed with no request from the app. ``control_log`` is every command the 4321 fake has
    received.
    """

    client: TestClient
    control_log: CommandLog
    control: dict[str, str]
    http: dict[str, Any]

    def post(self, path: str, body: dict[str, Any]) -> Response:
        answer: Response = self.client.post(path, json=body)
        return answer

    def commands_sent_by(self, path: str, body: dict[str, Any]) -> int:
        """How many commands the 4321 fake logged while the request ran."""
        before = len(self.control_log)
        self.post(path, body)
        return len(self.control_log) - before


@pytest.fixture
def lanes(tmp_path: Path) -> Iterator[Lanes]:
    """The real app on both fakes, ready and logged in, with a live preset ``warm`` saved and every store under
    ``tmp_path``."""
    log: CommandLog = []
    control = {**fake_control.DEFAULTS}
    served = spawn_threaded_daemon(state=control, log=log)
    http_state = fake_http.spawn(fake_http.state(), in_process=True)
    http = next(http_state)
    cfg = Config(
        hqp_host="127.0.0.1",
        hqp_control_port=next(served),
        hqp_http_port=http["_port"],
        hqp_username="u",
        hqp_password="p",
        backup_dir=tmp_path,
        preset_dir=tmp_path / "presets",
        live_preset_file=tmp_path / "live-presets.json",
        favorites_file=tmp_path / "favorites.json",
        narrowing_file=tmp_path / "narrowing.json",
        description_file=tmp_path / "descriptions.json",
        matrix_mode_file=tmp_path / "matrixmodes.json",
        autopilot_file=tmp_path / "autopilot.json",
    )
    with ready_app(cfg) as client:
        log_in(client)
        client.put("/api/livepresets/warm")
        yield Lanes(client, log, control, http)
    next(served, None)
    next(http_state, None)
