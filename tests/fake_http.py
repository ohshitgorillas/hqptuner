"""Faithful fake hqplayerd HTTP config daemon (the port-8088 lane).

Speaks the restore/XML write contract (docs/protocol.md §3.6): GET /backup
serves a real hqplayerd.xml the daemon would produce, POST /restore adopts the
uploaded working config, and GET /config + /matrix render the current state.
The XML schema here is authored to match 6.0.4 INDEPENDENTLY of presetconf, so
a wrong form->XML mapping in the writer surfaces as a failed readback — not a
self-confirming round-trip. A change only lands if manager.apply produced a
restore archive the real daemon would accept.

`spawn` and `state` are the entry points; conftest wraps them as fixtures.
"""

import io
import re
import threading
import zipfile
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.parse import parse_qs


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
        # volume_fixed's XML domain is 0/1/2 (off / -3 dB / -6 dB) while the /config
        # form below renders it as a plain checkbox — the daemon's own lossy render,
        # modelled so the file-truth read path is genuinely exercised.
        f'<engine auto_family="{_b(st["auto_family"])}" channels="{st["channels"]}" '
        f'volume_fixed="{st["volume_fixed"]}" cuda_dev="{st["cuda_dev"]}" '
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
        f'<matrix enabled="{_b(st["matrix_enabled"])}" engine="{st["matrix_engine"]}" '
        f'expand_hf="{st["matrix_expand_hf"]}" iir2fir="{st["matrix_iir2fir"]}">'
        # pipeline rows render verbatim from adopted attr strings (incl. any "L"
        # gain prefix or entity escapes) — the fake never interprets them, so a
        # writer bug can't be laundered by a matching fake-side transform
        + "".join(
            f'<pipeline channel="{i}" gain="{p["gain"]}" mixdown="{p["mixdown"]}" '
            f'process="{p["process"]}" source="{p["source"]}"/>'
            for i, p in enumerate(st["_pipelines"])
        )
        + "<post_process>"
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
    for key, attr in (("matrix_engine", "engine"), ("matrix_expand_hf", "expand_hf"), ("matrix_iir2fir", "iir2fir")):
        v = _elem_attr(xml, "matrix", attr)
        if v is not None:
            st[key] = v
    _adopt_pipelines(st, xml)


def _adopt_pipelines(st: dict[str, Any], xml: bytes) -> None:
    """Adopt the ``<pipeline>`` rows inside ``<matrix>`` as raw attribute strings
    — no interpretation, so the next /backup serves back exactly what the writer
    produced (and only what it produced)."""
    m = re.search(rb"<matrix\b[^>]*>(.*?)</matrix>", xml, re.S)
    if m is None:
        return
    rows = [
        {k.decode(): v.decode() for k, v in re.findall(rb'(\w+)="([^"]*)"', pm.group(0))}
        for pm in re.finditer(rb"<pipeline\b[^>]*/>", m.group(1))
    ]
    if rows:
        st["_pipelines"] = rows


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
        ("cuda_dev", "engine", "cuda_dev"),
        ("multicore", "engine", "multicore"),
        ("nblocks", "engine", "nblocks"),
        ("volume_fixed", "engine", "volume_fixed"),
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
        # the daemon renders 0/1/2 as a bare checkbox: -3 dB and -6 dB are
        # indistinguishable here, which is why the file lane carries the truth
        f'<input type="checkbox" name="volume_fixed" value="1"{" checked" if st["volume_fixed"] != "0" else ""}/>',
    ]
    return '<form method="post">' + "".join(rows) + "</form>"


