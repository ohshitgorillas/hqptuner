"""Surgical full-config editing for a preset snapshot's config XML.

Sibling of ``engineconf`` (which edits only the ``<engine>`` tag). Where the
form lane (``POST /config`` + ``POST /matrix``) rebuilds the whole form from the
daemon's *current* working state — so any drift already in that state rides
through — this edits the preset's own **snapshot XML** and pushes it via
``POST /restore``. Only the settings the user actually changed are touched; every
other setting is byte-preserved straight from the snapshot, so a stray crossfeed
or a rebound device cannot survive an apply. The snapshot XML is the whole
package (device, filters, volume, and the ``<post_process>`` plugins) in one
file — no two-form round-trip.

``FIELD_MAP`` was derived empirically (value-correlation of a live ``GET /config``
form against a real snapshot on 6.0.4), not guessed. Five form fields whose XML
attributes are absent/default in the correlation snapshot could not be grounded
(``UNGROUNDED``); an edit naming one is **refused**, never written with a guessed
attribute — corrupting a live audio daemon's config is the failure we exist to
prevent. Those five stay editable through the form lane until grounded.
"""

from __future__ import annotations

import io
import re
import zipfile

# form field name -> (element tag, attribute). Every tag here occurs once in a
# snapshot; multi-instance <plugin> lives in PLUGIN_MAP, keyed by its type attr.
FIELD_MAP: dict[str, tuple[str, str]] = {
    "title": ("title", "value"),
    "backend": ("output", "type"),
    "mode": ("mode", "value"),
    # PCM chain
    "filter": ("pcm", "filter"),
    "filter1x": ("pcm", "filter1x"),
    "dither": ("pcm", "dither"),
    "samplerate": ("pcm", "samplerate"),
    # SDM chain
    "oversampling": ("sdm", "oversampling"),
    "oversampling1x": ("sdm", "oversampling1x"),
    "modulator": ("sdm", "modulator"),
    "bitrate": ("sdm", "bitrate"),
    # default rates / startup volume
    "defaults_samplerate": ("defaults", "samplerate"),
    "defaults_bitrate": ("defaults", "bitrate"),
    "defaults_volume": ("defaults", "volume"),
    # ALSA backend section
    "alsa_device": ("alsa", "device"),
    "alsa_bits": ("alsa", "dac_bits"),
    "alsa_period": ("alsa", "period_time"),
    "alsa_offset": ("alsa", "channel_offset"),
    "alsa_anydsd": ("alsa", "any_dsd"),
    # Network backend section (net_device is special — see NET_DEVICE)
    "net_bits": ("network", "dac_bits"),
    "net_period": ("network", "period_time"),
    "net_anydsd": ("network", "any_dsd"),
    "net_ipv6": ("network", "ipv6"),
    # engine (name drift: integrator->sdm_integrator, pcm_conversion->pdm_conv,
    # noise_filter->pdm_filt, alsa_offset->channel_offset handled above)
    "auto_family": ("engine", "auto_family"),
    "channels": ("engine", "channels"),
    "fft_size": ("engine", "fft_size"),
    "pipelines": ("engine", "pipelines"),
    "direct_sdm": ("engine", "direct_sdm"),
    "dsd_6db": ("engine", "dsd_6db"),
    "integrator": ("engine", "sdm_integrator"),
    "sdm_conversion": ("engine", "sdm_conversion"),
    "pcm_conversion": ("engine", "pdm_conv"),
    "noise_filter": ("engine", "pdm_filt"),
    "gain_comp": ("engine", "gain_comp"),
    "playlist_album_gain": ("engine", "playlist_album_gain"),
    "pre_before_meter": ("engine", "pre_before_meter"),
    "quick_pause": ("engine", "quick_pause"),
    "short_buffer": ("engine", "short_buffer"),
    "volume_max": ("engine", "volume_max"),
    "volume_min": ("engine", "volume_min"),
    "volume_fixed": ("engine", "volume_fixed"),
    "adaptive_volume": ("engine", "volume_adaptive"),
    # logging / upnp
    "log_enabled": ("log", "enabled"),
    "log_file": ("log", "file"),
    "upnp_freewheel": ("upnp", "freewheel"),
}

