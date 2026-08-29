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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs

from fake_config_xml import adopt_cfg, cfg_xml, elem_attr

#: Guards every read-modify-write of a served state dict. Handlers run on their
#: own threads (see `_Server`), and the read lane mutates state too — the stale
#: window counts down on `GET /backup/settings.zip` and a rescan rewrites the
#: endpoint lists on `GET /config/refresh`, while the test thread is assigning
#: the same keys and another handler may be rendering `/config` off them. One
#: module-level lock rather than one per server: fakes are per-test and the
#: sections are three dict operations long, so the contention is not worth the
#: bookkeeping of threading a lock through every module-level helper.
_STATE = threading.Lock()


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
    with _STATE:  # a rescan on another handler thread may be rewriting the list
        endpoints = tuple(st["_net_endpoints"])
    # `_form_net_device` is the lag window: the config file already carries the
    # device a just-loaded preset picked, while this page still renders the one
    # the engine has open. Unset (the usual state) means both routes agree.
    form_device = st.get("_form_net_device") or st["net_device"]
    dev_opts = "".join(f'<option value="{v}"{" selected" if form_device == v else ""}>{v}</option>' for v in endpoints)
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
        (
            '<select name="engine"><option value="0">overlap-save</option>'
            '<option value="1" selected>overlap-add</option></select>'
        ),
        '<input type="checkbox" name="expand_hf" value="1"/>',
        (
            '<select name="iir2fir"><option value="0" selected>none</option>'
            '<option value="1">direct</option><option value="2">linear</option></select>'
        ),
        f'<b>Active: </b>{st["matrix_active"]}<br>',
        (
            f'<input type="text" size="64" name="profile" list="profile_items"/><datalist id="profile_items">{profs}'
            "</datalist>"
        ),
        f"<table>{pipelines}</table>",
        f'<input type="checkbox" name="post_bauer_enabled" value="1"{" checked" if st["post_bauer_enabled"] else ""}/>',
        f'<input type="number" name="post_bauer_frequency" value="{st["post_bauer_frequency"]}"/>',
        (
            f'<input type="checkbox" name="post_loudness_enabled" value="1"'
            f'{" checked" if st["post_loudness_enabled"] else ""}/>'
        ),
        f'<input type="number" name="post_loudness_lowfreq" value="{st["post_loudness_lowfreq"]}"/>',
    ]
    return '<form method="post" enctype="multipart/form-data">' + "".join(parts) + "</form>"


def _about_render(st: dict[str, Any]) -> str:
    """GET /about — the stock UI page (protocol.md §3.6 route table). The
    daemon's installed release string follows the Version heading on its own
    line, which is where a reader parses it from. ``_about_body`` overrides the
    whole page: a daemon whose about page carries no Version heading at all."""
    body = st.get("_about_body")
    if body is not None:
        return str(body)
    return (
        "<html><body>\n<h1>HQPlayer Embedded</h1>\n"
        "<h3>Version</h3>\n"
        f"{st['release']}\n"
        "<h3>Copyright</h3>\nJussi Laako\n</body></html>"
    )


def _http_get_response(st: dict[str, Any], path: str) -> tuple[int, bytes]:
    if path == "/log":
        # `_log_reads` counts every arrival, refused or not, the way
        # `_restore_attempts` counts POST /restore: serving the whole log is the
        # cost a caller that re-reads it per poll is paying, and a request either
        # reached the daemon or it did not.
        with _STATE:
            st["_log_reads"] = st.get("_log_reads", 0) + 1
    # `_down`: restore accepted, daemon never came back. `_fail_paths`: the same
    # 503 frame narrowed to named routes — a daemon answering some pages and
    # refusing others (one subsystem down, the rest of the web UI up).
    if st.get("_down") or path in st.get("_fail_paths", ()):
        return 503, b""
    if path == "/config/refresh":  # webUI: a bare GET in a method=get form
        _refresh_devices(st)
        return 200, b""
    if path == "/log":
        return 200, st["_log"].encode()
    if path == "/about":
        return 200, _about_render(st).encode()
    if path == "/config":
        return 200, _http_render(st).encode()
    if path == "/matrix":
        return 200, _matrix_render(st).encode()
    if path == "/speakers":
        return 200, _speakers_render(st).encode()
    if path == "/backup/settings.zip":
        return 200, _backup_response(st)
    return 404, b""


