"""Engine-attribute editing for the ``<engine>`` element of hqplayerd config XML.

Also holds the archive-level helpers every config lane shares.

The hardware-acceleration settings (``cuda``, ``multicore``, ``ecores``,
``nblocks``) are not on the ``/config`` form and have no Control API setter — the
only lane is the config file itself (manual §1.2). HQPTuner reaches them by
editing a ``/backup`` archive and pushing it back through ``POST /restore``,
which the daemon re-reads on its self-restart (grounded on 6.0.4).

The edit is **surgical**: only the named attributes on the ``<engine>`` tag are
touched, by string substitution, so every other setting the UI does not
expose (matrix pipelines, convolution, inputs, presets) survives byte-faithful.
A full re-serialize (lxml/ElementTree) would reorder attributes and drop
formatting — never do that to a live production config.

``rewrite_zip`` and the ``data/cfgs`` naming live here too, since every lane that
edits an archive needs them and ``presetconf`` already builds on this module.
"""

from __future__ import annotations

import dataclasses
import io
import re
import zipfile

from hqptuner.conf.xmledit import GroundingError

# Attribute → allowed value domain (manual §1.2). ``nblocks`` is an integer
# (0 = default, else 1..N); its bound is validated by the caller/UI, not here.
ENGINE_DOMAINS: dict[str, tuple[str, ...]] = {
    "cuda": ("0", "1", "convolution"),
    "multicore": ("auto", "0", "1"),
    "ecores": ("default", "pool", "filter"),
}

# Integer-valued engine attributes (validated as ints, not against a value set).
# ``nblocks``: 0 = auto from CPU cache, else blocks per cycle.
# ``cuda_dev`` / ``cuda_cdev``: CUDA device ids for general DSP and for
# convolution respectively; -1 = automatic selection (readme §1.2). Setting them
# to different GPUs splits the workload across two cards (manual §4.7).
ENGINE_INTS: tuple[str, ...] = ("nblocks", "cuda_dev", "cuda_cdev")

_ENGINE_TAG = re.compile(rb"<engine\b[^>]*>")

# Where the daemon keeps its named preset snapshots inside a /backup archive.
_CFGS_PREFIX = "data/cfgs/"
_CFGS_SUFFIX = ".xml"
_MEMBERS_SHOWN = 12  # archive members named in a failure log line before the rest are counted


def snapshot_member_name(preset: str) -> str:
    """Name the archive member holding preset ``preset``'s snapshot."""
    return f"{_CFGS_PREFIX}{preset}{_CFGS_SUFFIX}"


def snapshot_name(member: str) -> str | None:
    """Return the preset name an archive member holds, or None when it is not a preset snapshot at all.

    One spelling of the ``data/cfgs/<name>.xml`` convention, so the walkers
    cannot disagree about what counts as a snapshot.
    """
    if not (member.startswith(_CFGS_PREFIX) and member.endswith(_CFGS_SUFFIX)):
        return None
    return member[len(_CFGS_PREFIX) : -len(_CFGS_SUFFIX)] or None


def rewrite_zip(zip_bytes: bytes, substitutions: dict[str, bytes]) -> bytes:
    """Return a copy of ``zip_bytes`` with each named member replaced by the given bytes.

    Every other member is copied byte-for-byte, keeping its original ``ZipInfo``
    so nothing about the untouched archive shifts. A substitution naming a member
    the archive does not have is APPENDED — which is how an uploaded filter file,
    a mirrored preset snapshot, or an ``hqplayerd.xml`` missing from a
    preset-active backup gets into the restore.
    """
    out = io.BytesIO()
    seen: set[str] = set()
    with (
        zipfile.ZipFile(io.BytesIO(zip_bytes)) as zin,
        zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout,
    ):
        for item in zin.infolist():
            replacement = substitutions.get(item.filename)
            zout.writestr(item, zin.read(item.filename) if replacement is None else replacement)
            seen.add(item.filename)
        for name, data in substitutions.items():
            if name not in seen:
                zout.writestr(name, data)
    return out.getvalue()


def read_engine_attrs(xml: bytes) -> dict[str, str]:
    """Read the current values of the editable engine attributes present on the ``<engine>`` tag.

    Absent attributes are omitted (daemon default applies).
    """
    m = _ENGINE_TAG.search(xml)
    if not m:
        return {}
    tag = m.group(0)
    out: dict[str, str] = {}
    for attr in (*ENGINE_DOMAINS, *ENGINE_INTS):
        am = re.search(rb"\b" + attr.encode() + rb'="([^"]*)"', tag)
        if am:
            out[attr] = am.group(1).decode()
    return out