# <post_process><plugin type="X" ...>. Field -> (plugin type, attribute).
PLUGIN_MAP: dict[str, tuple[str, str]] = {
    "post_bauer_enabled": ("bauer", "enabled"),
    "post_bauer_preset": ("bauer", "preset"),
    "post_bauer_frequency": ("bauer", "frequency"),
    "post_bauer_level": ("bauer", "level"),
    "post_correction_enabled": ("correction", "enabled"),
    "post_correction_dac0": ("correction", "dac0"),
}

# net_device fuses two XML attributes: value "S26/hw:CARD=Output,DEV=0" splits on
# the first "/" into <network address="S26" device="hw:CARD=Output,DEV=0">.
NET_DEVICE = "net_device"

# Fields whose XML attribute was absent/default in the grounding snapshot, so its
# location is not yet verified. Editing one is refused rather than guessed.
UNGROUNDED: frozenset[str] = frozenset({"idle_time", "alsa_dop", "net_dop", "fixed_volume", "fixed_volume_enabled"})


class GroundingError(ValueError):
    """An edit named a field with no verified XML location (UNGROUNDED) or one
    whose target element is absent from this snapshot."""


def _set_attr(tag: bytes, attr: str, value: str) -> bytes:
    """Set ``attr="value"`` on an element's open-tag bytes — replacing in place
    when present, inserting right after the tag name otherwise. Byte-faithful:
    nothing else in the tag moves."""
    replacement = f'{attr}="{value}"'.encode()
    pat = re.compile(rb"\b" + re.escape(attr.encode()) + rb'="[^"]*"')
    if pat.search(tag):
        return pat.sub(replacement, tag, count=1)
    name = re.match(rb"<[\w:.-]+", tag)
    if name is None:  # not an open tag — unreachable for the tags we match
        raise GroundingError("malformed element tag")
    cut = name.end()
    return tag[:cut] + b" " + replacement + tag[cut:]


def _edit_element(xml: bytes, tag_name: str, attr: str, value: str) -> bytes:
    """Apply one attribute edit to the single ``<tag_name ...>`` element."""
    pat = re.compile(rb"<" + re.escape(tag_name.encode()) + rb"\b[^>]*?/?>")
    m = pat.search(xml)
    if m is None:
        raise GroundingError(f"<{tag_name}> element absent from this snapshot")
    return xml[: m.start()] + _set_attr(m.group(0), attr, value) + xml[m.end() :]


def _edit_plugin(xml: bytes, plugin_type: str, attr: str, value: str) -> bytes:
    """Apply one attribute edit to the ``<plugin type="plugin_type" ...>`` in
    ``<post_process>`` (there are several plugins; match by type)."""
    needle = f'type="{plugin_type}"'.encode()
    for m in re.finditer(rb"<plugin\b[^>]*?/?>", xml):
        if needle in m.group(0):
            return xml[: m.start()] + _set_attr(m.group(0), attr, value) + xml[m.end() :]
    raise GroundingError(f'<plugin type="{plugin_type}"> absent from this snapshot')


def apply_edits(xml: bytes, edits: dict[str, str]) -> bytes:
    """Return ``xml`` with each staged form-field edit applied surgically.

    Refuses (``GroundingError``) any UNGROUNDED field, or any edit whose target
    element/plugin is absent — never writes a guessed attribute. All other bytes
    of the snapshot are preserved exactly."""
    refused = set(edits) & UNGROUNDED
    if refused:
        raise GroundingError(f"no grounded XML location for: {sorted(refused)}")
    for field, value in edits.items():
        if field == NET_DEVICE:
            address, _, device = value.partition("/")
            xml = _edit_element(xml, "network", "address", address)
            xml = _edit_element(xml, "network", "device", device)
        elif field in PLUGIN_MAP:
            xml = _edit_plugin(xml, *PLUGIN_MAP[field], value)
        elif field in FIELD_MAP:
            xml = _edit_element(xml, *FIELD_MAP[field], value)
        else:
            raise GroundingError(f"unknown config field: {field!r}")
    return xml


