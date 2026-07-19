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
import functools
import io
import re
import threading
import urllib.parse
import zipfile
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
    # underscore keys are internal to the fake (VolumeRange source), not emitted in State
    "_vol_min": "-60",
    "_vol_max": "0",
    "_vol_enabled": "1",
    "_vol_adaptive": "0",
    "_metadata": "",  # optional <metadata> child injected into the Status frame
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
    if name == "GetLicense":
        return '<GetLicense valid="1" name="Fake Licensee" fingerprint="AAAA"/>'
    if name == "ConfigurationGet":
        return f'<ConfigurationGet result="OK" value="{state.get("_active_config", "")}"/>'
    if name == "State":
        return "<State " + " ".join(f'{k}="{v}"' for k, v in state.items() if not k.startswith("_")) + "/>"
    if name == "VolumeRange":
        return (
            f'<VolumeRange min="{state["_vol_min"]}" max="{state["_vol_max"]}" '
            f'enabled="{state["_vol_enabled"]}" adaptive="{state["_vol_adaptive"]}"/>'
        )
    if name == "Status":
        # active_* live on the Status root; the track <metadata> child is where the
        # daemon emits unescaped chars mid-playback (_metadata override).
        return (
            f'<Status state="{state["state"]}" active_mode="PCM" '
            f'active_filter="poly-sinc-gauss-long" active_shaper="NS9" '
            f'active_rate="192000" volume="{state["volume"]}">'
            f'{state["_metadata"]}</Status>'
        )
    if name == "Volume" and state["_vol_enabled"] == "0":
        return '<Volume result="Error"/>'  # volume control disabled (protocol.md §7.3)
    value = attrs.get("value")
    if value == "err":
        return f'<{name} result="Error">bad value</{name}>'
    if value != "999":  # 999 = OK but not applied (readback-verify caveat)
        _apply(name, attrs, state)
    return f'<{name} result="OK"/>'


async def _serve(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    overrides: dict[str, str] | None = None,
) -> None:
    state = {**_DEFAULTS, **(overrides or {})}
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


@pytest.fixture
async def garbled_metadata_client() -> AsyncIterator[ControlClient]:
    """Daemon whose Status carries a track <metadata> child with unescaped chars
    — the real 6.0.4 quirk that hangs a strict receiver during playback. A bare
    '<' inside an attribute can't be repaired by the bare-'&' fix, so the root's
    active_* must be recovered by dropping the child (control.py _recover_root)."""
    bad = '<metadata artist="A&B" album="Foo <Bar> Baz"/>'
    serve = functools.partial(_serve, overrides={"_metadata": bad})
    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]
    client = ControlClient("127.0.0.1", port, timeout=2.0)
    await client.connect()
    yield client
    await client.close()
    server.close()
    await server.wait_closed()


@pytest.fixture
async def disabled_volume_client() -> AsyncIterator[ControlClient]:
    """A fake daemon with volume control disabled (VolumeRange enabled=0), so a
    Volume write is rejected — the live-slider gray/error case."""
    serve = functools.partial(_serve, overrides={"_vol_enabled": "0"})
    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    port: int = server.sockets[0].getsockname()[1]
    client = ControlClient("127.0.0.1", port, timeout=2.0)
    await client.connect()
    yield client
    await client.close()
    server.close()
    await server.wait_closed()


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


def _matrix_render(state: dict[str, Any]) -> str:
    # the /matrix post-processing form: a crossfeed field + a file input that a
    # correct serializer must omit (no readable value to round-trip).
    rows = [
        f'<input type="checkbox" name="post_bauer_enabled" value="1"'
        f'{" checked" if state["post_bauer_enabled"] else ""}/>',
        f'<input type="number" name="post_bauer_frequency" value="{state["post_bauer_frequency"]}"/>',
        '<input type="file" name="filter_0"/>',
        '<input formaction="/matrix" type="submit" value="Apply"/>',
    ]
    return '<form method="post">' + "".join(rows) + "</form>"


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
    if path == "/matrix":
        return 200, _matrix_render(state).encode()
    if path == "/backup/settings.zip":
        return 200, _backup_zip(state)
    return 404, b""


def _http_apply_matrix(state: dict[str, Any], raw: bytes) -> None:
    # the /matrix form has file inputs, so the daemon applies only a multipart
    # submission; the value fields arrive as multipart parts (regex-extracted).
    m = re.search(rb'name="post_bauer_frequency"\r\n\r\n([^\r\n]*)', raw)
    if m:
        state["post_bauer_frequency"] = m.group(1).decode()
        state["post_bauer_enabled"] = b'name="post_bauer_enabled"' in raw


def _http_apply_config(state: dict[str, Any], data: dict[str, str]) -> None:
    if not _http_accepts(data):
        return
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
            raw = self.rfile.read(length)
            if self.path == "/restore":
                _restore_engine(state, self.headers.get("Content-Type", ""), raw)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"<html>Restore</html>")
                return
            if self.path == "/matrix":
                # only a multipart submission applies; urlencoded is ignored (200,
                # no change) exactly as the real daemon does.
                if self.headers.get("Content-Type", "").startswith("multipart/form-data"):
                    _http_apply_matrix(state, raw)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"OK")
                return
            data = dict(urllib.parse.parse_qsl(raw.decode()))
            _http_apply_config(state, data)
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
        "post_bauer_enabled": True,
        "post_bauer_frequency": "700",
        "_lag": 0,
        # engine hardware-accel attrs, carried in the /backup archive's <engine>
        # tag; POST /restore rewrites them (the file-only lane).
        "_engine": {"cuda": "1", "multicore": "1", "nblocks": "16"},
        **extra,
    }


def _backup_zip(state: dict[str, Any]) -> bytes:
    e = state["_engine"]
    xml = (
        f'<config><engine auto_family="1" cuda="{e["cuda"]}" '
        f'multicore="{e["multicore"]}" nblocks="{e["nblocks"]}"/>'
        f'<matrix keep="me"/></config>'
    ).encode()
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("hqplayerd.xml", xml)
    return out.getvalue()


def _restore_engine(state: dict[str, Any], content_type: str, raw: bytes) -> None:
    # extract the uploaded cfgfile (a zip) from the multipart body, read its
    # <engine> attributes, and adopt them — the daemon re-reads config on restore.
    boundary = content_type.split("boundary=")[1].encode()
    zbytes = b""
    for part in raw.split(b"--" + boundary):
        if b'name="cfgfile"' in part:
            zbytes = part.split(b"\r\n\r\n", 1)[1].rsplit(b"\r\n", 1)[0]
    xml = zipfile.ZipFile(io.BytesIO(zbytes)).read("hqplayerd.xml")
    for attr in ("cuda", "multicore", "nblocks"):
        m = re.search(rb"\b" + attr.encode() + rb'="([^"]*)"', xml)
        if m:
            state["_engine"][attr] = m.group(1).decode()


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
