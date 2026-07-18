"""Shared fixtures: a stateful fake hqplayerd speaking real Control API XML
over a real socket (docs/testing.md — fakes speak the wire protocol).

The fake keeps a per-connection settings dict and answers setters + State from
it, so a `Set*` followed by `State` reads back the change — enough to exercise
the readback-verify path. Two quirks are modelled for the write-path tests:
`value="999"` returns `result="OK"` without applying (the OK-but-not-applied
caveat, protocol.md §6); `value="err"` returns `result="Error"`; and `SetMode`
resets `rate` to `0` (mode swaps the lists rate is relative to), which lets a
test prove apply order (mode before rate)."""

import asyncio
import threading
import urllib.parse
from collections.abc import AsyncIterator, Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

import pytest
from defusedxml.ElementTree import fromstring as _fromstring

from hqptuner.control import ControlClient

XML = '<?xml version="1.0" encoding="UTF-8"?>'

_DEFAULTS = {
    "state": "0",
    "mode": "1",
    "filter1x": "0",
    "filterNx": "0",
    "shaper": "0",
    "rate": "0",
    "filter_junk": "0",
    "adaptive": "0",
    "volume": "-10.0",
}


def _apply(name: str, attrs: dict[str, str], state: dict[str, str]) -> None:
    value = attrs.get("value", "")
    if name == "SetMode":
        state["mode"] = value
        state["rate"] = "0"  # mode resets rate to auto (protocol.md §6)
    elif name == "SetFilter":
        state["filterNx"] = value
        state["filter1x"] = attrs.get("value1x", value)
    elif name == "SetShaping":
        state["shaper"] = value
    elif name == "SetRate":
        state["rate"] = value
    elif name == "SetJunkFilter":
        state["filter_junk"] = value
    elif name == "SetAdaptiveVolume":
        state["adaptive"] = value
    elif name == "Volume":
        state["volume"] = value


def _handle(body: str, state: dict[str, str]) -> str:
    el = _fromstring(body)
    name, attrs = el.tag, el.attrib
    if name == "GetInfo":
        return '<GetInfo name="Fake" engine="6.0.4" version="6"/>'
    if name == "State":
        return "<State " + " ".join(f'{k}="{v}"' for k, v in state.items()) + "/>"
    value = attrs.get("value")
    if value == "err":
        return f'<{name} result="Error">bad value</{name}>'
    if value != "999":  # 999 = OK but not applied (readback-verify caveat)
        _apply(name, attrs, state)
    return f'<{name} result="OK"/>'