def _backup_response(st: dict[str, Any]) -> bytes:
    """The archive GET /backup/settings.zip serves right now."""
    if st.get("_empty"):  # post-profile-load bug window: bare data/, no base config
        return _empty_backup_zip()
    # after a restore the daemon serves the pre-restart archive for a read or two
    # before catching up — the restart window verify must ride through
    with _STATE:  # read lane, but this one counts down: two concurrent reads
        stale = st.get("_stale", 0) > 0  # must not both take the same ticket
        if stale:
            st["_stale"] -= 1
    return st["_pre_backup"] if stale else _backup_zip(st)


def _restore_config(st: dict[str, Any], content_type: str, raw: bytes) -> None:
    boundary = content_type.split("boundary=")[1].encode()
    zbytes = b""
    for part in raw.split(b"--" + boundary):
        if b'name="cfgfile"' in part:
            zbytes = part.split(b"\r\n\r\n", 1)[1].rsplit(b"\r\n", 1)[0]
    # the upload EXACTLY as it arrived, recorded before anything parses it, so a
    # test can say what HQPTuner put on the wire — including an upload the
    # daemon then refuses
    st["_restore_bytes"] = zbytes
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
    # An adopted restore SELF-RESTARTS the daemon (docs/architecture.md §1 lane
    # 2), and the restarted engine comes up running the restored file — so the
    # Control API's State reflects it afterwards. That side lands on the 4321
    # daemon, which this fake cannot see: a dual-lane test hangs its own
    # callable on ``_on_restore`` and moves the control fake's State from there,
    # the way ``_on_refresh`` models the rescan stopping the engine.
    restarted = st.get("_on_restore")
    if restarted is not None:
        restarted()


def _restore_post(st: dict[str, Any], content_type: str, raw: bytes) -> int:
    """POST /restore, returning the HTTP status the daemon answers with.

    ``_restore_refusals`` refuses that many arrivals with 503 before adopting
    anything: the real daemon is unreachable for ~5.6 s after each restore, so a
    lane whose write lands in that window sees the POST itself fail. 503 raises
    from ``httpconf._post``'s ``raise_for_status`` as an ``httpx.HTTPError``, the
    same arm that catches a live connection refusal.

    ``_restore_attempts`` counts every arrival, refused or not, so a retry loop
    can be tested for how many passes it makes (docs/testing.md rule 7)."""
    with _STATE:
        st["_restore_attempts"] = st.get("_restore_attempts", 0) + 1
        refused = st.get("_restore_refusals", 0) > 0
        if refused:
            st["_restore_refusals"] -= 1
    if refused:
        return 503
    try:
        _restore_config(st, content_type, raw)
    except (zipfile.BadZipFile, KeyError):
        # An upload that is not a readable settings archive is refused: the
        # daemon adopts nothing and does not answer success. The upload itself is
        # already recorded, so a caller can still be asked what it sent.
        return 400
    return 200


def _refresh_devices(st: dict[str, Any]) -> None:
    """GET /config/refresh — re-scan output devices. Endpoints that were powered
    off (staged in _hidden_endpoints) become bindable and join the offered set,
    modeling a NAA that came back on since the last form read.

    The rescan also STOPS THE ENGINE (6.0.4, reported on Opal), so every
    live-only setting comes back at the config file's value. That side of it
    lands on the 4321 daemon, which this fake cannot see: a test that wants it
    hangs its own callable on ``_on_refresh`` and moves the control fake's State
    from there, the way a real rescan would."""
    with _STATE:  # both lists are read-modify-written here, off a handler thread
        endpoints = list(st["_net_endpoints"])
        endpoints += [ep for ep in st.get("_hidden_endpoints", []) if ep not in endpoints]
        st["_net_endpoints"] = endpoints  # a fresh list, so no renderer sees it grow
        st["_hidden_endpoints"] = []
    # outside the lock: the callable is the test's own, and it reaches for the
    # 4321 fake rather than for anything served here
    engine_stops = st.get("_on_refresh")
    if engine_stops is not None:
        engine_stops()


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
# (matrix-spec.md "Probe findings — saved"). Modeling routes nothing calls
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


