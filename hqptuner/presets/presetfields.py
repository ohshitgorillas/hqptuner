"""What the preset store owes a restore, answered to the caller that hands it down to the HTTP write lanes."""

from __future__ import annotations

from typing import TYPE_CHECKING

from hqptuner.conf import engineconf
from hqptuner.lanes.http.storecarry import StoreHooks
from hqptuner.presets import fileconfig
from hqptuner.presets.store.presets import canonical_name

if TYPE_CHECKING:
    from hqptuner.presets import PresetManager


def restore_hooks(mgr: PresetManager, *, saving: str | None = None) -> StoreHooks:
    """Return the hooks a staged restore calls into the store with.

    ``persist_backup`` writes each pass's fresh backup to disk before the push, ``parked_members`` are the parked
    filter uploads the archive carries, ``mirror`` maps the pass's intended working config to the ``data/cfgs``
    members ``preset_mirror`` answers for this restore, and ``file_config`` records each verify read through
    ``fileconfig.record_file_config``.
    """
    ops = mgr.presetops

    def mirror(intended_xml: bytes) -> dict[str, bytes]:
        return preset_mirror(mgr, intended_xml, saving=saving)

    def file_config(backup: bytes) -> dict[str, str]:
        return fileconfig.record_file_config(mgr, backup)

    return StoreHooks(
        file_config=file_config,
        persist_backup=ops.persist_backup_for_restore,
        parked_members=ops.parked_filter_members,
        mirror=mirror,
    )


def preset_mirror(
    mgr: PresetManager, intended_xml: bytes | None = None, *, saving: str | None = None
) -> dict[str, bytes]:
    """Return the ``data/cfgs`` members a restore carries: only the presets it loads or saves.

    The active preset's stored record goes under its member. When ``saving`` names a preset and the restore has an
    intended working config, that name's member carries the working config, since the save stores what this restore
    boots on. Every other stored preset is left out, so the daemon keeps the mirror it holds until that preset loads.
    """
    store = mgr.presetops.store
    active = store.active
    members = {}
    if active is not None and store.exists(active):
        members[engineconf.snapshot_member_name(active)] = store.read(active)
    if saving and intended_xml is not None:
        members[engineconf.snapshot_member_name(canonical_name(saving))] = intended_xml
    return members
