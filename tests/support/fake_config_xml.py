"""The config XML half of the fake hqplayerd: render and adopt.

This module owns the *file* the daemon keeps, while ``fake_http`` owns the HTTP
surface around it. ``cfg_xml`` renders the whole file from state for GET
/backup. ``adopt_cfg`` reads an uploaded one back on POST /restore by table: the
base rows below plus the rows a test writes into ``st["_adopts"]`` and
``st["_plugin_adopts"]``, and the live pipeline rows and saved profiles
verbatim. An attribute no row names is rendered but never adopted. The schema
is authored against 6.0.4 INDEPENDENTLY of ``presetconf``, so a wrong form->XML
mapping in the writer surfaces as a failed readback rather than a
self-confirming round-trip.
"""

import re
from typing import Any


def _b(v: object) -> str:
    return "1" if v in (True, "1", 1) else "0"


def _upnp_line(st: dict[str, Any]) -> str:
    """The `<upnp>` element, carrying `interface` only while state names one."""
    interface = st.get("upnp_interface", "")
    return f'<upnp freewheel="0" interface="{interface}"/>' if interface else '<upnp freewheel="0"/>'


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
        # control-lane write never touches it, so they render from state.
        f'<mode value="{st["mode"]}"/>'
        f'<pcm filter="{st["filter"]}" filter1x="{st["filter1x"]}" dither="{st["dither"]}" '
        f'samplerate="{st["samplerate"]}"/>'
        f'<sdm oversampling="{st["oversampling"]}" oversampling1x="{st["oversampling1x"]}" '
        f'modulator="{st["modulator"]}" bitrate="{st["bitrate"]}"/>'
        '<log enabled="1" file="/tmp/hqplayerd.log"/>'
        f"{_upnp_line(st)}"
        # volume_fixed's XML domain is 0/1/2 (off / -3 dB / -6 dB) while the /config
        # form below renders it as a plain checkbox — the daemon's own lossy render,
        # modeled so the file-truth read path is genuinely exercised.
        f'<engine auto_family="{_b(st["auto_family"])}" channels="{st["channels"]}" '
        f'volume_fixed="{st["volume_fixed"]}" cuda_dev="{st["cuda_dev"]}" '
        f'volume_max="{st["volume_max"]}" volume_min="{st["volume_min"]}" '
        f'volume_adaptive="{st["volume_adaptive"]}" '
        # cuda_cdev (the convolution GPU, -1 = automatic) and ecores (efficiency-core
        # allocation: default/pool/filter) are <engine> attributes in their own right,
        # readme "Attribute: cuda_cdev" / "Attribute: ecores". A daemon serves back
        # every attribute it holds, so a fake that dropped these two would report a
        # correctly written setting as one that never landed.
        f'cuda_cdev="{st["cuda_cdev"]}" ecores="{st["ecores"]}" '
        f'cuda="{st["cuda"]}" multicore="{st["multicore"]}" nblocks="{st["nblocks"]}">'
        # <defaults samplerate/bitrate> are the per-family RATE LIMITS, a
        # different slot from <pcm samplerate>/<sdm bitrate> above
        # — rendered from their own state keys
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


#: Elements every uploaded hqplayerd.xml is adopted on: state key -> (element
#: tag, attribute). A key fewer tests need is a row the test writes into
#: ``st["_adopts"]`` instead, in the same shape.
_ADOPTS: dict[str, tuple[str, str]] = {
    "title": ("title", "value"),
    "mode": ("mode", "value"),
    "filter": ("pcm", "filter"),
    "filter1x": ("pcm", "filter1x"),
    "dither": ("pcm", "dither"),
    "samplerate": ("pcm", "samplerate"),
    "bitrate": ("sdm", "bitrate"),
    "cuda": ("engine", "cuda"),
    "auto_family": ("engine", "auto_family"),
}

#: Live plugin attributes every upload is adopted on: state key -> (``<plugin
#: type>``, attribute), read by the daemon's own attribute names. A test writes
#: further rows into ``st["_plugin_adopts"]``, in the same shape.
_PLUGIN_ADOPTS: dict[str, tuple[str, str]] = {
    "post_bauer_frequency": ("bauer", "frequency"),
    "post_correction_enabled": ("correction", "enabled"),
    "post_loudness_enabled": ("loudness", "enabled"),
}


def _adopt_value(st: dict[str, Any], key: str, value: str | None) -> None:
    """The one adoption rule every row follows: an attribute the upload carries
    replaces the key, as ``value == "1"`` where the key holds a bool and as the
    string otherwise. An attribute the upload leaves out changes nothing."""
    if value is not None:
        st[key] = value == "1" if isinstance(st.get(key), bool) else value


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


def _adopt_plugins(st: dict[str, Any], xml: bytes) -> None:
    """Adopt the LIVE post_process plugin attrs the plugin rows name from an
    uploaded config — the daemon re-reading the <plugin> nodes of the matrix
    that is playing.

    Scoped to the ``<matrix>`` element's own body on purpose: a saved
    ``<matrix_profile>`` carries a ``<post_process>`` chain of its own, and a
    daemon does not confuse a stored profile with what is running. A scan over
    every <plugin> in the document would adopt a profile's settings as the live
    ones and quietly bless a writer that stored the wrong chain."""
    matrix = re.search(rb"<matrix\b[^>]*>(.*?)</matrix>", xml, re.DOTALL)
    if matrix is None:
        return
    rows: dict[str, tuple[str, str]] = {**_PLUGIN_ADOPTS, **st.get("_plugin_adopts", {})}
    for m in re.finditer(rb"<plugin\b[^>]*?>", matrix.group(1)):
        attrs = _attrs(m.group(0))
        for key, (ptype, attr) in rows.items():
            if attrs.get("type") == ptype:
                _adopt_value(st, key, attrs.get(attr))


def adopt_cfg(st: dict[str, Any], xml: bytes) -> None:
    """Update state from an uploaded working hqplayerd.xml — the daemon re-reading
    its config on restore. Reads the schema independently of the writer, on the
    base element rows with the test's ``st["_adopts"]`` rows on top."""
    rows: dict[str, tuple[str, str]] = {**_ADOPTS, **st.get("_adopts", {})}
    for key, (tag, attr) in rows.items():
        _adopt_value(st, key, elem_attr(xml, tag, attr))
    _adopt_pipelines(st, xml)
    _adopt_profiles(st, xml)
    _adopt_plugins(st, xml)
