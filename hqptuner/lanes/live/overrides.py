"""Live state expressed back as config-form fields — the save side of ``routing``.

A live-routed edit never touched the config file, so the file is stale the moment
one lands. Saving a preset off that file would store settings the user is not
hearing, so ``presetlane.save`` folds these overrides into the working XML first,
and ``GET /api/config`` overlays them so every tab reads what is playing rather
than what was last written to disk.

The translation is the mirror of ``routing``'s apply side: State's list index ->
the enumeration item at that index -> its enum ID, which is what the file holds.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from hqptuner.lanes.live.chain import EnumItems, active_chain
from hqptuner.lanes.live.routing import DIRECT, ROUTABLE, mode_form_value

if TYPE_CHECKING:
    from hqptuner.lanes import LaneManager

# Every config field a live edit reaches that a restore carries from the Engine, since
# a live edit never writes the config file hqplayerd boots from. The rate pin is not
# among them: the File's own rate limits are what a restore boots on
# (``presets/realized.realized_config``).
LIVE_DOMAIN = frozenset({*ROUTABLE, *DIRECT})


def _enum_id_for_index(items: EnumItems, index: str) -> str | None:
    """Return the enum ID of the item at this list index (the index→ID join)."""
    for item in items:
        if str(item.get("index")) == str(index):
            value = item.get("value")
            return None if value is None else str(value)
    return None


def _override_for(mgr: LaneManager, field: str, state: dict[str, str]) -> str | None:
    """One field's current live value in config-form terms, or None when the engine cannot answer for it."""
    spec = ROUTABLE[field]
    index = state.get(spec.state)
    if index is None:
        return None
    items = (mgr.readings.enums or {}).get(spec.enum) or []
    return mode_form_value(items, index) if field == "mode" else _enum_id_for_index(items, index)


def _chain_overrides(mgr: LaneManager, chain: str | None, state: dict[str, str]) -> dict[str, str]:
    """Both chains' filter/shaper settings.

    The engine's own reading for the chain it is running, LIVE's memory for the chain it is not.
    """
    overrides = {}
    for field, spec in ROUTABLE.items():
        if spec.chain is None or spec.chain == chain:
            value = _override_for(mgr, field, state)
            if value is not None:
                overrides[field] = value
    for other, remembered in mgr.readings.live.chain.items():
        if other != chain:
            overrides.update(remembered)
    return overrides


def live_overrides(mgr: LaneManager) -> dict[str, str]:
    """Return the engine's current live settings as config-form fields.

    So a save captures what is actually playing rather than a stale file.

    The engine answers for the ACTIVE chain only — State reports one
    filter/shaper pair — so the dormant chain is reported from ``mgr.readings.live.chain``
    instead, which is what LIVE set on it and what ``lane`` puts back when it
    loads. Reading the engine's pair for both chains would be the one thing that
    is never right: the two chains number their enum IDs differently, so it would
    overwrite the dormant chain's settings with a translation of the other one's.
    """
    state = mgr.readings.state or {}
    # No rate override: the rate lives in the limit slot, which is a config field
    # written persistently, so the file already carries it (``chain.RATE_LIMIT_FIELD``).
    return {
        **_chain_overrides(mgr, active_chain(mgr), state),
        **{field: state[attr] for field, attr in DIRECT.items() if state.get(attr) is not None},
    }
