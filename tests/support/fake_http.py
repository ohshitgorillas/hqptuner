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

from fake_config_xml import adopt_cfg, cfg_xml, elem_attr


def _backup_zip(st: dict[str, Any]) -> bytes:
    xml = cfg_xml(st)
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


def _speakers_render(st: dict[str, Any]) -> str:
    """GET /speakers (readme §1.9) — the enabled switch plus per-channel level
    (dBFS) and distance (cm) inputs, each channel under its own <h2> name, the
    layout the parser reads channel labels from on 6.0.4."""
    parts = [f'<input type="checkbox" name="enabled" value="1"{" checked" if st["speakers_enabled"] else ""}/>']
    for i, ch in enumerate(st["_speakers"]):
        parts.append(
            f"<h2>{ch['label']}</h2>"
            f'<input type="number" name="level_{i}" value="{ch["level"]}" min="-60" max="0" step="0.1"/>'
            f'<input type="number" name="distance_{i}" value="{ch["distance"]}" min="0" max="5000"/>'
        )
    return '<form method="post">' + "".join(parts) + "</form>"


def _adopt_speakers(st: dict[str, Any], content_type: str, raw: bytes) -> None:
    """POST /speakers — adopt the (complete) form. Checkbox contract as the real
    daemon keeps it: `enabled` present means on, absent means off."""
    fields = _parse_multipart_fields(content_type, raw)
    st["speakers_enabled"] = fields.get("enabled") == "1"
    for i, ch in enumerate(st["_speakers"]):
        ch["level"] = fields.get(f"level_{i}", ch["level"])
        ch["distance"] = fields.get(f"distance_{i}", ch["distance"])


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
    if path == "/speakers":
        return 200, _speakers_render(st).encode()
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
    if elem_attr(xml, "title", "value") == "REJECT":
        return  # modeled value-level rejection: the daemon refuses, state unchanged
    st["_pre_backup"] = _backup_zip(st)  # snapshot before adopting, for the stale window
    adopt_cfg(st, xml)
    st["_stale"] = st.get("_lag", 0)
    if st.get("_die"):
        st["_down"] = True


def _restore_post(st: dict[str, Any], content_type: str, raw: bytes) -> int:
    """POST /restore, returning the HTTP status the daemon answers with.

    ``_restore_refusals`` refuses that many arrivals with 503 before adopting
    anything: the real daemon is unreachable for ~5.6 s after each restore, so a
    lane whose write lands in that window sees the POST itself fail. 503 raises
    from ``httpconf._post``'s ``raise_for_status`` as an ``httpx.HTTPError``, the
    same arm that catches a live connection refusal.

    ``_restore_attempts`` counts every arrival, refused or not, so a retry loop
    can be tested for how many passes it makes (docs/testing.md rule 7)."""
    st["_restore_attempts"] = st.get("_restore_attempts", 0) + 1
    if st.get("_restore_refusals", 0) > 0:
        st["_restore_refusals"] -= 1
        return 503
    _restore_config(st, content_type, raw)
    return 200


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


# No POST /matrix or POST /matrix/{load,save,delete} here. HQPTuner writes the
# matrix only through /restore now: profile save/delete are staged
# <matrix_profile> config edits and a profile load rides 4321 MatrixSetProfile
# (matrix-spec.md "Probe findings — saved"). Modelling routes nothing calls
# would be scaffolding for a lane that is deliberately gone.


def _save_profile(st: dict[str, Any], raw: bytes) -> None:
    """POST /config/profile/save — freeze the current working config as a named
    preset snapshot, so a later /backup carries it as data/cfgs/<name>.xml."""
    name = parse_qs(raw.decode()).get("profile_name", [""])[0]
    if name:
        st.setdefault("_saved", {})[name] = cfg_xml(st)


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
            status = 200  # /config POST is unused by the restore lane
            if self.path == "/restore":
                status = _restore_post(st, self.headers.get("Content-Type", ""), raw)
            elif self.path == "/config/profile/save":
                _save_profile(st, raw)
            elif self.path == "/speakers":
                _adopt_speakers(st, self.headers.get("Content-Type", ""), raw)
            self.send_response(status)
            self.end_headers()
            self.wfile.write(b"<html>Restore</html>")

        def log_message(self, *_: object) -> None:
            pass

    return Handler


def spawn(st: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Serve `st` on a loopback port until the generator is closed. Yields the
    state dict with `_port` filled in — tests read and mutate it directly."""
    server = HTTPServer(("127.0.0.1", 0), _http_handler(st))
    # poll_interval is what `shutdown()` waits on, so it is per-test teardown
    # cost: the 0.5 s default charged every fixture half a second for nothing.
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
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
        # speaker processing (readme §1.9): off, two flat channels
        "speakers_enabled": False,
        "_speakers": [
            {"label": "Left", "level": "0", "distance": "0"},
            {"label": "Right", "level": "0", "distance": "0"},
        ],
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
        # saved profiles as the config file carries them (name -> raw attr rows) —
        # the only place the daemon ever reads a profile from, so one ships here
        "_profiles": {
            "Stock": [
                {"gain": "0", "mixdown": "0", "process": "", "source": "0"},
                {"gain": "0", "mixdown": "1", "process": "", "source": "1"},
            ]
        },
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
        # Volume-tab file truth. `fixed_level` is None when the feature is off:
        # the daemon expresses "off" by the ABSENCE of the top-level <fixed/>
        # element, not by a flag on it, so presence is the only state there is.
        # `fixed_parked` is the level the daemon remembers WHILE off, carried in a
        # commented line; None means this config has never had a fixed volume.
        "fixed_level": None,
        "fixed_parked": None,
        "volume_max": "0",
        "volume_min": "-60",
        "volume_adaptive": "0",
        "defaults_volume": "-3",
        "_lag": 0,
        # POST /restore arrivals to refuse with 503 before adopting one, and the
        # running count of arrivals. Both default to the healthy daemon: nothing
        # is refused and the count is bookkeeping no existing test reads.
        "_restore_refusals": 0,
        "_restore_attempts": 0,
        **extra,
    }
