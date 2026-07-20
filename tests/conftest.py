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
import zipfile
from collections.abc import AsyncIterator, Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.parse import parse_qs

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
# Speaks the restore/XML write contract (docs/protocol.md §3.6): GET /backup
# serves a real hqplayerd.xml the daemon would produce, POST /restore adopts the
# uploaded working config, and GET /config + /matrix render the current state.
# The XML schema here is authored to match 6.0.4 INDEPENDENTLY of presetconf, so
# a wrong form->XML mapping in the writer surfaces as a failed readback — not a
# self-confirming round-trip. A change only lands if manager.apply produced a
# restore archive the real daemon would accept.


def _b(v: Any) -> str:
    return "1" if v in (True, "1", 1) else "0"


def _cfg_xml(st: dict[str, Any]) -> bytes:
    """The working hqplayerd.xml a /backup would carry, rendered from state."""
    net_addr, _, net_dev = st["net_device"].partition("/")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n<hqplayerd>'
        f'<output type="{st["backend"]}"/>'
        f'<title value="{st["title"]}"/>'
        '<mode value="sdm"/>'
        f'<pcm filter="{st["filter"]}" filter1x="47" dither="3" samplerate="{st["samplerate"]}"/>'
        f'<sdm oversampling="41" oversampling1x="42" modulator="12" bitrate="{st["bitrate"]}"/>'
        '<log enabled="1" file="/tmp/hqplayerd.log"/><upnp freewheel="0"/>'
        f'<engine auto_family="{_b(st["auto_family"])}" channels="{st["channels"]}" '
        f'cuda="{st["cuda"]}" multicore="{st["multicore"]}" nblocks="{st["nblocks"]}">'
        '<defaults samplerate="192000" bitrate="24576000" volume="-3"/>'
        f'<network address="{net_addr}" device="{net_dev}" ipv6="{_b(st["net_ipv6"])}" '
        'dac_bits="15" period_time="0"/>'
        '<alsa device="hw:CARD=NVidia,DEV=3" dac_bits="24" period_time="100"/>'
        # <post_process> nests INSIDE <matrix>, exactly as 6.0.4 writes it (readme
        # §1.11 / §1.11.2). The matrix switch gates the whole plugin chain, so a
        # writer that enables a plugin without enabling the matrix produces an inert
        # config — modelled here so that failure surfaces in tests, not in a listening
        # room. Default OFF: the real-world preset that exposed this had matrix="0".
        f'<matrix enabled="{_b(st["matrix_enabled"])}" engine="1" expand_hf="0" iir2fir="0">'
        "<post_process>"
        '<plugin type="correction" enabled="0" dac0=""/>'
        f'<plugin type="bauer" enabled="{_b(st["post_bauer_enabled"])}" '
        f'frequency="{st["post_bauer_frequency"]}" preset="default" level="4.5"/>'
        f'<plugin type="loudness" enabled="{_b(st["post_loudness_enabled"])}" '
        f'low_frequency="{st["post_loudness_lowfreq"]}" low_level="20" low_steepness="0.5" low_type="lshelf" '
        'high_frequency="5000" high_level="10" high_steepness="1.0" high_type="hshelf" '
        'range_low="-60" range_high="-20"/>'
        "</post_process>"
        "</matrix>"
        "</engine>"
        "</hqplayerd>"
    ).encode()


def _elem_attr(xml: bytes, tag: str, attr: str) -> str | None:
    m = re.search(rb"<" + tag.encode() + rb"\b[^>]*?>", xml)
    if not m:
        return None
    a = re.search(rb"\b" + attr.encode() + rb'="([^"]*)"', m.group(0))
    return a.group(1).decode() if a else None


def _adopt_net_device(st: dict[str, Any], xml: bytes) -> None:
    """Adopt the uploaded net_device only when it is an endpoint the daemon can
    bind; a device outside the offered set is refused (endpoint gone), which no
    restart conjures back — the unfixable-divergence case."""
    addr = _elem_attr(xml, "network", "address")
    dev = _elem_attr(xml, "network", "device")
    if addr is not None and dev is not None and f"{addr}/{dev}" in st["_net_endpoints"]:
        st["net_device"] = f"{addr}/{dev}"


def _adopt_matrix(st: dict[str, Any], xml: bytes) -> None:
    """Adopt the uploaded ``<matrix enabled>`` — the carrier switch for the whole
    post-process chain. Read independently of presetconf."""
    enabled = _elem_attr(xml, "matrix", "enabled")
    if enabled is not None:
        st["matrix_enabled"] = enabled == "1"