class NoEngineElementError(ValueError):
    """The config XML handed in carries no ``<engine>`` element to edit."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("no <engine> element in config XML")


def set_engine_attrs(xml: bytes, overrides: dict[str, str]) -> bytes:
    """Return ``xml`` with each override applied to the ``<engine>`` tag.

    The value is replaced in place when the attribute exists, inserted when it
    does not. Nothing else in the document changes.
    """
    m = _ENGINE_TAG.search(xml)
    if not m:
        raise NoEngineElementError()
    tag = m.group(0)
    for attr, value in overrides.items():
        pat = re.compile(rb"\b" + attr.encode() + rb'="[^"]*"')
        tag = _replace_or_insert(tag, pat, f'{attr}="{value}"'.encode())
    return xml[: m.start()] + tag + xml[m.end() :]


def _replace_or_insert(tag: bytes, pat: re.Pattern[bytes], attribute: bytes) -> bytes:
    r"""Set one ``attr="value"`` on the ``<engine>`` tag.

    Replace in place when the attribute is present, else insert it right after
    ``<engine`` (7 chars).

    The replacement is a function, never the bytes directly — ``re.sub`` reads
    escapes (``\1``, ``\g<n>``, ``\\``) out of a template string. Engine values
    are domain-validated today, but that guarantee belongs at the substitution
    rather than upstream of it (see ``presetconf._set_attr``).
    """
    if pat.search(tag):
        return pat.sub(lambda _: attribute, tag, count=1)
    return tag[:7] + b" " + attribute + tag[7:]


def running_config_name(names: list[str], active: str | None = None) -> str | None:
    """Name the archive member that holds the live working config.

    Normally ``hqplayerd.xml``. But when a named profile is the active one, the daemon
    writes the live config to a root-level ``<Profile>.xml`` and omits
    ``hqplayerd.xml`` entirely: a ``/backup`` taken with ``Speakers`` active has
    ``Speakers.xml`` at the root and no ``hqplayerd.xml``.

    ``active`` is the DAEMON's active-profile label (``ConfigurationGet``, kept on
    the manager as ``active_config``) — the daemon names that member after its own
    active profile, so the label resolves it outright. Without it the resolver can
    only take a sole root-level ``.xml``, and an archive carrying more than one
    read as "no working config at all": every apply refused, permanently, with a
    message blaming a daemon bug that a restart does not clear.

    Returns ``None`` only when nothing here identifies a member — an archive that
    genuinely has no working config, which is the daemon's empty-backup bug.
    """
    if "hqplayerd.xml" in names:
        return "hqplayerd.xml"
    roots = [n for n in names if "/" not in n and n.endswith(".xml")]
    if len(roots) == 1:
        return roots[0]
    named = f"{active}.xml" if active else None
    return named if named in roots else None


@dataclasses.dataclass(frozen=True)
class ArchiveSummary:
    """What a ``/backup`` archive turned out to hold, and the sentence that says so.

    The sentence reaches a log line and a user-facing ``GroundingError``, so it
    is rewordable; the fields are not. A caller deciding anything reads
    ``readable`` and ``members``, and only formatting reads ``str()``.
    """

    size: int
    readable: bool
    members: tuple[str, ...] = ()

    def __str__(self) -> str:
        """Render the summary as the log line and error message read it."""
        if not self.readable:
            return f"{self.size} bytes, not a readable zip"
        shown = ", ".join(self.members[:_MEMBERS_SHOWN]) + (
            f", … (+{len(self.members) - _MEMBERS_SHOWN} more)" if len(self.members) > _MEMBERS_SHOWN else ""
        )
        return f"{self.size} bytes, {len(self.members)} members: {shown}"


class UnreadableArchiveError(GroundingError):
    """Bytes handed in as a ``/backup`` archive that are not a readable zip.

    A different fact from a readable archive with no working config, which the
    readers answer as empty. The message is the archive's summary, so it names
    the size of what arrived.
    """

    def __init__(self, zip_bytes: bytes) -> None:
        """Describe ``zip_bytes`` as unreadable, under the code ``archive_unreadable``."""
        super().__init__(str(ArchiveSummary(size=len(zip_bytes), readable=False)), code="archive_unreadable")


def archive_summary(zip_bytes: bytes) -> ArchiveSummary:
    """Summarize what a ``/backup`` archive actually contains, for the log line when we refuse it.

    Two very different faults present identically as "no working
    config" — the daemon's post-profile-load bug serves a bare ``data/`` entry,
    while an archive we simply cannot resolve a working member in is full of
    files. The member list tells them apart at a glance, and nothing else does.
    This runs on the failure path, where the bytes may not be a zip at all, so
    it classifies them before opening anything.
    """
    if not zipfile.is_zipfile(io.BytesIO(zip_bytes)):
        return ArchiveSummary(size=len(zip_bytes), readable=False)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        return ArchiveSummary(size=len(zip_bytes), readable=True, members=tuple(z.namelist()))


def _member_names(zip_bytes: bytes) -> list[str]:
    """Every member name in the archive; raises ``UnreadableArchiveError`` when the bytes are not a zip."""
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            names = z.namelist()
    except (zipfile.BadZipFile, OSError) as exc:
        raise UnreadableArchiveError(zip_bytes) from exc
    return names


def working_member_name(zip_bytes: bytes, active: str | None = None) -> str | None:
    """Which member ``base_config_xml`` reads.

    For a caller that has to write the working config back rather than only read
    it. None when no member resolves; raises ``UnreadableArchiveError`` on bytes that
    are not a zip.
    """
    return running_config_name(_member_names(zip_bytes), active)


def with_boot_member(zip_bytes: bytes, active: str | None = None) -> bytes:
    """Return ``zip_bytes`` with its working config also carried as ``hqplayerd.xml``, the member a restore boots.

    A restore lands the daemon on ``[default]`` and discards an edit to a root
    ``<Profile>.xml`` (docs/spec/protocol.md §3.6), so an archive built while a named
    profile is active has to write its edits where the restart reads them. An
    archive that already has ``hqplayerd.xml``, or has no working config, is
    returned unchanged.
    """
    member = working_member_name(zip_bytes, active)
    if member is None or member == "hqplayerd.xml":
        return zip_bytes
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        return rewrite_zip(zip_bytes, {"hqplayerd.xml": z.read(member)})


def base_config_xml(zip_bytes: bytes, active: str | None = None) -> bytes:
    """Read the working-config member of a ``/backup`` archive — the config the running engine reflects.

    That member is ``hqplayerd.xml``, or the root ``<Profile>.xml`` when a named
    preset is active. Empty if neither is present. Pass the daemon's
    active-profile label wherever it is known — it is what resolves an archive
    carrying several root-level XMLs.

    Bytes that are not a readable archive raise ``UnreadableArchiveError``: a
    restarting daemon serves an error page here, and the caller that knows what
    proceeding without a config means decides whether to fall back or refuse.
    """
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            name = running_config_name(z.namelist(), active)
            xml = z.read(name) if name else b""
    except (zipfile.BadZipFile, OSError) as exc:
        raise UnreadableArchiveError(zip_bytes) from exc
    return xml


def config_members(zip_bytes: bytes, active_snapshot: str | None, *, all_presets: bool) -> list[str]:
    """Which XML members of a ``/backup`` archive carry an ``<engine>`` to edit.

    Always the running-config member (``hqplayerd.xml``, or the root
    ``<Profile>.xml`` when a named preset is active). Plus every preset snapshot
    when ``all_presets`` is set, or just the active preset's snapshot otherwise.

    Raises ``UnreadableArchiveError`` on bytes that are not a zip, so an empty list
    always means a readable archive with nothing to edit.
    """
    names = _member_names(zip_bytes)
    base = [n for n in [running_config_name(names, active_snapshot)] if n]
    snaps = [n for n in names if snapshot_name(n) is not None]
    if all_presets:
        return base + snaps
    active = [n for n in snaps if active_snapshot and n == snapshot_member_name(active_snapshot)]
    return base + active


def edit_config_zip(zip_bytes: bytes, members: list[str], overrides: dict[str, str]) -> bytes:
    """Return a copy of ``zip_bytes`` with ``overrides`` applied to each member in ``members``.

    The overrides land on each member's ``<engine>`` tag; all other entries are
    copied byte-for-byte.
    """
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zin:
        present = set(zin.namelist())
        edited = {name: set_engine_attrs(zin.read(name), overrides) for name in members if name in present}
    return rewrite_zip(zip_bytes, edited)


class NotAnIntegerAttributeError(ValueError):
    """A value staged for an integer-valued engine attribute does not parse as one."""

    def __init__(self, *, attr: str, value: str) -> None:
        """Render the wording naming the attribute and the non-integer value it was given."""
        super().__init__(f"{attr} must be an integer, got {value!r}")


class NotAnEditableAttributeError(ValueError):
    """A staged attribute name is not one HQPTuner knows how to edit on the ``<engine>`` tag."""

    def __init__(self, *, attr: str) -> None:
        """Render the wording naming the attribute HQPTuner does not edit."""
        super().__init__(f"not an editable engine attribute: {attr!r}")


class AttributeValueNotInDomainError(ValueError):
    """A staged value for an editable attribute falls outside that attribute's allowed domain."""

    def __init__(self, *, attr: str, value: str) -> None:
        """Render the wording naming the attribute, the rejected value, and the domain it must fall in."""
        super().__init__(f"{attr}={value!r} not in {ENGINE_DOMAINS[attr]}")


def _validate_one(attr: str, value: str) -> None:
    if attr in ENGINE_INTS:
        if not value.lstrip("-").isdigit():
            raise NotAnIntegerAttributeError(attr=attr, value=value)
        return
    if attr not in ENGINE_DOMAINS:
        raise NotAnEditableAttributeError(attr=attr)
    if value not in ENGINE_DOMAINS[attr]:
        raise AttributeValueNotInDomainError(attr=attr, value=value)


def validate_overrides(overrides: dict[str, str]) -> None:
    """Reject any attribute not editable, or any value outside its domain."""
    for attr, value in overrides.items():
        _validate_one(attr, value)
