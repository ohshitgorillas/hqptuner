"""The config XML half of the fake hqplayerd: render and adopt.

Split out of ``fake_http`` when that file passed the 500-line gate. The seam is
real, not arbitrary: this module owns the *file* the daemon keeps (what GET
/backup carries, what POST /restore adopts), while ``fake_http`` owns the HTTP
surface around it. The schema here is authored against 6.0.4 INDEPENDENTLY of
``presetconf``, so a wrong form->XML mapping in the writer surfaces as a failed
readback rather than a self-confirming round-trip.
"""

import re
from typing import Any


def _b(v: Any) -> str:
    return "1" if v in (True, "1", 1) else "0"


def _fixed_line(st: dict[str, Any]) -> str:
    """The top-level fixed-volume line as 6.0.4 writes it.

    Live element = the feature is on at that level. Off, the daemon keeps the
    last level in a COMMENTED line — that comment is its memory, and a config
    that has never had a fixed volume carries a bare commented tag with no level
    at all. Three distinct shapes, and the difference between the last two is
    exactly what "the level reverted" was."""
    if st["fixed_level"] is not None:
        return f'<fixed volume="{st["fixed_level"]}"/>'
    if st.get("fixed_parked") is not None:
        return f'<!--<fixed volume="{st["fixed_parked"]}"/>-->'
    return "<!--<fixed/>-->"


def cfg_xml(st: dict[str, Any]) -> bytes:
    """The working hqplayerd.xml a /backup would carry, rendered from state."""
    net_addr, _, net_dev = st["net_device"].partition("/")
    # fixed volume: the element exists only while the feature is on, and the
    # daemon parks the remembered level in a COMMENT while it is off — modeled
    # because a locator that ignores comments would read the parked level as live
    fixed = _fixed_line(st)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n<hqplayerd>'
        f"{fixed}"
        f'<output type="{st["backend"]}"/>'
        f'<title value="{st["title"]}"/>'
        # the live-routed set: output mode, both chains' filters and shapers.
        # 6.0.4 writes every one of them into the config file even though a live
        # control-lane write never touches it, so they render from state and are
        # adopted back on restore like any other attribute.
        f'<mode value="{st["mode"]}"/>'
        f'<pcm filter="{st["filter"]}" filter1x="{st["filter1x"]}" dither="{st["dither"]}" '
        f'samplerate="{st["samplerate"]}"/>'
        f'<sdm oversampling="{st["oversampling"]}" oversampling1x="{st["oversampling1x"]}" '
        f'modulator="{st["modulator"]}" bitrate="{st["bitrate"]}"/>'
        '<log enabled="1" file="/tmp/hqplayerd.log"/><upnp freewheel="0"/>'
        # volume_fixed's XML domain is 0/1/2 (off / -3 dB / -6 dB) while the /config
        # form below renders it as a plain checkbox — the daemon's own lossy render,
        # modeled so the file-truth read path is genuinely exercised.
        f'<engine auto_family="{_b(st["auto_family"])}" channels="{st["channels"]}" '
        f'volume_fixed="{st["volume_fixed"]}" cuda_dev="{st["cuda_dev"]}" '
        f'volume_max="{st["volume_max"]}" volume_min="{st["volume_min"]}" '
        f'volume_adaptive="{st["volume_adaptive"]}" '
        f'cuda="{st["cuda"]}" multicore="{st["multicore"]}" nblocks="{st["nblocks"]}">'
        # <defaults samplerate/bitrate> are the per-family RATE LIMITS, a
        # different slot from <pcm samplerate>/<sdm bitrate> above
        # (settings-classification.md) — rendered from their own state keys
        f'<defaults samplerate="{st["defaults_samplerate"]}" bitrate="{st["defaults_bitrate"]}" '
        f'volume="{st["defaults_volume"]}"/>'
        f'<network address="{net_addr}" device="{net_dev}" ipv6="{_b(st["net_ipv6"])}" '
        'dac_bits="15" period_time="0"/>'
        '<alsa device="hw:CARD=NVidia,DEV=3" dac_bits="24" period_time="100"/>'
        # <post_process> nests INSIDE <matrix>, exactly as 6.0.4 writes it (readme
        # §1.11 / §1.11.2). The matrix switch gates the whole plugin chain, so a
        # writer that enables a plugin without enabling the matrix produces an inert
        # config — modeled here so that failure surfaces in tests, not in a listening
        # room. Default OFF: the real-world preset that exposed this had matrix="0".
        # saved profiles are siblings of <matrix> and precede it, as 6.0.4 writes them
        + _render_profiles(st) + f'<matrix enabled="{_b(st["matrix_enabled"])}" engine="{st["matrix_engine"]}" '
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
        f'<plugin type="correction" enabled="{_b(st["post_correction_enabled"])}" '
        f'dac0="{st["post_correction_dac0"]}"/>'
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


