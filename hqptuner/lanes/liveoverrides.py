"""Live state expressed back as config-form fields — the save side of ``livemap``.

A live-routed edit never touched the config file, so the file is stale the moment
one lands. Saving a preset off that file would store settings the user is not
hearing, so ``presetlane.save`` folds these overrides into the working XML first,
and ``GET /api/config`` overlays them so every tab reads what is playing rather
than what was last written to disk.

The translation is the mirror of ``livemap``'s apply side: State's list index ->
the enumeration item at that index -> its enum ID, which is what the file holds.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from hqptuner.lanes.livechain import PCM, SDM, EnumItems, active_chain, rate_family
from hqptuner.lanes.livemap import DIRECT, ROUTABLE, mode_form_value

if TYPE_CHECKING:
    from hqptuner.core.manager import ConnectionManager

# Where a live rate lands on the config side. `SetRate` writes an exact rate, the
# config form's rate menu writes the per-family LIMIT, and the two agree in the
# only terms the menu speaks: the tier. A pinned DSD256 becomes a DSD256 limit,
# which the engine then selects in the source's own base family — the same output,
# and the only form a config write may take (probe-verified on 6.0.4: a config rate
# slot cannot pick a base family, so writing one would send 44.1k material out at
# a 48k base rate behind the user's `any_dsd` setting).
_RATE_LIMIT_FIELD = {PCM: "defaults_samplerate", SDM: "defaults_bitrate"}
_BASE_44K = 44100
_BASE_48K = 48000

# Every config field a live edit can reach — which is exactly the set the config
# file cannot learn on its own, since a live edit never writes it. hqplayerd boots
# from that file, so a restore-shaped write has to carry these from somewhere else
# or the daemon comes back without them (``presetlane.stored_live_fields``).
LIVE_DOMAIN = frozenset({*ROUTABLE, *DIRECT, *_RATE_LIMIT_FIELD.values()})


def _enum_id_for_index(items: EnumItems, index: str) -> str | None:
    """The enum ID of the item at this list index (the index→ID join)."""
    for item in items:
        if str(item.get("index")) == str(index):
            value = item.get("value")
            return None if value is None else str(value)
    return None


def _override_for(mgr: ConnectionManager, field: str, state: dict[str, str]) -> str | None:
    """One field's current live value in config-form terms, or None when the
    engine cannot answer for it.
    """
    spec = ROUTABLE[field]
    index = state.get(spec.state)
    if index is None:
        return None
    items = (mgr.enums or {}).get(spec.enum) or []
    return mode_form_value(items, index) if field == "mode" else _enum_id_for_index(items, index)


def _tier_rate(hz: str) -> str:
    """A rate as the 48k-base member of its tier — what the rate menus carry.

    Every tier is n x 44100 or n x 48000 for the same n, so the 44.1k member
    converts exactly and anything else is already the 48k one.
    """
    value = int(hz)
    return str(value // _BASE_44K * _BASE_48K) if value % _BASE_44K == 0 else hz


def _pinned_rate(mgr: ConnectionManager, state: dict[str, str]) -> str | None:
    """The rate in Hz the engine is pinned to right now, or None when it has none.

    None when the engine has no pin of its own (``rate="0"``): the configured
    limit is then already what it is following, so there is nothing to override.
    """
    index = state.get("rate")
    if index is None:
        return None
    items = (mgr.enums or {}).get("rates") or []
    hz = next((item.get("rate") for item in items if str(item.get("index")) == str(index)), None)
    return None if hz is None or hz == "0" else hz


def _rate_overrides(mgr: ConnectionManager, state: dict[str, str]) -> dict[str, str]:
    """Both families' live rates as config limit fields.

    ``State`` carries one ``rate``, and ``SetMode`` clears the pin outright
    (probe-verified on 6.0.4, ``scripts/probes/probe_mode_rate_pin.py``), so the engine can
    only ever answer for the family it is running and only until the next mode
    switch. ``mgr.live.rates`` is what LIVE pinned per family, which ``livelane``
    puts back on the engine when that family comes round again — so reporting both
    here says what the engine is set to rather than what it happens to report.

    The engine still wins for the family it is running: a pin set from somewhere
    other than LIVE is real, and this remembers only what LIVE itself wrote.
    """
    rates = dict(mgr.live.rates)
    pinned = _pinned_rate(mgr, state)
    if pinned is not None:
        rates[rate_family(pinned)] = pinned
    return {_RATE_LIMIT_FIELD[family]: _tier_rate(hz) for family, hz in rates.items()}


def _chain_overrides(mgr: ConnectionManager, chain: str | None, state: dict[str, str]) -> dict[str, str]:
    """Both chains' filter/shaper settings: the engine's own reading for the chain
    it is running, LIVE's memory for the chain it is not.
    """
    overrides = {}
    for field, spec in ROUTABLE.items():
        if spec.chain is None or spec.chain == chain:
            value = _override_for(mgr, field, state)
            if value is not None:
                overrides[field] = value
    for other, remembered in mgr.live.chain.items():
        if other != chain:
            overrides.update(remembered)
    return overrides


def live_overrides(mgr: ConnectionManager) -> dict[str, str]:
    """The engine's current live settings as config-form fields, so a save
    captures what is actually playing rather than a stale file.

    The engine answers for the ACTIVE chain only — State reports one
    filter/shaper pair — so the dormant chain is reported from ``mgr.live.chain``
    instead, which is what LIVE set on it and what ``livelane`` puts back when it
    loads. Reading the engine's pair for both chains would be the one thing that
    is never right: the two chains number their enum IDs differently, so it would
    overwrite the dormant chain's settings with a translation of the other one's.
    """
    state = mgr.state or {}
    # Rate is not chain-gated the way the filter/shaper pair is: the two families'
    # limits are separate fields, so carrying both overwrites neither.
    return {
        **_chain_overrides(mgr, active_chain(mgr), state),
        **{field: state[attr] for field, attr in DIRECT.items() if state.get(attr) is not None},
        **_rate_overrides(mgr, state),
    }
