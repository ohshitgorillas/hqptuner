"""HTTP-lane persistent apply, end to end through a faithful fake config daemon
(docs/testing.md). The fake speaks the real wire contract discovered on 6.0.4:

- it rejects a partial form (a real daemon answers "Failed!" and writes nothing);
- it rejects a checkbox sent as anything but "1" (the `on`-vs-`1` bug);
- it answers HTTP 200 even when it rejects, updating its state only on accept,
  and its GET reflects the persisted state.

So a change only "round-trips" if `manager.apply` produced a submission the real
daemon would accept — any serialization fault (dropped field, `on`, partial)
makes the fake reject and the readback fail."""

import threading
import urllib.parse
from collections.abc import AsyncIterator, Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import pytest

from hqptuner.config import Config
from hqptuner.httpconf import HttpConfigClient
from hqptuner.manager import ConnectionManager

_TEXT = ("title", "backend")  # required, non-checkbox
_CHECK = ("dsd_6db", "net_dop")


def _render(state: dict[str, Any]) -> str:
    rows = [f'<input type="text" name="title" value="{state["title"]}" required/>']
    options = "".join(
        f'<option value="{v}"{" selected" if state["backend"] == v else ""}>{v}</option>' for v in ("alsa", "network")
    )
    rows.append(f'<select name="backend">{options}</select>')
    rows += [f'<input type="checkbox" name="{cb}" value="1"{" checked" if state[cb] else ""}/>' for cb in _CHECK]
    rows.append('<input formaction="/config" type="submit" value="Apply"/>')
    return '<form method="post">' + "".join(rows) + "</form>"


def _accepts(data: dict[str, str]) -> bool:
    if any(t not in data for t in _TEXT):  # partial form
        return False
    if any(data.get(cb, "1") != "1" for cb in _CHECK):  # checkbox must be "1", never "on"
        return False
    return data["title"] != "REJECT"  # models a value-level rejection


def _handler(state: dict[str, Any]) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path == "/config":
                # right after an accepted POST the real daemon keeps serving the
                # pre-restart form for a few reads before it reloads
                if state.get("_stale", 0) > 0:
                    state["_stale"] -= 1
                    body = _render(state["_snapshot"]).encode()
                else:
                    body = _render(state).encode()
            elif self.path == "/backup/settings.zip":
                body = b"PK\x03\x04"
            else:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))
            data = dict(urllib.parse.parse_qsl(self.rfile.read(length).decode()))
            if _accepts(data):
                state["_snapshot"] = {k: state[k] for k in (*_TEXT, *_CHECK)}
                state["title"] = data["title"]
                state["backend"] = data["backend"]
                for cb in _CHECK:
                    state[cb] = cb in data
                state["_stale"] = state.get("_lag", 0)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"OK" if _accepts(data) else b"Failed!")

        def log_message(self, *_: object) -> None:
            pass

    return Handler


def _spawn(state: dict[str, Any]) -> Iterator[dict[str, Any]]:
    server = HTTPServer(("127.0.0.1", 0), _handler(state))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    state["_port"] = server.server_address[1]
    yield state
    server.shutdown()
    thread.join()


@pytest.fixture
def daemon() -> Iterator[dict[str, Any]]:
    state: dict[str, Any] = {"title": "Opal", "backend": "network", "dsd_6db": True, "net_dop": False, "_lag": 0}
    yield from _spawn(state)


@pytest.fixture
def stale_daemon() -> Iterator[dict[str, Any]]:
    # serves the pre-restart form for one read before catching up, like a restart
    state: dict[str, Any] = {"title": "Opal", "backend": "network", "dsd_6db": True, "net_dop": False, "_lag": 1}
    yield from _spawn(state)


@pytest.fixture
async def apply_via(
    daemon: dict[str, Any],
) -> AsyncIterator[tuple[ConnectionManager, HttpConfigClient]]:
    http = HttpConfigClient("127.0.0.1", daemon["_port"], "u", "p")
    # small verify window: a rejected apply polls until it times out
    manager = ConnectionManager(Config(alarm_threshold=1.0), http)
    yield manager, http
    await http.aclose()


async def _readback(http: HttpConfigClient) -> dict[str, Any]:
    return {f["name"]: f["value"] for f in (await http.get_config())["fields"]}


async def test_staged_persistent_change_is_applied(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    manager, http = apply_via
    await manager.apply({}, {"title": "Renamed"})
    assert (await _readback(http))["title"] == "Renamed"


async def test_enabling_a_checkbox_is_applied(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    manager, http = apply_via
    await manager.apply({}, {"net_dop": "1"})
    assert (await _readback(http))["net_dop"] is True


async def test_apply_reports_failure_when_the_daemon_rejects(
    apply_via: tuple[ConnectionManager, HttpConfigClient],
) -> None:
    manager, _ = apply_via
    report = await manager.apply({}, {"title": "REJECT"})
    assert report["http"]["verified"]["applied"] is False


async def test_apply_verifies_through_the_post_restart_stale_window(
    stale_daemon: dict[str, Any],
) -> None:
    # the daemon serves the old form for a read after the POST; a single-GET
    # verify would false-negative here — the poll must ride through the stale read
    http = HttpConfigClient("127.0.0.1", stale_daemon["_port"], "u", "p")
    manager = ConnectionManager(Config(alarm_threshold=3.0), http)
    try:
        report = await manager.apply({}, {"title": "Renamed"})
    finally:
        await http.aclose()
    assert report["http"]["verified"]["applied"] is True