def elem_attr(xml: bytes, tag: str, attr: str) -> str | None:
    m = re.search(rb"<" + tag.encode() + rb"\b[^>]*?>", xml)
    if not m:
        return None
    a = re.search(rb"\b" + attr.encode() + rb'="([^"]*)"', m.group(0))
    return a.group(1).decode() if a else None


def _adopt_net_device(st: dict[str, Any], xml: bytes) -> None:
    """Adopt the uploaded net_device only when it is an endpoint the daemon can
    bind; a device outside the offered set is refused (endpoint gone), which no
    restart conjures back — the unfixable-divergence case."""
    addr = elem_attr(xml, "network", "address")
    dev = elem_attr(xml, "network", "device")
    if addr is not None and dev is not None and f"{addr}/{dev}" in st["_net_endpoints"]:
        st["net_device"] = f"{addr}/{dev}"


def _adopt_matrix(st: dict[str, Any], xml: bytes) -> None:
    """Adopt the uploaded ``<matrix enabled>`` — the carrier switch for the whole
    post-process chain. Read independently of presetconf."""
    enabled = elem_attr(xml, "matrix", "enabled")
    if enabled is not None:
        st["matrix_enabled"] = enabled == "1"
    for key, attr in (("matrix_engine", "engine"), ("matrix_expand_hf", "expand_hf"), ("matrix_iir2fir", "iir2fir")):
        v = elem_attr(xml, "matrix", attr)
        if v is not None:
            st[key] = v
    _adopt_pipelines(st, xml)
    _adopt_profiles(st, xml)


def _attrs(tag: bytes) -> dict[str, str]:
    return {k.decode(): v.decode() for k, v in re.findall(rb'(\w+)="([^"]*)"', tag)}


def _adopt_profiles(st: dict[str, Any], xml: bytes) -> None:
    """Adopt the ``<matrix_profile>`` elements of an uploaded config — the daemon
    re-reading the saved profiles from its config file, which is the only way it
    ever learns one (its own /matrix/save keeps them in memory, round 5). A profile
    is a whole matrix context: its pipeline rows AND its own ``<post_process>``
    chain (readme §1.11.2 nests the chain inside the matrix, and a profile is a
    stored matrix). Both are kept as raw attribute strings, like the live table, so
    the next /backup serves back exactly what the writer produced."""
    st["_profiles"] = {
        m.group(1).decode(): {
            "rows": [_attrs(pm.group(0)) for pm in re.finditer(rb"<pipeline\b[^>]*/>", m.group(2))],
            "plugins": [_attrs(pm.group(0)) for pm in re.finditer(rb"<plugin\b[^>]*?>", m.group(2))],
        }
        for m in re.finditer(rb'<matrix_profile\b[^>]*name="([^"]*)"[^>]*>(.*?)</matrix_profile>', xml, re.DOTALL)
    }


