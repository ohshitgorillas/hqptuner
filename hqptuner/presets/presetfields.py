"""What the preset store owes a restore, answered to the caller that hands it down to the HTTP write lanes."""

from __future__ import annotations

from typing import TYPE_CHECKING

from hqptuner.conf import engineconf
from hqptuner.lanes.http.storecarry import StoreHooks
from hqptuner.presets.store.presets import canonical_name

if TYPE_CHECKING:
    from hqptuner.presets import PresetManager


def restore_hooks(mgr: PresetManager, *, saving: str | None) -> StoreHooks:
    """Return the hooks a staged restore calls into the store with.

    ``persist_backup`` writes each pass's fresh backup to disk before the push, ``parked_members`` are the parked
    filter uploads the archive carries, and ``mirror`` maps the pass's intended working config to the ``data/cfgs``
    members that bring hqplayerd's own profile list up to the store. When ``saving`` names a preset, that name's
    member carries the intended working config, since the save stores what this restore boots on.
    """
    ops = mgr.presetops

    def mirror(intended_xml: bytes) -> dict[str, bytes]:
        return restore_mirror(preset_mirror(mgr), saving, intended_xml)

    return StoreHooks(
        carried=_nothing_carried,
        persist_backup=ops.persist_backup_for_restore,
        parked_members=ops.parked_filter_members,
        mirror=mirror,
    )


def _nothing_carried() -> dict[str, str]:
    """Return no live-domain values: a store-as-fallback carrier that is leaving with its callers."""
    return {}


def restore_mirror(stored: dict[str, bytes], saving: str | None, intended_xml: bytes) -> dict[str, bytes]:
    """Return the stored-record mirror, with the preset being saved carrying the intended working config."""
    if not saving:
        return stored
    return {**stored, engineconf.snapshot_member_name(canonical_name(saving)): intended_xml}


def preset_mirror(mgr: PresetManager) -> dict[str, bytes]:
    """Return every stored preset's record under its ``data/cfgs`` member."""
    store = mgr.presetops.store
    return {engineconf.snapshot_member_name(name): store.read(name) for name in store.names()}


def carried_live_fields(mgr: PresetManager) -> dict[str, str]:
    """Return no live-domain values: a store-as-fallback carrier that is leaving with its callers."""
    del mgr
    return {}