def _adopt_plugins(st: dict[str, Any], xml: bytes) -> None:
    """Adopt post_process plugin attrs from an uploaded config — the daemon
    re-reading its <plugin> nodes. Reads by XML attribute name (low_frequency,
    frequency, ...) independently of presetconf, so a wrong form->XML mapping in
    the writer surfaces here as a value that never lands."""
    for m in re.finditer(rb"<plugin\b[^>]*?>", xml):
        tag = m.group(0)
        if b'type="bauer"' in tag:
            freq = re.search(rb'\bfrequency="([^"]*)"', tag)
            enabled = re.search(rb'\benabled="([^"]*)"', tag)
            if freq:
                st["post_bauer_frequency"] = freq.group(1).decode()
            if enabled:
                st["post_bauer_enabled"] = enabled.group(1) == b"1"
        elif b'type="loudness"' in tag:
            lowfreq = re.search(rb'\blow_frequency="([^"]*)"', tag)
            enabled = re.search(rb'\benabled="([^"]*)"', tag)
            if lowfreq:
                st["post_loudness_lowfreq"] = lowfreq.group(1).decode()
            if enabled:
                st["post_loudness_enabled"] = enabled.group(1) == b"1"


def _adopt_cfg(st: dict[str, Any], xml: bytes) -> None:
    """Update state from an uploaded working hqplayerd.xml — the daemon re-reading
    its config on restore. Reads the schema independently of the writer."""

    def take(key: str, tag: str, attr: str) -> None:
        v = _elem_attr(xml, tag, attr)
        if v is not None:
            st[key] = v

    for key, tag, attr in (
        ("backend", "output", "type"),
        ("title", "title", "value"),
        ("filter", "pcm", "filter"),
        ("samplerate", "pcm", "samplerate"),
        ("bitrate", "sdm", "bitrate"),
        ("channels", "engine", "channels"),
        ("cuda", "engine", "cuda"),
        ("multicore", "engine", "multicore"),
        ("nblocks", "engine", "nblocks"),
    ):
        take(key, tag, attr)
    af = _elem_attr(xml, "engine", "auto_family")
    if af is not None:
        st["auto_family"] = af == "1"
    ipv6 = _elem_attr(xml, "network", "ipv6")
    if ipv6 is not None:
        st["net_ipv6"] = ipv6 == "1"
    _adopt_net_device(st, xml)
    _adopt_matrix(st, xml)
    _adopt_plugins(st, xml)


def _backup_zip(st: dict[str, Any]) -> bytes:
    xml = _cfg_xml(st)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("hqplayerd.xml", xml)
        z.writestr("data/cfgs/Test.xml", xml)
        z.writestr("data/library.xml", b"<library/>")
        # presets saved via POST /config/profile/save appear as their own snapshot
        for name, saved in st.get("_saved", {}).items():
            z.writestr(f"data/cfgs/{name}.xml", saved)
    return out.getvalue()


def _empty_backup_zip() -> bytes:
    """The archive hqplayerd 6.0.4 serves after a named profile/load until it is
    restarted — a bare data/ with no base config (docs/protocol.md §3.6 bug)."""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("data/", b"")
    return out.getvalue()


def _http_render(st: dict[str, Any]) -> str:
    """GET /config form — the read side, rendered from state."""
    opts = "".join(
        f'<option value="{v}"{" selected" if st["backend"] == v else ""}>{v}</option>' for v in ("alsa", "network")
    )
    dev_opts = "".join(
        f'<option value="{v}"{" selected" if st["net_device"] == v else ""}>{v}</option>' for v in st["_net_endpoints"]
    )
    rows = [
        f'<input type="text" name="title" value="{st["title"]}"/>',
        f'<select name="backend">{opts}</select>',
        f'<select name="net_device">{dev_opts}</select>',
        f'<input type="text" name="filter" value="{st["filter"]}"/>',
        f'<input type="text" name="samplerate" value="{st["samplerate"]}"/>',
        f'<input type="text" name="bitrate" value="{st["bitrate"]}"/>',
        f'<input type="text" name="channels" value="{st["channels"]}"/>',
        f'<input type="checkbox" name="auto_family" value="1"{" checked" if st["auto_family"] else ""}/>',
        f'<input type="checkbox" name="net_ipv6" value="1"{" checked" if st["net_ipv6"] else ""}/>',
    ]
    return '<form method="post">' + "".join(rows) + "</form>"


def _matrix_render(st: dict[str, Any]) -> str:
    rows = [
        f'<input type="checkbox" name="post_bauer_enabled" value="1"{" checked" if st["post_bauer_enabled"] else ""}/>',
        f'<input type="number" name="post_bauer_frequency" value="{st["post_bauer_frequency"]}"/>',
        f'<input type="checkbox" name="post_loudness_enabled" value="1"'
        f'{" checked" if st["post_loudness_enabled"] else ""}/>',
        f'<input type="number" name="post_loudness_lowfreq" value="{st["post_loudness_lowfreq"]}"/>',
        '<input type="file" name="filter_0"/>',
    ]
    return '<form method="post">' + "".join(rows) + "</form>"