def _read_attr(xml: bytes, tag_name: str, attr: str) -> str | None:
    pat = re.compile(rb"<" + re.escape(tag_name.encode()) + rb"\b[^>]*?/?>")
    m = pat.search(xml)
    if m is None:
        return None
    am = re.search(rb"\b" + re.escape(attr.encode()) + rb'="([^"]*)"', m.group(0))
    return am.group(1).decode() if am else None


def _read_plugin_attr(xml: bytes, plugin_type: str, attr: str) -> str | None:
    needle = f'type="{plugin_type}"'.encode()
    for m in re.finditer(rb"<plugin\b[^>]*?/?>", xml):
        if needle in m.group(0):
            am = re.search(rb"\b" + re.escape(attr.encode()) + rb'="([^"]*)"', m.group(0))
            return am.group(1).decode() if am else None
    return None


def read_config(xml: bytes) -> dict[str, str]:
    """The grounded config fields declared by a snapshot XML, in form-field terms
    — the authority the verify/correct step diffs realized state against. Absent
    attributes are omitted. ``net_device`` is recombined as ``address/device``."""
    out: dict[str, str] = {}
    for field, (tag_name, attr) in FIELD_MAP.items():
        val = _read_attr(xml, tag_name, attr)
        if val is not None:
            out[field] = val
    for field, (ptype, attr) in PLUGIN_MAP.items():
        val = _read_plugin_attr(xml, ptype, attr)
        if val is not None:
            out[field] = val
    address = _read_attr(xml, "network", "address")
    device = _read_attr(xml, "network", "device")
    if address is not None and device is not None:
        out[NET_DEVICE] = f"{address}/{device}"
    return out


def snapshot_member(zip_bytes: bytes, active: str | None) -> bytes:
    """The active preset's snapshot XML from a ``/backup`` archive. ``[default]``
    (empty/absent name) has no ``cfgs`` snapshot — its definition *is* the base
    working config, so fall back to ``hqplayerd.xml``."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        names = z.namelist()
        member = f"data/cfgs/{active}.xml" if active else ""
        if member in names:
            return z.read(member)
        if "hqplayerd.xml" in names:
            return z.read("hqplayerd.xml")
        raise GroundingError(
            "backup archive has no base config (hqplayerd.xml) — the daemon returned an "
            "incomplete/empty backup; cannot build a restore"
        )


def restore_zip_from_snapshot(zip_bytes: bytes, active: str | None, edits: dict[str, str]) -> tuple[bytes, bytes]:
    """Build a ``POST /restore`` archive whose **working** ``hqplayerd.xml`` is
    the active preset's snapshot with ``edits`` applied — every other member,
    including the ``cfgs`` snapshots, copied byte-for-byte. So the running config
    becomes exactly ``{clean snapshot} ⊕ {edits}`` (no drift survives), while the
    named preset's saved definition is left untouched (edits are ephemeral until
    the user Saves). Returns ``(restore_zip, intended_working_xml)``."""
    intended = apply_edits(snapshot_member(zip_bytes, active), edits)
    out = io.BytesIO()
    with (
        zipfile.ZipFile(io.BytesIO(zip_bytes)) as zin,
        zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout,
    ):
        for item in zin.infolist():
            raw = intended if item.filename == "hqplayerd.xml" else zin.read(item.filename)
            zout.writestr(item, raw)
    return out.getvalue(), intended
