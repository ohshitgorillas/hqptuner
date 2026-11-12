"""Snapshot and restore-archive helpers over hqplayerd ``/backup`` zip archives."""

from __future__ import annotations

import io
import lzma
import struct
import zipfile
import zlib
from dataclasses import dataclass
from typing import TYPE_CHECKING

from hqptuner.conf import engineconf
from hqptuner.conf.httpconf import BACKUP_CEILING
from hqptuner.conf.presetconf import apply_edits
from hqptuner.conf.xmledit import GroundingError


class NoWorkingConfigError(GroundingError):
    """A backup archive carries no working config to build a restore from."""

    def __init__(self, *, archive: engineconf.ArchiveSummary) -> None:
        """Render the wording naming what the archive holds instead."""
        super().__init__(
            "backup archive has no working config (no hqplayerd.xml, no resolvable root-level preset XML) — "
            f"cannot build a restore. The archive holds: {archive}"
        )


class ArchiveOverCeilingError(GroundingError):
    """A backup archive declares more decompressed bytes than a settings archive can hold."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("backup archive declares more data than a settings archive can hold")


if TYPE_CHECKING:
    from hqptuner.audit import AuditLog


def snapshot_member(zip_bytes: bytes, active: str | None, running_label: str | None = None) -> bytes:
    """Read the active preset's snapshot XML from a ``/backup`` archive.

    ``[default]`` (empty/absent name) has no ``cfgs`` snapshot — its definition *is* the working config, so fall back
    to the running-config member (``hqplayerd.xml``, or the root ``<Profile>.xml`` when a named preset is active).

    The two labels are different questions and only look alike: ``active`` picks
    WHICH SNAPSHOT to read, ``running_label`` says what the daemon named the
    WORKING member. A caller that wants the running config passes ``active=None``
    and the daemon's active-profile label as ``running_label``.
    """
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        names = z.namelist()
        member = engineconf.snapshot_member_name(active) if active else ""
        if member in names:
            return z.read(member)
        running = engineconf.running_config_name(names, running_label or active)
        if running:
            return z.read(running)
        raise NoWorkingConfigError(archive=engineconf.archive_summary(zip_bytes))


@dataclass(frozen=True, slots=True)
class ApplyContext:
    """What an apply is being made *for*, as opposed to what it changes.

    One object rather than four trailing parameters: these travel together, every
    one of them is optional, and a positional call site with four defaults at the
    end is where an argument quietly lands in the wrong slot.

    ``active`` names the preset whose definition is live; ``matrix_profile`` the
    matrix profile the engine is running, which scopes the matrix-side edits;
    ``audit`` records the profile writes; ``extra_members`` are the parked filter
    uploads that ride the same restore.
    """

    active: str | None = None
    matrix_profile: str | None = None
    audit: AuditLog | None = None
    extra_members: dict[str, bytes] | None = None


def restore_zip_from_running(
    zip_bytes: bytes,
    edits: dict[str, str],
    context: ApplyContext | None = None,
) -> tuple[bytes, bytes]:
    """Build a ``POST /restore`` archive whose ``hqplayerd.xml`` is the current working config plus ``edits``.

    The working config is read from ``hqplayerd.xml``, or from the root ``<Profile>.xml`` when a named preset is
    active, and written to ``hqplayerd.xml`` either way: the restore boots ``[default]`` off that member
    (docs/protocol.md §3.6). Every other member, including the ``cfgs`` snapshots, is copied byte-for-byte. So the
    running config becomes ``{running config} ⊕ {edits}``, and the named preset's saved definition is left untouched
    (edits are ephemeral until the user Saves). Returns ``(restore_zip, intended_working_xml)``.

    Never rebuild from the active preset's SNAPSHOT to shed daemon-side drift:
    that resets every field the user did not stage in this particular apply back
    to the preset's stored value, so two sequential applies clobber each other
    (staging direct_sdm reverts volume_fixed and vice versa). Applies must be
    incremental against what is actually
    running; discarding drift is not worth discarding the user's own previous
    edits.

    ``context.audit`` is carried straight through to ``apply_edits``, which is
    where the running config's profile writes are recorded; so is
    ``context.matrix_profile``, which scopes the matrix-side edits.
    """
    ctx = context if context is not None else ApplyContext()
    active = ctx.active
    intended = apply_edits(snapshot_member(zip_bytes, None, active), edits, ctx.audit, ctx.matrix_profile)
    # Rewrite the member the restore boots and leave the cfgs snapshots (the
    # preset's saved definition) untouched, so edits stay ephemeral until Save.
    # Uploaded filter files replace their member if it exists and append if not;
    # either way the restore writes them to the daemon's disk.
    booted = engineconf.with_boot_member(zip_bytes, active)
    with zipfile.ZipFile(io.BytesIO(booted)) as zin:
        running = engineconf.running_config_name(zin.namelist(), active)
    substitutions = dict(ctx.extra_members or {})
    if running is not None:
        substitutions[running] = intended
    return engineconf.rewrite_zip(booted, substitutions), intended


def restore_zip_with_working(
    zip_bytes: bytes,
    working_xml: bytes,
    mirror_name: str | None = None,
    mirror_xml: bytes | None = None,
) -> bytes:
    """Build a ``POST /restore`` archive whose ``[default]`` working config (``hqplayerd.xml``) is ``working_xml``.

    That is the config the daemon actually runs, since a restore always lands the daemon on ``[default]``
    (docs/protocol.md).

    When ``mirror_name`` is given, also (over)write ``data/cfgs/<mirror_name>.xml``
    = ``mirror_xml`` (defaulting to ``working_xml``), so hqplayerd's own native
    profile list mirrors HQPTuner's preset store. Every other member is copied
    byte-for-byte. ``hqplayerd.xml`` is inserted when the source archive lacks it
    (a named profile was active, so its working member was root-renamed).
    """
    substitutions = {"hqplayerd.xml": working_xml}
    if mirror_name:
        substitutions[engineconf.snapshot_member_name(mirror_name)] = (
            mirror_xml if mirror_xml is not None else working_xml
        )
    # rewrite_zip appends whichever of the two the archive lacks — which is the
    # preset-active case, where the working member was root-renamed
    return engineconf.rewrite_zip(zip_bytes, substitutions)


#: Where HQPTuner's own records ride in a settings archive. Namespaced under a directory of ours so it can never
#: collide with a member hqplayerd writes, and stripped again before any archive is handed back to the daemon —
#: what the user downloads carries it, what the daemon restores does not.
DESCRIPTIONS_MEMBER = "hqptuner/descriptions.json"

#: The most the descriptions member can weigh. ``conf`` cannot import the store, so its limits are restated here:
#: 256 profiles, each a name of up to 128 characters and a text of up to 2000, the store writing them with
#: ``json.dumps``, which spells a character outside the Basic Multilingual Plane as a 12-byte surrogate pair
#: (a raw UTF-8 member from another tool needs 4), plus 256 bytes of framing per entry and 1 KiB for the envelope.
DESCRIPTIONS_CEILING = 256 * (12 * (128 + 2000) + 256) + 1024

#: What decompressing or listing an archive member can raise, whatever the archive claims to be: a damaged
#: directory or stream (``BadZipFile``, ``zlib.error``, ``lzma.LZMAError``, ``EOFError``), a member it cannot open
#: (``RuntimeError`` for an encrypted one, ``NotImplementedError`` for an unsupported method, ``LargeZipFile``), a
#: malformed field (``ValueError``, ``struct.error``) and the file layer (``OSError``, which ``bz2`` raises).
ARCHIVE_FAULTS = (
    zipfile.BadZipFile,
    zipfile.LargeZipFile,
    zlib.error,
    lzma.LZMAError,
    struct.error,
    EOFError,
    NotImplementedError,
    RuntimeError,
    ValueError,
    OSError,
)

#: The most one archive member may declare it decompresses to, and the most all of them together may. A settings
#: archive is a few small config files and the parked filters, which ride it as ``data/`` members and are held to
#: 32 MiB each by default (``Config.filter_max_bytes``): the member ceiling is twice that, the total twice again.
MEMBER_CEILING = 64 * 2**20
TOTAL_CEILING = 128 * 2**20

#: The most a restore upload may be: a backup of the size the 8088 lane itself reads, plus the descriptions member.
RESTORE_UPLOAD_CEILING = BACKUP_CEILING + DESCRIPTIONS_CEILING


def embed_descriptions(zip_bytes: bytes, payload: bytes) -> bytes:
    """Return the archive with ``payload`` added as the descriptions member; unchanged for an empty payload.

    This is what makes a downloaded backup carry the user's profile descriptions to another install. Every daemon
    member is copied byte-for-byte (``rewrite_zip``), so the archive stays a valid restore source with or without us.
    """
    if not payload:
        return zip_bytes
    return engineconf.rewrite_zip(zip_bytes, {DESCRIPTIONS_MEMBER: payload})


def is_archive(data: bytes) -> bool:
    """Whether an upload is a zip archive at all, as opposed to a bare XML config file."""
    return zipfile.is_zipfile(io.BytesIO(data))


def list_members(zip_bytes: bytes) -> list[zipfile.ZipInfo]:
    """Every member's directory entry, read from the directory alone; ``UnreadableArchiveError`` when it won't list."""
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            return z.infolist()
    except ARCHIVE_FAULTS as exc:
        raise engineconf.UnreadableArchiveError(zip_bytes) from exc


@dataclass(frozen=True)
class SizeCheck:
    """``check_sizes``'s answer.

    ``oversize_member`` names the first member declaring more than ``MEMBER_CEILING``, ``total_over`` says the declared
    total is more than ``TOTAL_CEILING``.
    """

    oversize_member: str | None
    total_over: bool

    @property
    def ok(self) -> bool:
        """Whether the archive declares nothing past either ceiling."""
        return self.oversize_member is None and not self.total_over


def check_sizes(members: list[zipfile.ZipInfo]) -> SizeCheck:
    """Judge an archive by the decompressed sizes its directory declares, before any member is read.

    ``zipfile`` stops a member's read at its declared size, so what is declared bounds what any later read produces.
    """
    oversize = next((m.filename for m in members if m.file_size > MEMBER_CEILING), None)
    return SizeCheck(oversize, sum(m.file_size for m in members) > TOTAL_CEILING)


def take_descriptions(zip_bytes: bytes) -> tuple[bytes, bytes | None]:
    """Split an uploaded archive into (archive without our member, the member's bytes or None).

    The daemon never sees the member: it is not a member hqplayerd wrote, and a restore is not the place to find out
    what it does with one. A payload that is not a readable zip, or whose members will not decompress, raises
    ``UnreadableArchiveError``; the caller decides what that means.
    """
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zin:
            payload = zin.read(DESCRIPTIONS_MEMBER) if DESCRIPTIONS_MEMBER in zin.namelist() else None
            carried = zin.infolist() if payload is not None else []
            kept = [(item, zin.read(item.filename)) for item in carried if item.filename != DESCRIPTIONS_MEMBER]
    except ARCHIVE_FAULTS as exc:
        raise engineconf.UnreadableArchiveError(zip_bytes) from exc
    if payload is None:
        return zip_bytes, None
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item, data in kept:
            zout.writestr(item, data)
    return out.getvalue(), payload


def snapshot_members(zip_bytes: bytes) -> dict[str, bytes]:
    """Every named preset snapshot in a ``/backup`` archive, keyed by preset name.

    Those are the ``data/cfgs/<name>.xml`` members. An archive declaring more than its ceilings raises
    ``ArchiveOverCeilingError`` before any member is read; one that will not list or decompress raises
    ``UnreadableArchiveError``.
    """
    members = list_members(zip_bytes)
    if not check_sizes(members).ok:
        raise ArchiveOverCeilingError()
    out: dict[str, bytes] = {}
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            for member in members:
                stem = engineconf.snapshot_name(member.filename)
                if stem is not None:
                    out[stem] = z.read(member)
    except ARCHIVE_FAULTS as exc:
        raise engineconf.UnreadableArchiveError(zip_bytes) from exc
    return out