def _http_get_response(st: dict[str, Any], path: str) -> tuple[int, bytes]:
    if st.get("_down"):  # restore accepted, daemon never came back
        return 503, b""
    if path == "/config/refresh":  # webUI: a bare GET in a method=get form
        _refresh_devices(st)
        return 200, b""
    if path == "/config":
        return 200, _http_render(st).encode()
    if path == "/matrix":
        return 200, _matrix_render(st).encode()
    if path == "/backup/settings.zip":
        if st.get("_empty"):  # post-profile-load bug window: bare data/, no base config
            return 200, _empty_backup_zip()
        # after a restore the daemon serves the pre-restart archive for a read or
        # two before catching up — the restart window verify must ride through
        if st.get("_stale", 0) > 0:
            st["_stale"] -= 1
            return 200, st["_pre_backup"]
        return 200, _backup_zip(st)
    return 404, b""


def _restore_config(st: dict[str, Any], content_type: str, raw: bytes) -> None:
    boundary = content_type.split("boundary=")[1].encode()
    zbytes = b""
    for part in raw.split(b"--" + boundary):
        if b'name="cfgfile"' in part:
            zbytes = part.split(b"\r\n\r\n", 1)[1].rsplit(b"\r\n", 1)[0]
    xml = zipfile.ZipFile(io.BytesIO(zbytes)).read("hqplayerd.xml")
    if _elem_attr(xml, "title", "value") == "REJECT":
        return  # modeled value-level rejection: the daemon refuses, state unchanged
    st["_pre_backup"] = _backup_zip(st)  # snapshot before adopting, for the stale window
    _adopt_cfg(st, xml)
    st["_stale"] = st.get("_lag", 0)
    if st.get("_die"):
        st["_down"] = True


def _refresh_devices(st: dict[str, Any]) -> None:
    """POST /config/refresh — re-scan output devices. Endpoints that were powered
    off (staged in _hidden_endpoints) become bindable and join the offered set,
    modelling a NAA that came back on since the last form read."""
    for ep in st.get("_hidden_endpoints", []):
        if ep not in st["_net_endpoints"]:
            st["_net_endpoints"].append(ep)
    st["_hidden_endpoints"] = []


def _save_profile(st: dict[str, Any], raw: bytes) -> None:
    """POST /config/profile/save — freeze the current working config as a named
    preset snapshot, so a later /backup carries it as data/cfgs/<name>.xml."""
    name = parse_qs(raw.decode()).get("profile_name", [""])[0]
    if name:
        st.setdefault("_saved", {})[name] = _cfg_xml(st)


def _http_handler(st: dict[str, Any]) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            status, body = _http_get_response(st, self.path)
            self.send_response(status)
            self.end_headers()
            if body:
                self.wfile.write(body)

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            if self.path == "/restore":
                _restore_config(st, self.headers.get("Content-Type", ""), raw)
            elif self.path == "/config/profile/save":
                _save_profile(st, raw)
            self.send_response(200)  # /config, /matrix POST are unused by the restore lane
            self.end_headers()
            self.wfile.write(b"<html>Restore</html>")

        def log_message(self, *_: object) -> None:
            pass

    return Handler


def _http_spawn(st: dict[str, Any]) -> Iterator[dict[str, Any]]:
    server = HTTPServer(("127.0.0.1", 0), _http_handler(st))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    st["_port"] = server.server_address[1]
    yield st
    server.shutdown()
    thread.join()


def _http_state(**extra: Any) -> dict[str, Any]:
    # forced-field defaults deliberately DIFFER from what HQPTuner pins on write
    # (auto_family off, rates non-zero), so a forcing test proves a real change.
    return {
        "title": "Opal",
        "backend": "network",
        "filter": "40",
        "samplerate": "192000",
        "bitrate": "22579200",
        "channels": "2",
        "auto_family": False,
        "net_ipv6": False,
        "net_device": "S26/hw:CARD=Output,DEV=0",
        # endpoints the daemon can bind; a net_device outside this set is refused
        # on restore (endpoint gone) — the unfixable-divergence case
        "_net_endpoints": ["S26/hw:CARD=Output,DEV=0", "S30/hw:CARD=Other,DEV=0"],
        # powered-off endpoints a /config/refresh rescan makes bindable
        "_hidden_endpoints": [],
        "_saved": {},
        # the plugin chain lives inside <matrix>; on because bauer below is on
        "matrix_enabled": True,
        "post_bauer_enabled": True,
        "post_bauer_frequency": "700",
        "post_loudness_enabled": False,
        "post_loudness_lowfreq": "80",
        "cuda": "1",
        "multicore": "1",
        "nblocks": "16",
        "_lag": 0,
        **extra,
    }


@pytest.fixture
def http_daemon() -> Iterator[dict[str, Any]]:
    yield from _http_spawn(_http_state())


@pytest.fixture
def stale_http_daemon() -> Iterator[dict[str, Any]]:
    # serves the pre-restart archive for one backup read before catching up
    yield from _http_spawn(_http_state(_lag=1))


@pytest.fixture
def dying_http_daemon() -> Iterator[dict[str, Any]]:
    # accepts the restore, then goes unreachable and never returns
    yield from _http_spawn(_http_state(_die=True))
