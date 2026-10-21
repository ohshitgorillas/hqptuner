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

Where the snapshot keeps each form field is the field register's answer
(``hqptuner.fields.query.located``): an element attribute, a ``<post_process>``
plugin attribute, or a codec this module and its siblings implement.

An edit whose target element/plugin is absent from a snapshot **creates** that
target at its schema position (``xmledit.PARENT``) carrying only the attribute the
user set. hqplayerd writes only the elements it has had reason to write, and fills
none of them back in on load — so a config that never had loudness configured has
no ``<plugin type="loudness">``, and a write path that could only edit what already
existed simply could not reach that half of its own form.
"""

from __future__ import annotations

import json

from hqptuner.audit import AuditLog
from hqptuner.conf.fixedvol import any_fixed_level, find_active_fixed, fixed_level_of, reconcile_fixed
from hqptuner.conf.matrixconf import materialize_profile, read_pipelines, replace_pipelines
from hqptuner.conf.matrixpayload import parse_delete, parse_save
from hqptuner.conf.matrixprofiles import (
    backfill_profile_chains,
    delete_profile,
    profile_names,
    profile_to_adopt,
    read_profiles,
    write_profile,
)
from hqptuner.conf.xmledit import GroundingError, edit_element, edit_plugin, find_element, find_plugin, get_attr
from hqptuner.fields.model import Attr, Codec, Location, Plugin
from hqptuner.fields.query import kept_at, located


class FieldEditFailedError(GroundingError):
    """A grounded edit failed, naming the setting whose edit it was rather than the element it touched."""

    def __init__(self, *, field: str, error: GroundingError) -> None:
        """Render the wording naming the failing setting and the underlying grounding failure."""
        super().__init__(f"{field}: {error}")


class UnknownFieldError(GroundingError):
    """A staged edit named a config field this module has no route for."""

    def __init__(self, *, field: str) -> None:
        """Render the wording naming the unrouted field."""
        super().__init__(f"unknown config field: {field!r}")


#: ``target`` of a profile write that lands in the running config rather than in
#: a stored preset — the fan-out uses ``preset:<name>`` (``presets/presetops``).
CONFIG_TARGET = "config"


def audit_profile_write(audit: AuditLog, xml: bytes, value: str, target: str) -> None:
    """Record a ``<matrix_profile>`` save against the XML it is about to edit.

    The element writers are pure XML with no audit side effect, so each place a
    profile lands, the running config or a stored preset, emits its own record
    with its own pre-edit bytes. Parses ``value`` with the same validator the writer uses, so the audit record
    and the write see one payload.
    """
    payload = parse_save(value)
    audit.profile_write(payload.name, json.dumps(payload.rows), target, replaced=payload.name in profile_names(xml))


def audit_profile_delete(audit: AuditLog, xml: bytes, name: str, target: str) -> None:
    """Record a ``<matrix_profile>`` delete against the XML it is about to edit."""
    audit.profile_delete(name, target, found=name in profile_names(xml))


def _apply_one(xml: bytes, field: str, value: str) -> bytes:
    """Route one staged edit to its grounded XML location, naming the SETTING in any refusal.

    The locator can only say which element it could not find, and "the alsa element is absent" does not tell a user
    which of the four things they just changed is the one that cannot be written.
    """
    try:
        return _route(xml, field, value)
    except GroundingError as exc:
        raise FieldEditFailedError(field=field, error=exc) from exc


def _route(xml: bytes, field: str, value: str) -> bytes:
    location = located().get(field)
    if location is Codec.NET_DEVICE:
        # net_device fuses two XML attributes: value "S26/hw:CARD=Output,DEV=0" splits on
        # the first "/" into <network address="S26" device="hw:CARD=Output,DEV=0">.
        address, _, device = value.partition("/")
        xml = edit_element(xml, "network", "address", address)
        return edit_element(xml, "network", "device", device)
    if isinstance(location, Plugin):
        return edit_plugin(xml, location.type, location.attr, value)
    if isinstance(location, Attr):
        return edit_element(xml, location.tag, location.attr, value)
    raise UnknownFieldError(field=field)


def _pop_profile_edits(remaining: dict[str, str]) -> dict[str, str]:
    """Take the saved-profile verbs out of the edit set.

    Separate from applying them because they are applied LAST and the field loop refuses any key it does not
    recognize — leaving them in place would raise "unknown config field".
    """
    verbs = (kept_at(Codec.PROFILE_DELETE), kept_at(Codec.PROFILE_SAVE))
    return {k: remaining.pop(k) for k in verbs if k in remaining}


def _apply_profile_edits(xml: bytes, verbs: dict[str, str], audit: AuditLog) -> bytes:
    """Apply the saved-profile verbs, delete before save.

    Staging holds at most one of each, and the pair co-occurs only as a rename — drop the old name, write the new
    one — where saving first would delete what was just written.
    """
    # Both audit flags are questions about the config as it stood, not about the
    # half-edited bytes a rename leaves between the delete and the save.
    before = xml
    delete, save = kept_at(Codec.PROFILE_DELETE), kept_at(Codec.PROFILE_SAVE)
    if delete in verbs:
        name, _ = parse_delete(verbs[delete])
        audit_profile_delete(audit, before, name, CONFIG_TARGET)
        xml = delete_profile(xml, name)
    if save in verbs:
        audit_profile_write(audit, before, verbs[save], CONFIG_TARGET)
        xml = write_profile(xml, verbs[save])
    return xml


def apply_edits(xml: bytes, edits: dict[str, str], audit: AuditLog | None = None, profile: str | None = None) -> bytes:
    """Return ``xml`` with each staged form-field edit applied surgically.

    Every form field has a grounded location; when the snapshot lacks the target
    element or plugin it is created there, carrying only the attribute being set.
    All other bytes of the snapshot are preserved exactly.

    ``audit`` arrives from the caller rather than a module-level handle so this
    module stays independent of manager state; omitted, the profile verbs record
    nothing.

    ``profile`` names the matrix profile the running engine is on. Its rows and
    its post-process chain are installed as the live matrix before any edit is
    applied, so the config the daemon restarts onto is the matrix the user was
    listening to — the selected profile is runtime-only state that no restart
    survives, and this is the only form of it the config file can hold. The
    staged edits then land on that matrix like any other.
    """
    remaining = dict(edits)
    # FIRST, ahead of the materialize below: a profile carrying no chain, materialized,
    # would install an empty chain over the live matrix before there was anything left
    # to copy from. Backfilling first gives it the chain the user is running, which
    # materialize then puts back where it came from.
    xml = backfill_profile_chains(xml)
    adopt = profile_to_adopt(edits, profile or "")
    if adopt:
        xml = materialize_profile(xml, adopt)
    profile_verbs = _pop_profile_edits(remaining)
    fixed = (kept_at(Codec.FIXED_ENABLED), kept_at(Codec.FIXED_LEVEL))
    fixed_edits = {k: remaining.pop(k) for k in fixed if k in remaining}
    if fixed_edits:
        xml = reconcile_fixed(xml, fixed_edits)
    pipelines = kept_at(Codec.PIPELINES)
    if pipelines in remaining:
        xml = replace_pipelines(xml, remaining.pop(pipelines))
    # The matrix switch is the user's. <post_process> lives INSIDE <matrix>, so a
    # plugin under a bypassed matrix is inert (readme §1.11 / §1.11.2) — but that
    # is a fact to TELL the user, not to act on behind them: matrix also carries
    # channel routing, and the UI grays the whole chain and names the reason while
    # the engine is bypassed (store/schema.js matrixBypassed).
    for field, value in remaining.items():
        xml = _apply_one(xml, field, value)
    # LAST: a save copies the live <post_process> chain, so it has to run after
    # this apply's own plugin edits — otherwise engaging correction and saving a
    # profile in one apply stores the correction the user just turned OFF.
    return _apply_profile_edits(xml, profile_verbs, audit if audit is not None else AuditLog(None))


def _read_attr(xml: bytes, tag_name: str, attr: str) -> str | None:
    m = find_element(xml, tag_name)
    return get_attr(m.group(0), attr) if m is not None else None


def _read_plugin_attr(xml: bytes, plugin_type: str, attr: str) -> str | None:
    m = find_plugin(xml, plugin_type)
    return get_attr(m.group(0), attr) if m is not None else None


def read_config(xml: bytes) -> dict[str, str]:
    """Read the grounded config fields declared by a snapshot XML, in form-field terms.

    This is the authority the verify/correct step diffs realized state against. Absent attributes are omitted.
    ``net_device`` is recombined as ``address/device``.
    """
    out: dict[str, str] = {}
    for field, location in located().items():
        val = _read_location(xml, location)
        if val is not None:
            out[field] = val
    out.update(_read_special(xml))
    return out


def _read_location(xml: bytes, location: Location) -> str | None:
    """Read the value at one element or plugin attribute; None for any other location, which the codecs read."""
    if isinstance(location, Attr):
        return _read_attr(xml, location.tag, location.attr)
    if isinstance(location, Plugin):
        return _read_plugin_attr(xml, location.type, location.attr)
    return None


def _read_special(xml: bytes) -> dict[str, str]:
    """Read the fields the register keeps through a codec rather than at one attribute.

    Those are the fused net_device, the atomic pipeline set, and presence-means-enabled fixed volume.
    """
    out: dict[str, str] = {}
    address = _read_attr(xml, "network", "address")
    device = _read_attr(xml, "network", "device")
    if address is not None and device is not None:
        out[kept_at(Codec.NET_DEVICE)] = f"{address}/{device}"
    pipelines = read_pipelines(xml)
    if pipelines is not None:
        out[kept_at(Codec.PIPELINES)] = pipelines
    # saved profiles: the readback that proves a staged save or delete reached the
    # config file, since the daemon never writes the element itself
    out[kept_at(Codec.PROFILES)] = read_profiles(xml)
    # fixed volume: presence of the top-level <fixed> element is the "enabled" flag
    active_fixed = find_active_fixed(xml)
    out[kept_at(Codec.FIXED_ENABLED)] = "1" if active_fixed is not None else "0"
    # The LEVEL is reported whether or not the feature is on: when it is off the
    # level lives in the commented line (fixedvol's remember step), and that parked
    # number is the user's, where the daemon's form only ever offers its own.
    # Omitting it here is what let the box fall back to the form and read as
    # "reverted".
    level = fixed_level_of(active_fixed.group(0)) if active_fixed is not None else any_fixed_level(xml)
    if level is not None:
        out[kept_at(Codec.FIXED_LEVEL)] = level
    return out
