"""What a restore-shaped write owes the settings that never reach the config file.

Both readers here answer from the manager's cached engine state and the preset
store, never from the daemon. The engine and http lanes sit below the store, so
they never call these themselves: their caller hands the answers in, as
``restore_hooks`` for a staged restore and as plain values for an
engine-attribute restore.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass
from typing import TYPE_CHECKING

from hqptuner.conf import engineconf, presetconf, xmledit
from hqptuner.lanes.http.storecarry import StoreHooks
from hqptuner.lanes.live import overrides
from hqptuner.presets.store.presets import PresetError, canonical_name
from hqptuner.unwritable import StoreUnwritableError

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.presets import PresetManager


def _stored_live_fields(mgr: PresetManager) -> dict[str, str]:
    """Return the active preset's stored values for the live domain, or empty when there is no store to read."""
    name = mgr.presetops.store.active
    if not name or not mgr.presetops.store.exists(name):
        return {}
    stored = presetconf.read_config(mgr.presetops.store.read(name))
    return {field: value for field, value in stored.items() if field in overrides.LIVE_DOMAIN}


def carried_live_fields(mgr: PresetManager) -> dict[str, str]:
    """Return what a restore must carry for the settings a live edit never writes to the config file.

    Those settings are output mode, both chains' filters and shapers, adaptive
    volume, the per-family rate limits (``overrides.LIVE_DOMAIN``).

    hqplayerd boots from its config file and a live edit reaches only the running
    engine, so a restore-shaped write that carries nothing from here boots the
    daemon onto a file that never learned those settings.

    **The running engine is the authority, the store is the fallback.** A restore
    re-asserts the RUNNING configuration (``presetzip.restore_zip_from_running``),
    so what the user is hearing is what the restart has to come back on. The store
    answers only for what the engine cannot: a dormant chain it holds no
    enumeration for, or a daemon that has not reported ``State`` yet. Letting the
    store win instead strands the config file, because the surface that would
    correct it grounds on live truth (``api/configapi.config``) and so reads a
    re-selection of the running value as clean and stages nothing.

    Deliberately NOT gated on the auto-save flag: auto-save decides whether the
    store is UPDATED, never whether it is honoured.
    """
    return {**_stored_live_fields(mgr), **overrides.live_overrides(mgr)}


@dataclass(frozen=True)
class _MirroredPreset:
    """The preset a restore mirrors, and how the store takes that restore's own config for it.

    ``refolded``: the store is about to take it, from a save or an armed auto-save.
    ``saved``: it is a save's, which the store takes before the restore carries it.
    """

    name: str
    refolded: bool
    saved: bool


def _mirrored_preset(mgr: PresetManager, saving: str | None) -> _MirroredPreset | None:
    """Return the preset whose ``data/cfgs`` member a restore carries, or None when it carries none.

    A restore that is part of a save carries the preset being saved. Otherwise it
    carries the active preset once that has a store file, which auto-save, when
    armed, is about to refold from the config this restore lands. Nothing is
    active, or the active preset was never stored: None.
    """
    if saving:
        return _MirroredPreset(canonical_name(saving), refolded=True, saved=True)
    name = mgr.presetops.store.active
    if not name or not mgr.presetops.store.exists(name):
        return None
    return _MirroredPreset(name, refolded=mgr.presetops.store.autosave, saved=False)


def _refolded_config(mgr: PresetManager, mirrored: _MirroredPreset, intended_xml: bytes | None) -> bytes | None:
    """Return the config the store takes for ``mirrored`` from this restore, or None when it keeps what it has.

    ``intended_xml`` is the working config the restore lands; folded with the live
    overrides it is exactly what a save or an auto-save stores after the restore.
    None as well when there is no usable ``intended_xml`` (an engine-lane restore).
    """
    if not mirrored.refolded or intended_xml is None or xmledit.find_element(intended_xml, xmledit.ROOT) is None:
        return None
    return presetconf.apply_edits(intended_xml, overrides.live_overrides(mgr))


def _store_first(mgr: PresetManager, name: str, config: bytes) -> None:
    """Store ``config`` as the preset ``name`` a restore is about to mirror, ahead of the restore.

    A store that refuses keeps what it held, and the restore goes ahead carrying
    that, so the apply's edits still land; the save that follows the apply meets
    the same refusal and answers it with the save's own code.
    """
    with contextlib.suppress(StoreUnwritableError, PresetError):
        mgr.presetops.store.save(name, config, trigger="save")


def preset_mirror(
    mgr: PresetManager, intended_xml: bytes | None = None, *, saving: str | None = None
) -> dict[str, bytes]:
    """Return the ``data/cfgs`` member a restore carries, so hqplayerd's own profile list matches the store.

    Neither a save nor an auto-save restores, so the mirror rides the restores that
    happen anyway. ``saving`` names the preset this restore is being saved as: the
    store takes the refolded config under that name first and the restore carries
    the store file, so the daemon never lists a preset the store does not hold.
    When the store keeps what it has, the store file itself is the mirror. Empty
    when no preset is mirrored, or when there is neither a refolded config an
    auto-save is about to store nor a store file.
    """
    mirrored = _mirrored_preset(mgr, saving)
    if mirrored is None:
        return {}
    member = engineconf.snapshot_member_name(mirrored.name)
    refolded = _refolded_config(mgr, mirrored, intended_xml)
    if refolded is not None and not mirrored.saved:
        return {member: refolded}
    if refolded is not None:
        _store_first(mgr, mirrored.name, refolded)
    if not mgr.presetops.store.exists(mirrored.name):
        return {}
    return {member: mgr.presetops.store.read(mirrored.name)}


def restore_hooks(mgr: PresetManager, *, saving: str | None = None) -> StoreHooks:
    """Return what a staged restore owes the preset store, bound to ``mgr``.

    ``saving`` names the preset the restore's apply is being saved as, whose mirror
    the restore then carries in place of the active preset's. Each hook reads the
    store when the restore calls it, so every pass sees the store as it stands at
    that pass.
    """
    return StoreHooks(
        carried=lambda: carried_live_fields(mgr),
        persist_backup=mgr.presetops.persist_backup_for_restore,
        parked_members=mgr.presetops.parked_filter_members,
        mirror=lambda intended_xml: preset_mirror(mgr, intended_xml, saving=saving),
    )