async def _serve(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    state = dict(_DEFAULTS)
    while True:
        data = await reader.read(4096)
        if not data:
            break
        body = data.split(b"?>", 1)[-1].strip().decode()
        writer.write(f"{XML}{_handle(body, state)}\n".encode())
        await writer.drain()


@pytest.fixture
async def live_daemon_port() -> AsyncIterator[int]:
    server = await asyncio.start_server(_serve, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]
    yield port
    server.close()
    await server.wait_closed()


@pytest.fixture
async def live_client(live_daemon_port: int) -> AsyncIterator[ControlClient]:
    client = ControlClient("127.0.0.1", live_daemon_port, timeout=2.0)
    await client.connect()
    yield client
    await client.close()


# --- faithful fake HTTP config daemon (port 8088 lane) --------------------
#
# Speaks the POST /config wire contract discovered on 6.0.4 (docs/protocol.md
# §3.6): it rejects a partial form, rejects a checkbox sent as anything but "1",
# answers HTTP 200 even when it rejects, and its GET reflects persisted state.
# A change only round-trips if the client produced a submission the real daemon
# would accept, so a serialization fault makes the fake reject and readback fail.

_HTTP_TEXT = ("title", "backend")  # required, non-checkbox
_HTTP_CHECK = ("dsd_6db", "net_dop", "auto_family")
_HTTP_VALUE = ("samplerate", "bitrate")  # value fields the friendly-rate UI pins to Auto


def _http_render(state: dict[str, Any]) -> str:
    rows = [f'<input type="text" name="title" value="{state["title"]}" required/>']
    options = "".join(
        f'<option value="{v}"{" selected" if state["backend"] == v else ""}>{v}</option>' for v in ("alsa", "network")
    )
    rows.append(f'<select name="backend">{options}</select>')
    rows += [f'<input type="text" name="{n}" value="{state[n]}"/>' for n in _HTTP_VALUE]
    rows += [f'<input type="checkbox" name="{cb}" value="1"{" checked" if state[cb] else ""}/>' for cb in _HTTP_CHECK]
    rows.append('<input formaction="/config" type="submit" value="Apply"/>')
    return '<form method="post">' + "".join(rows) + "</form>"


def _http_accepts(data: dict[str, str]) -> bool:
    if any(t not in data for t in _HTTP_TEXT):  # partial form
        return False
    if any(data.get(cb, "1") != "1" for cb in _HTTP_CHECK):  # checkbox must be "1", never "on"
        return False
    return data["title"] != "REJECT"  # models a value-level rejection


def _http_get_response(state: dict[str, Any], path: str) -> tuple[int, bytes]:
    if state.get("_down"):  # accepted the POST, then never came back
        return 503, b""
    if path == "/config":
        # right after an accepted POST the real daemon keeps serving the
        # pre-restart form for a few reads before it reloads
        if state.get("_stale", 0) > 0:
            state["_stale"] -= 1
            return 200, _http_render(state["_snapshot"]).encode()
        return 200, _http_render(state).encode()
    if path == "/backup/settings.zip":
        return 200, b"PK\x03\x04"
    return 404, b""


def _http_handler(state: dict[str, Any]) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            status, body = _http_get_response(state, self.path)
            self.send_response(status)
            self.end_headers()
            if body:
                self.wfile.write(body)

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))
            data = dict(urllib.parse.parse_qsl(self.rfile.read(length).decode()))
            if _http_accepts(data):
                state["_snapshot"] = {k: state[k] for k in (*_HTTP_TEXT, *_HTTP_VALUE, *_HTTP_CHECK)}
                state["title"] = data["title"]
                state["backend"] = data["backend"]
                for n in _HTTP_VALUE:
                    if n in data:
                        state[n] = data[n]
                for cb in _HTTP_CHECK:
                    state[cb] = cb in data
                state["_stale"] = state.get("_lag", 0)
                if state.get("_die"):
                    state["_down"] = True  # restart that never recovers
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"OK" if _http_accepts(data) else b"Failed!")

        def log_message(self, *_: object) -> None:
            pass

    return Handler


def _http_spawn(state: dict[str, Any]) -> Iterator[dict[str, Any]]:
    server = HTTPServer(("127.0.0.1", 0), _http_handler(state))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    state["_port"] = server.server_address[1]
    yield state
    server.shutdown()
    thread.join()


def _http_state(**extra: Any) -> dict[str, Any]:
    # forced-field defaults deliberately DIFFER from what HQPTuner pins on write
    # (auto_family off, rates non-zero), so a forcing test proves a real change.
    return {
        "title": "Opal",
        "backend": "network",
        "dsd_6db": True,
        "net_dop": False,
        "auto_family": False,
        "samplerate": "192000",
        "bitrate": "22579200",
        "_lag": 0,
        **extra,
    }


@pytest.fixture
def http_daemon() -> Iterator[dict[str, Any]]:
    yield from _http_spawn(_http_state())


@pytest.fixture
def stale_http_daemon() -> Iterator[dict[str, Any]]:
    # serves the pre-restart form for one read before catching up, like a restart
    yield from _http_spawn(_http_state(_lag=1))


@pytest.fixture
def dying_http_daemon() -> Iterator[dict[str, Any]]:
    # accepts the POST, then goes unreachable and never returns — a failed restart
    yield from _http_spawn(_http_state(_die=True))
