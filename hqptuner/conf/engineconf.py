"""Engine-attribute editing for the ``<engine>`` element of hqplayerd config XML.

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
"""

from __future__ import annotations

import io
import re
import zipfile

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


def read_engine_attrs(xml: bytes) -> dict[str, str]:
    """The current values of the editable engine attributes present on the
    ``<engine>`` tag. Absent attributes are omitted (daemon default applies)."""
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


def set_engine_attrs(xml: bytes, overrides: dict[str, str]) -> bytes:
    """Return ``xml`` with each override applied to the ``<engine>`` tag —
    replacing the value in place when the attribute exists, inserting it when it
    does not. Nothing else in the document changes."""
    m = _ENGINE_TAG.search(xml)
    if not m:
        raise ValueError("no <engine> element in config XML")
    tag = m.group(0)
    for attr, value in overrides.items():
        av = f'{attr}="{value}"'.encode()
        pat = re.compile(rb"\b" + attr.encode() + rb'="[^"]*"')
        # replace in place when present; else insert right after "<engine" (7 chars)
        tag = pat.sub(av, tag, count=1) if pat.search(tag) else tag[:7] + b" " + av + tag[7:]
    return xml[: m.start()] + tag + xml[m.end() :]


def running_config_name(names: list[str]) -> str | None:
    """The archive member that holds the live working config. Normally
    ``hqplayerd.xml``. But when a named profile is the active one, the daemon
    writes the live config to a root-level ``<Profile>.xml`` and omits
    ``hqplayerd.xml`` entirely (observed on 6.0.4: a preset-active ``/backup`` has
    ``Speakers.xml`` at the root, no ``hqplayerd.xml``). Returns that member, or
    ``None`` when neither an ``hqplayerd.xml`` nor a single unambiguous root-level
    ``.xml`` is present."""
    if "hqplayerd.xml" in names:
        return "hqplayerd.xml"
    roots = [n for n in names if "/" not in n and n.endswith(".xml")]
    return roots[0] if len(roots) == 1 else None


def base_config_xml(zip_bytes: bytes) -> bytes:
    """The working-config member of a ``/backup`` archive (the config the running
    engine reflects): ``hqplayerd.xml``, or the root ``<Profile>.xml`` when a
    named preset is active. Empty if neither is present."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        name = running_config_name(z.namelist())
        if name:
            return z.read(name)
    return b""


def config_members(zip_bytes: bytes, active_snapshot: str | None, all_presets: bool) -> list[str]:
    """Which XML members of a ``/backup`` archive carry an ``<engine>`` to edit.

    Always the running-config member (``hqplayerd.xml``, or the root
    ``<Profile>.xml`` when a named preset is active). Plus every preset snapshot
    when ``all_presets`` is set, or just the active preset's snapshot otherwise."""
    names = zipfile.ZipFile(io.BytesIO(zip_bytes)).namelist()
    base = [n for n in [running_config_name(names)] if n]
    snaps = [n for n in names if n.startswith("data/cfgs/") and n.endswith(".xml")]
    if all_presets:
        return base + snaps
    active = [n for n in snaps if active_snapshot and n == f"data/cfgs/{active_snapshot}.xml"]
    return base + active


def edit_config_zip(zip_bytes: bytes, members: list[str], overrides: dict[str, str]) -> bytes:
    """A copy of ``zip_bytes`` with ``overrides`` applied to the ``<engine>`` tag
    of each member in ``members``; all other entries copied byte-for-byte."""
    target = set(members)
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            raw = zin.read(item.filename)
            if item.filename in target:
                raw = set_engine_attrs(raw, overrides)
            zout.writestr(item, raw)
    return out.getvalue()


def _validate_one(attr: str, value: str) -> None:
    if attr in ENGINE_INTS:
        if not value.lstrip("-").isdigit():
            raise ValueError(f"{attr} must be an integer, got {value!r}")
        return
    if attr not in ENGINE_DOMAINS:
        raise ValueError(f"not an editable engine attribute: {attr!r}")
    if value not in ENGINE_DOMAINS[attr]:
        raise ValueError(f"{attr}={value!r} not in {ENGINE_DOMAINS[attr]}")


def validate_overrides(overrides: dict[str, str]) -> None:
    """Reject any attribute not editable, or any value outside its domain."""
    for attr, value in overrides.items():
        _validate_one(attr, value)