class _Server(ThreadingHTTPServer):
    """A daemon fake whose shutdown cannot be held up by a client still holding
    a connection open.

    A plain `HTTPServer` handles each request INLINE in the accept loop, so a
    keep-alive connection with no request in flight parks that loop in
    `socket.readinto` — and `shutdown()`, which waits for the loop to come
    round, then blocks forever. Real clients keep sockets open: an
    `HttpConfigClient` whose manager outlives the fixture that served it has one
    idle-open at teardown, and whether the accept loop is parked in it at that
    instant is a race. It hung the suite about one run in five.

    A handler thread per connection takes that read off the accept loop.
    `daemon_threads` keeps a parked handler from outliving the test, and
    `block_on_close=False` keeps `server_close()` from joining one.

    Handlers now touch `st` concurrently, where before they were serialized, and
    the test thread writes the same dict throughout. Neither lane is read-only:
    `_stale` counts down inside a `GET /backup/settings.zip`, and
    `GET /config/refresh` rewrites `_net_endpoints` and `_hidden_endpoints`
    while `/config` may be rendering off them. Every read-modify-write of `st`
    therefore runs under the module's `_STATE` lock, and the sections under it
    publish whole replacement values rather than mutating a list in place, so a
    reader that took the old list keeps a list nothing is appending to.
    """

    daemon_threads = True
    block_on_close = False


def spawn(st: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Serve `st` on a loopback port until the generator is closed. Yields the
    state dict with `_port` filled in — tests read and mutate it directly."""
    server = _Server(("127.0.0.1", 0), _http_handler(st))
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
        # GET /about — the installed release string under the Version heading
        "release": "6.0.2",
        # the live-routed set as the config file carries it: a control-lane write
        # never reaches these, so a restore is the only way they ever change
        "mode": "sdm",
        "filter": "40",
        "filter1x": "47",
        "dither": "3",
        "oversampling": "41",
        "oversampling1x": "42",
        "modulator": "12",
        # per-family rate LIMITS (<defaults>), not the request slots below
        "defaults_samplerate": "192000",
        "defaults_bitrate": "24576000",
        "samplerate": "192000",
        "bitrate": "22579200",
        "channels": "2",
        "auto_family": False,
        "net_ipv6": False,
        "net_device": "S26/hw:CARD=Output,DEV=0",
        # the device GET /config renders while the file above already names
        # another: the window after a preset load, before the form catches up.
        # None means the two routes agree, which is the ordinary case.
        "_form_net_device": None,
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
        # saved profiles as the config file carries them (name -> raw attr rows plus
        # the profile's own raw <plugin> attrs) — the only place the daemon ever
        # reads a profile from, so one ships here. "Stock" predates profiles storing
        # a chain, so it carries none: the ordinary state of an already-saved profile.
        "_profiles": {
            "Stock": {
                "rows": [
                    {"gain": "0", "mixdown": "0", "process": "", "source": "0"},
                    {"gain": "0", "mixdown": "1", "process": "", "source": "1"},
                ],
                "plugins": [],
            }
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
        # DAC correction: off, with no filter file picked. dac0 reads empty right
        # after a matrix reload too, while the output device re-discovers.
        "post_correction_enabled": False,
        "post_correction_dac0": "",
        "cuda": "1",
        # the daemon's own defaults: -1 is automatic device selection on both GPU
        # slots, and "default" is normal (non-offloaded) e-core allocation
        "cuda_dev": "-1",
        "cuda_cdev": "-1",
        "ecores": "default",
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
        # GET routes answered 503 instead of their page; tests move it mid-run
        "_fail_paths": [],
        "_lag": 0,
        # POST /restore arrivals to refuse with 503 before adopting one, and the
        # running count of arrivals. Both default to the healthy daemon: nothing
        # is refused and the count is bookkeeping no existing test reads.
        "_restore_refusals": 0,
        "_restore_attempts": 0,
        # Running count of GET /log arrivals, same bookkeeping shape.
        "_log_reads": 0,
        **extra,
    }
