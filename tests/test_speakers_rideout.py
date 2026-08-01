"""The speaker-processing apply's ride-out (``manager.applyops.apply_speakers``): the form
POST reloads the engine and the /speakers lane 502s for a window, so the verify
polls past the transient on the virtual clock and confirms what landed — or gives
up honestly at the alarm deadline when the daemon never comes back.

The fake is a stateful /speakers daemon at the wire (docs/testing.md rule 4): a
GET renders the current state as the real 6.0.4 form markup, a POST adopts the
fields and opens the reload window, during which every GET answers 502."""

import threading
from collections.abc import AsyncIterator, Callable, Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

import pytest

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.manager import ConnectionManager

_CHANNELS = ("Left", "Right")

ManagerBuilder = Callable[..., ConnectionManager]


def _render(st: dict[str, Any]) -> bytes:
    rows = "".join(
        f"<h2>{label}</h2>"
        f'<h3>Level (dBFS)</h3><input type="number" name="level_{i}" value="{st[f"level_{i}"]}"'
        ' min="-60" max="0" step="0.1"/>'
        f'<h3>Distance (cm)</h3><input type="number" name="distance_{i}" value="{st[f"distance_{i}"]}"'
        ' min="0" max="5000"/>'
        for i, label in enumerate(_CHANNELS)
    )
    checked = " checked" if st["enabled"] else ""
    return (
        '<form method="post"><h2>Speaker processing</h2>'
        f'<input type="checkbox" name="enabled" value="1"{checked}/> enabled{rows}</form>'
    ).encode()


def _handler(st: dict[str, Any]) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if st["_refusals"] > 0:  # mid-reload: the lane is not serving yet
                st["_refusals"] -= 1
                self.send_response(502)
                self.end_headers()
                return
            self.send_response(200)
            self.end_headers()
            self.wfile.write(_render(st))

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))
            fields = parse_qs(self.rfile.read(length).decode(), keep_blank_values=True)
            st["enabled"] = fields.get("enabled") == ["1"]
            for key in st:
                if key in fields and key != "enabled" and not key.startswith("_"):
                    st[key] = fields[key][0]
            st["_refusals"] = st["_reload_window"]  # the engine reload begins
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"OK")

        def log_message(self, *_: object) -> None:
            pass

    return Handler


def _spawn(reload_window: int) -> Iterator[dict[str, Any]]:
    st: dict[str, Any] = {"enabled": False, "_refusals": 0, "_reload_window": reload_window}
    for i in range(len(_CHANNELS)):
        st[f"level_{i}"] = "0"
        st[f"distance_{i}"] = "0"
    server = HTTPServer(("127.0.0.1", 0), _handler(st))
    # poll_interval is what shutdown() waits on — teardown cost (docs/testing.md)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    st["_port"] = server.server_address[1]
    yield st
    server.shutdown()
    thread.join()


@pytest.fixture
def reloading_daemon() -> Iterator[dict[str, Any]]:
    # three 502s after the POST, then the updated form — the window to ride out
    yield from _spawn(reload_window=3)


@pytest.fixture
def dead_after_write_daemon() -> Iterator[dict[str, Any]]:
    # accepts the POST, then never serves again inside any deadline
    yield from _spawn(reload_window=10_000)


@pytest.fixture
async def speakers_manager(tmp_path: Path) -> AsyncIterator[ManagerBuilder]:
    clients: list[HttpConfigClient] = []

    def build(daemon: dict[str, Any], alarm_threshold: float = 5.0) -> ConnectionManager:
        http = HttpConfigClient("127.0.0.1", daemon["_port"], "u", "p")
        clients.append(http)
        cfg = Config(alarm_threshold=alarm_threshold, backup_dir=tmp_path, preset_dir=tmp_path / "presets")
        return ConnectionManager(cfg, http)

    yield build
    for http in clients:
        await http.aclose()


async def test_apply_rides_out_the_reload_window_and_confirms(
    speakers_manager: ManagerBuilder, reloading_daemon: dict[str, Any]
) -> None:
    manager = speakers_manager(reloading_daemon)
    result = await manager.applyops.apply_speakers(True, {"0": {"level": "-3"}})
    assert result["applied"] is True


async def test_the_applied_level_lands_on_the_daemon(
    speakers_manager: ManagerBuilder, reloading_daemon: dict[str, Any]
) -> None:
    manager = speakers_manager(reloading_daemon)
    await manager.applyops.apply_speakers(True, {"0": {"level": "-3"}})
    assert reloading_daemon["level_0"] == "-3"


async def test_a_confirmed_apply_reports_the_refreshed_form(
    speakers_manager: ManagerBuilder, reloading_daemon: dict[str, Any]
) -> None:
    manager = speakers_manager(reloading_daemon)
    result = await manager.applyops.apply_speakers(True, {"0": {"level": "-3"}})
    assert result["speakers"]["enabled"] is True


async def test_apply_gives_up_honestly_when_the_daemon_never_returns(
    speakers_manager: ManagerBuilder, dead_after_write_daemon: dict[str, Any]
) -> None:
    # the deadline passes with only 502s: report unconfirmed, never claim success
    manager = speakers_manager(dead_after_write_daemon, alarm_threshold=2.0)
    result = await manager.applyops.apply_speakers(True, {"0": {"level": "-3"}})
    assert result["applied"] is False
