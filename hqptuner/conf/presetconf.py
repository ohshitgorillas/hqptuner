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

import io
import re
import zipfile

from . import engineconf
from .matrixconf import (
    MATRIX_PIPELINES,
    MATRIX_PROFILE_DELETE,
    MATRIX_PROFILE_SAVE,
    MATRIX_PROFILES,
    GroundingError,
    delete_profile,
    read_pipelines,
    read_profiles,
    replace_pipelines,
    write_profile,
)
from .xmledit import (
    edit_element,
    edit_plugin,
    find_element,
    find_plugin,
    get_attr,
    open_tag_re,
)

__all__ = ["MATRIX_PIPELINES", "GroundingError"]  # re-exported for existing importers

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

# Fixed volume is a top-level ``<fixed volume="X"/>`` element whose PRESENCE means
# "enabled" — there is no ``enabled`` attribute (readme §1.13 + live config). The
# two form fields fold onto that one element, reconciled together (_reconcile_fixed).
FIXED_ENABLED = "fixed_volume_enabled"
FIXED_LEVEL = "fixed_volume"
_TRUTHY = frozenset({"1", "on", "true", "yes"})


# the daemon's parked memory for a disabled fixed volume, and now ours too
_COMMENTED_FIXED_RE = re.compile(rb"\n?[ \t]*<!--\s*<fixed\b[^>]*/>\s*-->")


def _find_active_fixed(xml: bytes) -> re.Match[bytes] | None:
    """The live ``<fixed .../>`` element, or None — the daemon parks the
    remembered level in a commented one when the feature is off."""
    return find_element(xml, "fixed")


def _fixed_level_of(tag: bytes) -> str | None:
    return get_attr(tag, "volume")


def _any_fixed_level(xml: bytes) -> str | None:
    """The level off the first ``<fixed>`` tag anywhere — the active element, or
    the commented-out one a disabled level is parked in. None when this config has
    never carried a fixed volume at all, which is different from carrying 0 dBFS."""
    for m in open_tag_re("fixed").finditer(xml):
        lvl = _fixed_level_of(m.group(0))
        if lvl is not None:
            return lvl
    return None


def _remembered_level(xml: bytes) -> str:
    """Last-known fixed-volume level — the active element, else a commented one
    (the daemon's memory when off), else 0 dBFS."""
    return _any_fixed_level(xml) or "0"


def _fixed_target(xml: bytes, fixed_edits: dict[str, str], active: re.Match[bytes] | None) -> tuple[bool, str]:
    """Desired (enabled, level) for ``<fixed>``: an unstaged half falls back to the
    snapshot's current state, so editing one field never clobbers the other."""
    if FIXED_ENABLED in fixed_edits:
        enabled = fixed_edits[FIXED_ENABLED].strip().lower() in _TRUTHY
    else:
        # Staging the LEVEL alone switches the feature ON. Presence of <fixed> IS
        # the enabled flag, so there is nowhere to park a level while the feature
        # is off — a level edit that left it off was silently discarded, and the
        # apply reported success because read_config then omits the field it just
        # dropped. Same precedent as _enables_post_process switching matrix on for
        # a plugin edit. An explicit fixed_volume_enabled=0 still wins: it is
        # handled above, so "turn it off" never resurrects the feature.
        enabled = FIXED_LEVEL in fixed_edits or active is not None
    current = _fixed_level_of(active.group(0)) if active is not None else None
    return enabled, fixed_edits.get(FIXED_LEVEL) or current or _remembered_level(xml)


def _strip_active_fixed(xml: bytes, active: re.Match[bytes]) -> bytes:
    """Remove the active ``<fixed/>`` element plus its own indentation, so toggling
    the feature doesn't accrete blank lines."""
    start = active.start()
    while start > 0 and xml[start - 1 : start] in (b" ", b"\t"):
        start -= 1
    if start > 0 and xml[start - 1 : start] == b"\n":
        start -= 1
    return xml[:start] + xml[active.end() :]


def _insert_root_child(xml: bytes, tag: bytes) -> bytes:
    """Insert ``tag`` as the first child of ``<hqplayerd>``, where the daemon
    itself writes the fixed-volume line."""
    open_tag = re.search(rb"<hqplayerd\b[^>]*>", xml)
    if open_tag is None:
        raise GroundingError("<hqplayerd> root element absent from this snapshot")
    cut = open_tag.end()
    return xml[:cut] + b"\n\t" + tag + xml[cut:]


