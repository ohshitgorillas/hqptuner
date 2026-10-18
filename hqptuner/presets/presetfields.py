"""What the preset store owes a restore."""

from __future__ import annotations

from typing import TYPE_CHECKING

from hqptuner.lanes.http.storecarry import StoreHooks

if TYPE_CHECKING:
    from hqptuner.lanes import LaneManager


def restore_hooks(mgr: LaneManager, *, saving: str | None) -> StoreHooks:
    """Return the hooks a staged restore calls into the store with."""
    del mgr, saving
    return StoreHooks(
        carried=dict,
        persist_backup=lambda _backup: None,
        parked_members=dict,
        mirror=lambda _backup: {},
    )


def preset_mirror(mgr: LaneManager) -> dict[str, bytes]:
    """Return the ``data/cfgs`` members the store mirrors."""
    del mgr
    return {}


def carried_live_fields(mgr: LaneManager) -> dict[str, str]:
    """Return the live-domain values a restart has to come back on."""
    del mgr
    return {}