def _render_profile_plugins(plugins: list[dict[str, str]]) -> str:
    """A stored profile's post-process chain, verbatim from the adopted attribute
    strings. A profile that carries no chain gets no ``<post_process>`` element at
    all — the daemon writes the elements it has, and a profile saved before chains
    were stored simply has none."""
    if not plugins:
        return ""
    body = "".join("<plugin " + " ".join(f'{k}="{v}"' for k, v in p.items()) + "/>" for p in plugins)
    return f"<post_process>{body}</post_process>"


def _render_profiles(st: dict[str, Any]) -> str:
    """The saved profiles as the daemon writes them: siblings of ``<matrix>``,
    ahead of it, each holding its own pipeline rows and its own plugin chain."""
    return "".join(
        f'<matrix_profile name="{name}">'
        + "".join(
            f'<pipeline channel="{i}" gain="{p["gain"]}" mixdown="{p["mixdown"]}" '
            f'process="{p["process"]}" source="{p["source"]}"/>'
            for i, p in enumerate(prof["rows"])
        )
        + _render_profile_plugins(prof["plugins"])
        + "</matrix_profile>"
        for name, prof in st["_profiles"].items()
    )


def _adopt_pipelines(st: dict[str, Any], xml: bytes) -> None:
    """Adopt the ``<pipeline>`` rows inside ``<matrix>`` as raw attribute strings
    — no interpretation, so the next /backup serves back exactly what the writer
    produced (and only what it produced)."""
    m = re.search(rb"<matrix\b[^>]*>(.*?)</matrix>", xml, re.DOTALL)
    if m is None:
        return
    rows = [
        {k.decode(): v.decode() for k, v in re.findall(rb'(\w+)="([^"]*)"', pm.group(0))}
        for pm in re.finditer(rb"<pipeline\b[^>]*/>", m.group(1))
    ]
    if rows:
        st["_pipelines"] = rows


#: <plugin type> -> XML attribute -> fake state key. Read by the daemon's own
#: attribute names (low_frequency, frequency, dac0, ...) independently of
#: presetconf, so a wrong form->XML mapping in the writer surfaces here as a value
#: that never lands. ``enabled`` is adopted as a bool, every other attr as a string.
_PLUGIN_ATTRS: dict[bytes, dict[str, str]] = {
    b"bauer": {"enabled": "post_bauer_enabled", "frequency": "post_bauer_frequency"},
    b"loudness": {"enabled": "post_loudness_enabled", "low_frequency": "post_loudness_lowfreq"},
    b"correction": {"enabled": "post_correction_enabled", "dac0": "post_correction_dac0"},
}


def _adopt_plugin_attrs(st: dict[str, Any], tag: bytes, attrs: dict[str, str]) -> None:
    for attr, key in attrs.items():
        v = re.search(rb"\b" + attr.encode() + rb'="([^"]*)"', tag)
        if v is not None:
            st[key] = v.group(1) == b"1" if attr == "enabled" else v.group(1).decode()


def _adopt_plugins(st: dict[str, Any], xml: bytes) -> None:
    """Adopt the LIVE post_process plugin attrs from an uploaded config — the
    daemon re-reading the <plugin> nodes of the matrix that is playing.

    Scoped to the ``<matrix>`` element's own body on purpose: a saved
    ``<matrix_profile>`` carries a ``<post_process>`` chain of its own, and a
    daemon does not confuse a stored profile with what is running. A scan over
    every <plugin> in the document would adopt a profile's settings as the live
    ones and quietly bless a writer that stored the wrong chain."""
    matrix = re.search(rb"<matrix\b[^>]*>(.*?)</matrix>", xml, re.DOTALL)
    if matrix is None:
        return
    for m in re.finditer(rb"<plugin\b[^>]*?>", matrix.group(1)):
        for ptype, attrs in _PLUGIN_ATTRS.items():
            if b'type="' + ptype + b'"' in m.group(0):
                _adopt_plugin_attrs(st, m.group(0), attrs)