def _insert_fixed(xml: bytes, level: str) -> bytes:
    """The live ``<fixed volume="level"/>`` — its presence is what "enabled" means."""
    return _insert_root_child(xml, f'<fixed volume="{level}"/>'.encode())


def _remember_fixed(xml: bytes, level: str) -> bytes:
    """Park the level in a COMMENTED ``<fixed>`` line rather than dropping it.

    This is the daemon's own convention, not an invention: a real 6.0.4 config
    whose fixed volume is off carries ``<!--<fixed volume="-3"/>-->``, and
    ``_remembered_level`` has always read it back. Only the write side disagreed —
    disabling deleted the element outright, so a level typed before the feature was
    switched off was destroyed, and the box then showed the daemon's own remembered
    value instead of the user's. Our disable was lossier than hqplayerd's."""
    return _insert_root_child(xml, f'<!--<fixed volume="{level}"/>-->'.encode())


def _reconcile_fixed(xml: bytes, fixed_edits: dict[str, str]) -> bytes:
    """Fold the ``fixed_volume_enabled`` / ``fixed_volume`` pair onto the top-level
    ``<fixed>`` element: enabled ⇒ ``<fixed volume="level"/>`` live, disabled ⇒ the
    same line commented out so the level survives. Every other byte is preserved."""
    active = _find_active_fixed(xml)
    enabled, level = _fixed_target(xml, fixed_edits, active)  # reads the old memory, so run it first
    if active is not None:
        xml = _strip_active_fixed(xml, active)
    # whichever way this goes, the previous memory is superseded — leaving it would
    # stack a fresh comment on every toggle and give _remembered_level a stale first hit
    xml = _COMMENTED_FIXED_RE.sub(b"", xml)
    return _insert_fixed(xml, level) if enabled else _remember_fixed(xml, level)


def _enables_post_process(edits: dict[str, str]) -> bool:
    """True when any staged edit switches a ``<post_process>`` plugin ON."""
    return any(
        PLUGIN_MAP.get(field, ("", ""))[1] == "enabled" and value.strip().lower() in _TRUTHY
        for field, value in edits.items()
    )


def _enable_matrix(xml: bytes) -> bytes:
    """Switch ``<matrix enabled="1">`` on, placing the element when the snapshot
    has none — which is exactly the config that needs it, since a plugin the
    daemon never wrote lives in a matrix the daemon never wrote either."""
    return edit_element(xml, "matrix", "enabled", "1")


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
        xml = delete_profile(xml, remaining.pop(MATRIX_PROFILE_DELETE))
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
        xml = _reconcile_fixed(xml, fixed_edits)
    if MATRIX_PIPELINES in remaining:
        xml = replace_pipelines(xml, remaining.pop(MATRIX_PIPELINES))
    xml = _apply_profile_edits(xml, remaining)
    # <post_process> lives INSIDE <matrix>, and matrix processing must be on for any
    # plugin to run at all (readme §1.11 / §1.11.2) — a preset with matrix enabled="0"
    # silently swallows crossfeed/loudness/correction. So switching a post-process
    # feature on also switches the matrix on. Deliberately never auto-OFF: matrix also
    # carries channel routing, and disabling it would break a user's pipeline setup.
    if _enables_post_process(remaining):
        xml = _enable_matrix(xml)
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
    active_fixed = _find_active_fixed(xml)
    out[FIXED_ENABLED] = "1" if active_fixed is not None else "0"
    # The LEVEL is reported whether or not the feature is on: when it is off the
    # level lives in the commented line (_remember_fixed), and that parked number
    # is the user's, where the daemon's form only ever offers its own. Omitting it
    # here is what let the box fall back to the form and read as "reverted".
    level = _fixed_level_of(active_fixed.group(0)) if active_fixed is not None else _any_fixed_level(xml)
    if level is not None:
        out[FIXED_LEVEL] = level
    return out