def _matrix_pipeline_row(i: int, source: str, mixdown: str, process: str) -> str:
    """One pipeline table row, markup-faithful to 6.0.4 — including the daemon's
    malformed gainunit options (`value="dB""`, a stray quote the browser and any
    tolerant parser read as value dB plus a junk attribute)."""
    ch = "".join(f'<option value="{v}"{" selected" if str(v) == source else ""}>{v + 1}</option>' for v in range(4))
    mix = "".join(f'<option value="{v}"{" selected" if str(v) == mixdown else ""}>{v + 1}</option>' for v in range(4))
    return (
        f"<tr><td>{i + 1}</td>"
        f'<td><select name="source_{i}">{ch}</select></td>'
        f'<td><input type="number" name="gain_{i}" value="0" step="0.01"/></td>'
        f'<td><select name="gainunit_{i}"><option value="dB"" selected>dB</option>'
        f'<option value="Lin"">Lin</option></select></td>'
        f'<td><select name="mixdown_{i}">{mix}</select></td>'
        f'<td><input type="text" size="128" name="process_{i}" value="{process}"></td>'
        f'<td><input type="checkbox" name="plot_{i}" value="1"/></td>'
        f'<td><input type="file" accept="wav,txt" name="filter_{i}" multiple/></td></tr>'
    )


def _matrix_render(st: dict[str, Any]) -> str:
    """GET /matrix — markup-faithful to the real 6.0.4 page: global controls,
    profile input + datalist + active label, indexed pipeline table, post-process
    plugin fields."""
    profs = "".join(f'<option value="{p}">{p}</option>' for p in st["_matrix_profiles"])
    pipelines = _matrix_pipeline_row(0, "0", "0", st["process_0"]) + _matrix_pipeline_row(1, "1", "1", "")
    parts = [
        '<h2>Matrix pipeline</h2><input type="checkbox" name="enabled" value="1" checked/>',
        '<select name="engine"><option value="0">overlap-save</option>'
        '<option value="1" selected>overlap-add</option></select>',
        '<input type="checkbox" name="expand_hf" value="1"/>',
        '<select name="iir2fir"><option value="0" selected>none</option>'
        '<option value="1">direct</option><option value="2">linear</option></select>',
        f'<b>Active: </b>{st["matrix_active"]}<br>',
        f'<input type="text" size="64" name="profile" list="profile_items"/><datalist id="profile_items">{profs}'
        "</datalist>",
        f"<table>{pipelines}</table>",
        f'<input type="checkbox" name="post_bauer_enabled" value="1"{" checked" if st["post_bauer_enabled"] else ""}/>',
        f'<input type="number" name="post_bauer_frequency" value="{st["post_bauer_frequency"]}"/>',
        f'<input type="checkbox" name="post_loudness_enabled" value="1"'
        f'{" checked" if st["post_loudness_enabled"] else ""}/>',
        f'<input type="number" name="post_loudness_lowfreq" value="{st["post_loudness_lowfreq"]}"/>',
    ]
    return '<form method="post" enctype="multipart/form-data">' + "".join(parts) + "</form>"


def _http_get_response(st: dict[str, Any], path: str) -> tuple[int, bytes]:
    if st.get("_down"):  # restore accepted, daemon never came back
        return 503, b""
    if path == "/config/refresh":  # webUI: a bare GET in a method=get form
        _refresh_devices(st)
        return 200, b""
    if path == "/log":
        return 200, st["_log"].encode()
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
    archive = zipfile.ZipFile(io.BytesIO(zbytes))
    st["_restore_members"] = archive.namelist()  # what the restore carried (filter uploads land as data/*)
    xml = archive.read("hqplayerd.xml")
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


def _parse_multipart_fields(content_type: str, raw: bytes) -> dict[str, str]:
    """Non-file fields of a multipart POST (or urlencoded fallback)."""
    if "boundary=" not in content_type:
        return {k: v[0] for k, v in parse_qs(raw.decode()).items()}
    boundary = content_type.split("boundary=")[1].encode()
    fields: dict[str, str] = {}
    for part in raw.split(b"--" + boundary):
        head, _, body = part.partition(b"\r\n\r\n")
        m = re.search(rb'name="([^"]+)"', head)
        if m is None or b"filename=" in head:
            continue
        fields[m.group(1).decode()] = body.rsplit(b"\r\n", 1)[0].decode()
    return fields