def _fixed_volume_of(m: re.Match[bytes] | None, default: str | None) -> str | None:
    if m is None:
        return None
    level = re.search(rb'\bvolume="([^"]*)"', m.group(0))
    return level.group(1).decode() if level else default


def _adopt_fixed(st: dict[str, Any], xml: bytes) -> None:
    """Adopt the top-level ``<fixed volume=…/>``: present = fixed volume on, at
    that level; absent = off. A commented element is the daemon's own parked
    memory and is not live, so it is adopted as the REMEMBERED level rather than
    the running one — the daemon keeps that comment across a restore, and a fake
    that dropped it would report the level as gone when it is only parked."""
    tags = list(re.finditer(rb"<fixed\b[^>]*?/?>", xml))
    live = next((m for m in tags if not _commented(xml, m.start())), None)
    parked = next((m for m in tags if _commented(xml, m.start())), None)
    st["fixed_level"] = _fixed_volume_of(live, "0")
    st["fixed_parked"] = _fixed_volume_of(parked, None)


def _commented(xml: bytes, pos: int) -> bool:
    return xml.rfind(b"<!--", 0, pos) > xml.rfind(b"-->", 0, pos)


def _clamp_startup_volume(st: dict[str, Any]) -> None:
    """A daemon that rewrites a setting on its own, on ``_clamps`` state.

    The startup volume has to sit inside the volume range, so a daemon may pull
    it up to the minimum when it re-reads the config — writing back a value
    nobody uploaded. Modeled because that is the shape of divergence an apply
    must NOT be held to: the field is untouched by the apply, so demanding it
    match would fail every apply on this machine forever."""
    if not st.get("_clamps"):
        return
    if float(st["defaults_volume"]) < float(st["volume_min"]):
        st["defaults_volume"] = st["volume_min"]


def adopt_cfg(st: dict[str, Any], xml: bytes) -> None:
    """Update state from an uploaded working hqplayerd.xml — the daemon re-reading
    its config on restore. Reads the schema independently of the writer."""

    def take(key: str, tag: str, attr: str) -> None:
        v = elem_attr(xml, tag, attr)
        if v is not None:
            st[key] = v

    for key, tag, attr in (
        ("backend", "output", "type"),
        ("title", "title", "value"),
        ("mode", "mode", "value"),
        ("filter", "pcm", "filter"),
        ("filter1x", "pcm", "filter1x"),
        ("dither", "pcm", "dither"),
        ("samplerate", "pcm", "samplerate"),
        ("oversampling", "sdm", "oversampling"),
        ("oversampling1x", "sdm", "oversampling1x"),
        ("modulator", "sdm", "modulator"),
        ("bitrate", "sdm", "bitrate"),
        ("defaults_samplerate", "defaults", "samplerate"),
        ("defaults_bitrate", "defaults", "bitrate"),
        ("channels", "engine", "channels"),
        ("cuda", "engine", "cuda"),
        ("cuda_dev", "engine", "cuda_dev"),
        ("multicore", "engine", "multicore"),
        ("nblocks", "engine", "nblocks"),
        ("volume_fixed", "engine", "volume_fixed"),
        ("volume_max", "engine", "volume_max"),
        ("volume_min", "engine", "volume_min"),
        ("volume_adaptive", "engine", "volume_adaptive"),
        ("defaults_volume", "defaults", "volume"),
    ):
        take(key, tag, attr)
    _adopt_fixed(st, xml)
    _clamp_startup_volume(st)
    af = elem_attr(xml, "engine", "auto_family")
    if af is not None:
        st["auto_family"] = af == "1"
    ipv6 = elem_attr(xml, "network", "ipv6")
    if ipv6 is not None:
        st["net_ipv6"] = ipv6 == "1"
    _adopt_net_device(st, xml)
    _adopt_matrix(st, xml)
    _adopt_plugins(st, xml)