def snapshot_member(zip_bytes: bytes, active: str | None, running_label: str | None = None) -> bytes:
    """The active preset's snapshot XML from a ``/backup`` archive. ``[default]``
    (empty/absent name) has no ``cfgs`` snapshot — its definition *is* the working
    config, so fall back to the running-config member (``hqplayerd.xml``, or the
    root ``<Profile>.xml`` when a named preset is active).

    The two labels are different questions and only look alike: ``active`` picks
    WHICH SNAPSHOT to read, ``running_label`` says what the daemon named the
    WORKING member. A caller that wants the running config passes ``active=None``
    and the daemon's active-profile label as ``running_label``."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        names = z.namelist()
        member = engineconf.snapshot_member_name(active) if active else ""
        if member in names:
            return z.read(member)
        running = engineconf.running_config_name(names, running_label or active)
        if running:
            return z.read(running)
        raise GroundingError(
            "backup archive has no working config (no hqplayerd.xml, no resolvable root-level preset XML) — "
            f"cannot build a restore. The archive holds: {engineconf.archive_summary(zip_bytes)}"
        )


def restore_zip_from_running(
    zip_bytes: bytes,
    edits: dict[str, str],
    extra_members: dict[str, bytes] | None = None,
    active: str | None = None,
) -> tuple[bytes, bytes]:
    """Build a ``POST /restore`` archive whose **working** config member
    (``hqplayerd.xml``, or the root ``<Profile>.xml`` when a named preset is
    active) is the CURRENT working config with ``edits`` applied — every other member,
    including the ``cfgs`` snapshots, copied byte-for-byte. So the running config
    becomes ``{running config} ⊕ {edits}``, and the named preset's saved
    definition is left untouched (edits are ephemeral until the user Saves).
    Returns ``(restore_zip, intended_working_xml)``.

    This used to rebuild from the active preset's SNAPSHOT so that daemon-side
    drift never survived an apply. That reset every field the user had not
    staged in this particular apply back to the preset's stored value, so two
    sequential applies clobbered each other: staging direct_sdm reverted
    volume_fixed, staging volume_fixed reverted direct_sdm (both reproduced
    against the live 6.0.4 daemon). Applies must be incremental against what is
    actually running; discarding drift is not worth discarding the user's own
    previous edits."""
    intended = apply_edits(snapshot_member(zip_bytes, None, active), edits)
    # The live config is hqplayerd.xml, or the root <Profile>.xml when a named
    # preset is active — rewrite THAT member and leave the cfgs snapshots (the
    # preset's saved definition) untouched, so edits stay ephemeral until Save.
    # Uploaded filter files replace their member if it exists and append if not;
    # either way the restore writes them to the daemon's disk.
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zin:
        running = engineconf.running_config_name(zin.namelist(), active)
    substitutions = dict(extra_members or {})
    if running is not None:
        substitutions[running] = intended
    return engineconf.rewrite_zip(zip_bytes, substitutions), intended


def restore_zip_with_working(
    zip_bytes: bytes,
    working_xml: bytes,
    mirror_name: str | None = None,
    mirror_xml: bytes | None = None,
) -> bytes:
    """Build a ``POST /restore`` archive whose ``[default]`` working config
    (``hqplayerd.xml``) is ``working_xml`` — the config the daemon actually runs,
    since a restore always lands the daemon on ``[default]`` (docs/protocol.md).

    When ``mirror_name`` is given, also (over)write ``data/cfgs/<mirror_name>.xml``
    = ``mirror_xml`` (defaulting to ``working_xml``), so hqplayerd's own native
    profile list mirrors HQPTuner's preset store. Every other member is copied
    byte-for-byte. ``hqplayerd.xml`` is inserted when the source archive lacks it
    (a named profile was active, so its working member was root-renamed)."""
    substitutions = {"hqplayerd.xml": working_xml}
    if mirror_name:
        substitutions[engineconf.snapshot_member_name(mirror_name)] = (
            mirror_xml if mirror_xml is not None else working_xml
        )
    # rewrite_zip appends whichever of the two the archive lacks — which is the
    # preset-active case, where the working member was root-renamed
    return engineconf.rewrite_zip(zip_bytes, substitutions)


def snapshot_members(zip_bytes: bytes) -> dict[str, bytes]:
    """Every named preset snapshot in a ``/backup`` archive, keyed by preset name
    (the ``data/cfgs/<name>.xml`` members). Powers the one-time migration of
    hqplayerd's presets into the HQPTuner-owned store."""
    out: dict[str, bytes] = {}
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        for name in z.namelist():
            stem = engineconf.snapshot_name(name)
            if stem is not None:
                out[stem] = z.read(name)
    return out
