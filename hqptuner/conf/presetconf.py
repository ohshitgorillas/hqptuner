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
form against a real snapshot on 6.0.4), then completed against the daemon manual
(``hqplayerd-readme.txt``) and a live config dump — every form field has a
verified XML location, so nothing is refused-because-ungrounded. The five that the
value-correlation alone could not place (their attribute sat at default/absent in
that snapshot) are grounded here from the manual: ``idle_time`` → ``<engine
idle_time>``, DoP → ``<alsa|network pack_sdm>``, and the fixed-volume pair onto the
top-level ``<fixed>`` element (below).

An edit whose target element/plugin is absent from a snapshot **creates** that
target at its schema position (``xmledit.PARENT``) carrying only the attribute the
user set. hqplayerd writes only the elements it has had reason to write, and fills
none of them back in on load — so a config that never had loudness configured has
no ``<plugin type="loudness">``, and a write path that could only edit what already
existed simply could not reach that half of its own form.
"""

from __future__ import annotations

from .fixedvol import (
    FIXED_ENABLED,
    FIXED_LEVEL,
    any_fixed_level,
    enable_matrix,
    enables_post_process,
    find_active_fixed,
    fixed_level_of,
    reconcile_fixed,
)
from .matrixconf import (
    MATRIX_PIPELINES,
    MATRIX_PROFILE_DELETE,
    MATRIX_PROFILE_SAVE,
    MATRIX_PROFILES,
    delete_profile,
    parse_delete,
    read_pipelines,
    read_profiles,
    replace_pipelines,
    write_profile,
)
from .xmledit import (
    GroundingError,
    edit_element,
    edit_plugin,
    find_element,
    find_plugin,
    get_attr,
)

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
    "alsa_dop": ("alsa", "pack_sdm"),  # readme §1.3.2: pack_sdm 0=None, 1=DoP v1.1
    # Network backend section (net_device is special — see NET_DEVICE)
    "net_bits": ("network", "dac_bits"),
    "net_period": ("network", "period_time"),
    "net_anydsd": ("network", "any_dsd"),
    "net_ipv6": ("network", "ipv6"),
    "net_dop": ("network", "pack_sdm"),  # readme §1.3.5: pack_sdm 0=None, 1=DoP v1.1
    # engine (name drift: integrator->sdm_integrator, pcm_conversion->pdm_conv,
    # noise_filter->pdm_filt, alsa_offset->channel_offset handled above)
    "auto_family": ("engine", "auto_family"),
    "idle_time": ("engine", "idle_time"),  # readme §1.3: engine idle-hold, in ms
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
    # matrix processing — the carrier element for the <post_process> plugin chain
    # and the pipeline table (pipelines themselves ride MATRIX_PIPELINES below)
    "matrix_enabled": ("matrix", "enabled"),
    "matrix_engine": ("matrix", "engine"),
    "matrix_expand_hf": ("matrix", "expand_hf"),
    "matrix_iir2fir": ("matrix", "iir2fir"),
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
    # loudness plugin — form field -> XML attr, grounded by value-correlation: the
    # live /matrix form defaults uniquely match the snapshot's <plugin
    # type="loudness"> attributes (lowfreq=80<->low_frequency, lowtype=lshelf<->
    # low_type, rangehigh=-20<->range_high, ...). readme §1.11.2.1 documents them.
    "post_loudness_enabled": ("loudness", "enabled"),
    "post_loudness_lowfreq": ("loudness", "low_frequency"),
    "post_loudness_lowlevel": ("loudness", "low_level"),
    "post_loudness_lowsteep": ("loudness", "low_steepness"),
    "post_loudness_lowtype": ("loudness", "low_type"),
    "post_loudness_highfreq": ("loudness", "high_frequency"),
    "post_loudness_highlevel": ("loudness", "high_level"),
    "post_loudness_highsteep": ("loudness", "high_steepness"),
    "post_loudness_hightype": ("loudness", "high_type"),
    "post_loudness_rangelow": ("loudness", "range_low"),
    "post_loudness_rangehigh": ("loudness", "range_high"),
}

# net_device fuses two XML attributes: value "S26/hw:CARD=Output,DEV=0" splits on
# the first "/" into <network address="S26" device="hw:CARD=Output,DEV=0">.
NET_DEVICE = "net_device"


def _apply_one(xml: bytes, field: str, value: str) -> bytes:
    """Route one staged edit to its grounded XML location, naming the SETTING in
    any refusal. The locator can only say which element it could not find, and
    "the alsa element is absent" does not tell a user which of the four things
    they just changed is the one that cannot be written."""
    try:
        return _route(xml, field, value)
    except GroundingError as exc:
        raise GroundingError(f"{field}: {exc}") from exc


def _route(xml: bytes, field: str, value: str) -> bytes:
    if field == NET_DEVICE:
        address, _, device = value.partition("/")
        xml = edit_element(xml, "network", "address", address)
        return edit_element(xml, "network", "device", device)
    if field in PLUGIN_MAP:
        return edit_plugin(xml, *PLUGIN_MAP[field], value)
    if field in FIELD_MAP:
        return edit_element(xml, *FIELD_MAP[field], value)
    raise GroundingError(f"unknown config field: {field!r}")


def _apply_profile_edits(xml: bytes, remaining: dict[str, str]) -> bytes:
    """The saved-profile verbs, delete before save. Staging holds at most one of
    each, and the pair co-occurs only as a rename — drop the old name, write the
    new one — where saving first would delete what was just written."""
    if MATRIX_PROFILE_DELETE in remaining:
        name, _ = parse_delete(remaining.pop(MATRIX_PROFILE_DELETE))
        xml = delete_profile(xml, name)
    if MATRIX_PROFILE_SAVE in remaining:
        xml = write_profile(xml, remaining.pop(MATRIX_PROFILE_SAVE))
    return xml


def apply_edits(xml: bytes, edits: dict[str, str]) -> bytes:
    """Return ``xml`` with each staged form-field edit applied surgically.

    Every form field has a grounded location; when the snapshot lacks the target
    element or plugin it is created there, carrying only the attribute being set.
    All other bytes of the snapshot are preserved exactly."""
    remaining = dict(edits)
    fixed_edits = {k: remaining.pop(k) for k in (FIXED_ENABLED, FIXED_LEVEL) if k in remaining}
    if fixed_edits:
        xml = reconcile_fixed(xml, fixed_edits)
    if MATRIX_PIPELINES in remaining:
        xml = replace_pipelines(xml, remaining.pop(MATRIX_PIPELINES))
    xml = _apply_profile_edits(xml, remaining)
    # <post_process> lives INSIDE <matrix>, and matrix processing must be on for any
    # plugin to run at all (readme §1.11 / §1.11.2) — a preset with matrix enabled="0"
    # silently swallows crossfeed/loudness/correction. So switching a post-process
    # feature on also switches the matrix on. Deliberately never auto-OFF: matrix also
    # carries channel routing, and disabling it would break a user's pipeline setup.
    if enables_post_process(remaining, PLUGIN_MAP):
        xml = enable_matrix(xml)
    for field, value in remaining.items():
        xml = _apply_one(xml, field, value)
    return xml


def _read_attr(xml: bytes, tag_name: str, attr: str) -> str | None:
    m = find_element(xml, tag_name)
    return get_attr(m.group(0), attr) if m is not None else None


def _read_plugin_attr(xml: bytes, plugin_type: str, attr: str) -> str | None:
    m = find_plugin(xml, plugin_type)
    return get_attr(m.group(0), attr) if m is not None else None


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
    out.update(_read_special(xml))
    return out


def _read_special(xml: bytes) -> dict[str, str]:
    """The fields that don't fit the one-tag-one-attr maps: the fused net_device,
    the atomic pipeline set, and presence-means-enabled fixed volume."""
    out: dict[str, str] = {}
    address = _read_attr(xml, "network", "address")
    device = _read_attr(xml, "network", "device")
    if address is not None and device is not None:
        out[NET_DEVICE] = f"{address}/{device}"
    pipelines = read_pipelines(xml)
    if pipelines is not None:
        out[MATRIX_PIPELINES] = pipelines
    # saved profiles: the readback that proves a staged save or delete reached the
    # config file, since the daemon never writes the element itself (round 5)
    out[MATRIX_PROFILES] = read_profiles(xml)
    # fixed volume: presence of the top-level <fixed> element is the "enabled" flag
    active_fixed = find_active_fixed(xml)
    out[FIXED_ENABLED] = "1" if active_fixed is not None else "0"
    # The LEVEL is reported whether or not the feature is on: when it is off the
    # level lives in the commented line (fixedvol's remember step), and that parked
    # number is the user's, where the daemon's form only ever offers its own.
    # Omitting it here is what let the box fall back to the form and read as
    # "reverted".
    level = fixed_level_of(active_fixed.group(0)) if active_fixed is not None else any_fixed_level(xml)
    if level is not None:
        out[FIXED_LEVEL] = level
    return out
