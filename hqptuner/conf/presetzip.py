"""Snapshot and restore-archive helpers over hqplayerd ``/backup`` zip archives."""

from __future__ import annotations

import io
import zipfile

from . import engineconf
from .presetconf import apply_edits
from .xmledit import GroundingError


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

    Never rebuild from the active preset's SNAPSHOT to shed daemon-side drift:
    that resets every field the user did not stage in this particular apply back
    to the preset's stored value, so two sequential applies clobber each other
    (staging direct_sdm reverts volume_fixed and vice versa — reproduced against
    the live 6.0.4 daemon). Applies must be incremental against what is actually
    running; discarding drift is not worth discarding the user's own previous
    edits."""
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