def _matrix_profile_post(st: dict[str, Any], action: str, fields: dict[str, str]) -> None:
    """POST /matrix/{load,save,delete} — mutate the profile list / active label
    and record the posted fields verbatim, so tests can assert the complete-form
    contract and the checkbox encoding the real daemon demands. ``load``
    replaces the whole matrix context INCLUDING post-process — bauer/loudness
    enables cleared — exactly as the live 6.0.4 does (probe finding)."""
    st["_matrix_post"] = fields
    name = fields.get("profile", "")
    profiles: list[str] = st["_matrix_profiles"]
    if action == "save" and name and name not in profiles:
        profiles.append(name)
    elif action == "delete" and name in profiles:
        profiles.remove(name)
    elif action == "load":
        st["matrix_active"] = name or "[Default]"
        st["post_bauer_enabled"] = False
        st["post_loudness_enabled"] = False


def _matrix_apply_post(st: dict[str, Any], fields: dict[str, str]) -> None:
    """Plain POST /matrix (Apply) — adopt the submitted post-process fields into
    the working state, browser-faithful checkbox semantics (present = on)."""
    st["_matrix_apply_post"] = fields
    st["post_bauer_enabled"] = "post_bauer_enabled" in fields
    st["post_loudness_enabled"] = "post_loudness_enabled" in fields
    if "post_bauer_frequency" in fields:
        st["post_bauer_frequency"] = fields["post_bauer_frequency"]
    if "post_loudness_lowfreq" in fields:
        st["post_loudness_lowfreq"] = fields["post_loudness_lowfreq"]


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
            elif self.path.startswith("/matrix/"):
                action = self.path.rsplit("/", 1)[1]
                _matrix_profile_post(st, action, _parse_multipart_fields(self.headers.get("Content-Type", ""), raw))
            elif self.path == "/matrix":
                _matrix_apply_post(st, _parse_multipart_fields(self.headers.get("Content-Type", ""), raw))
            self.send_response(200)  # /config POST is unused by the restore lane
            self.end_headers()
            self.wfile.write(b"<html>Restore</html>")

        def log_message(self, *_: object) -> None:
            pass

    return Handler


def spawn(st: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Serve `st` on a loopback port until the generator is closed. Yields the
    state dict with `_port` filled in — tests read and mutate it directly."""
    server = HTTPServer(("127.0.0.1", 0), _http_handler(st))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    st["_port"] = server.server_address[1]
    yield st
    server.shutdown()
    thread.join()


def state(**extra: Any) -> dict[str, Any]:
    # forced-field defaults deliberately DIFFER from what HQPTuner pins on write
    # (auto_family off, rates non-zero), so a forcing test proves a real change.
    return {
        "title": "Opal",
        # GET /log body — the 8088 web interface serves the daemon's log here
        "_log": "\n".join(f"log line {i}" for i in range(1, 61)),
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
        "matrix_engine": "1",
        "matrix_expand_hf": "0",
        "matrix_iir2fir": "0",
        # pipeline rows as raw attr strings (channel re-derived from position)
        "_pipelines": [
            {"gain": "0", "mixdown": "0", "process": "", "source": "0"},
            {"gain": "0", "mixdown": "1", "process": "", "source": "1"},
        ],
        # /matrix page state: saved profile names (datalist), the printed active
        # label, and pipeline 0's process chain
        "_matrix_profiles": ["", "Default", "Mch-to-Stereo mixdown"],
        "matrix_active": "[Default]",
        "process_0": "",
        "post_bauer_enabled": True,
        "post_bauer_frequency": "700",
        "post_loudness_enabled": False,
        "post_loudness_lowfreq": "80",
        "cuda": "1",
        "cuda_dev": "-1",
        "multicore": "1",
        "nblocks": "16",
        # 0 = off, 1 = -3 dB, 2 = -6 dB; the /config form can only render 0 vs on
        "volume_fixed": "1",
        "_lag": 0,
        **extra,
    }
