"""Live routing for config-form fields the Control API can set directly.

The persistent lane (``httplane``) writes the config XML and pushes it with
``POST /restore``, on which the daemon self-restarts (~5.6 s). Seven of its
fields have exact Control API equivalents that apply instantly with no restart,
so ``manager.apply`` peels those off and hands them to ``writer.apply_live``
instead. Only what is left goes to the restore lane — and when nothing is left,
the daemon is never restarted at all.

**Domain translation.** The config form (and ``hqplayerd.xml``) carry the numeric
enumeration ID; ``Set*`` commands take the LIST INDEX — "the two domains must
never be mixed" (protocol.md §4). The live enumeration items carry both ``value``
(enum ID) and ``index``, so the join is a lookup, never a computation.

**Chain gating.** ``GetFilters``/``GetShapers`` enumerate only the ACTIVE mode's
chain, and the two chains number their enum IDs differently (readme: "Million tap
sinc-filter" is 25 under ``filter``, 23 under ``oversampling``). So a PCM field is
routable only while the engine is in PCM, an SDM field only in SDM. In
``[source]`` mode the engine follows the source and neither chain is knowably the
live one, so filters and shapers stay on the restore lane.

Every fallback in here is toward the restore lane, which is always correct and
only slower. A field routes live only when the whole translation succeeds.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, NamedTuple

if TYPE_CHECKING:
    from ..manager import ConnectionManager

PCM = "pcm"
SDM = "sdm"

EnumItems = list[dict[str, str]]


class LiveField(NamedTuple):
    """How one config-form field maps onto a Control API setter."""

    setting: str  # writer.py handler key
    arg: str  # setter attribute ('value' | 'value1x')
    enum: str  # manager.enums key to translate through
    chain: str | None  # chain the field belongs to; None = chain-independent
    state: str  # State attribute carrying this setting's current list index


# The seven form fields with an exact live equivalent. Deliberately NOT here:
# defaults_samplerate / defaults_bitrate. Those are a per-family *ceiling* under
# forced auto-family (httplane.FORCED_CONFIG), while SetRate forces a fixed
# output rate — different settings, and equating them would break auto-family.
ROUTABLE: dict[str, LiveField] = {
    "filter1x": LiveField("filter", "value1x", "filters", PCM, "filter1x"),
    "filter": LiveField("filter", "value", "filters", PCM, "filterNx"),
    "dither": LiveField("shaper", "value", "shapers", PCM, "shaper"),
    "oversampling1x": LiveField("filter", "value1x", "filters", SDM, "filter1x"),
    "oversampling": LiveField("filter", "value", "filters", SDM, "filterNx"),
    "modulator": LiveField("shaper", "value", "shapers", SDM, "shaper"),
    "mode": LiveField("mode", "value", "modes", None, "mode"),
}

# config form `mode` values -> the ModesItem name to match. Matched by NAME, not
# by a hardcoded index: the modes enum is device-dependent (it drops SDM when the
# active device can't do DSD), so positions are not stable.
_MODE_NAMES = {"auto": "[source]", "pcm": "PCM", "sdm": "SDM"}


# --- save side: live state expressed back as config-form fields ---------------
# A live-routed edit never touched the config file, so the file is stale the
# moment one lands. Saving a preset off that file would store settings the user
# is not hearing, so `presetlane.save` folds these overrides into the working XML
# first. The translation is the mirror of the apply side: State's list index ->
# the enumeration item at that index -> its enum ID, which is what the file holds.


def _enum_id_for_index(items: EnumItems, index: str) -> str | None:
    """The enum ID of the item at this list index (the index→ID join)."""
    for item in items:
        if str(item.get("index")) == str(index):
            value = item.get("value")
            return None if value is None else str(value)
    return None


def _mode_form_value(items: EnumItems, index: str) -> str | None:
    """The config-form mode value (auto|pcm|sdm) for a ModesItem index."""
    for item in items:
        if str(item.get("index")) != str(index):
            continue
        name = (item.get("name") or "").upper()
        return next((form for form, want in _MODE_NAMES.items() if name.startswith(want.upper())), None)
    return None


def _override_for(mgr: ConnectionManager, field: str, state: dict[str, str]) -> str | None:
    """One field's current live value in config-form terms, or None when the
    engine cannot answer for it."""
    spec = ROUTABLE[field]
    index = state.get(spec.state)
    if index is None:
        return None
    items = (mgr.enums or {}).get(spec.enum) or []
    return _mode_form_value(items, index) if field == "mode" else _enum_id_for_index(items, index)


def live_overrides(mgr: ConnectionManager) -> dict[str, str]:
    """The engine's current live settings as config-form fields, so a save
    captures what is actually playing rather than a stale file.

    Only the ACTIVE chain is included: State reports one filter/shaper pair, and
    attributing it to the dormant chain would overwrite that chain's saved
    settings with the other one's."""
    chain = active_chain(mgr)
    state = mgr.state or {}
    overrides = {}
    for field, spec in ROUTABLE.items():
        if spec.chain is not None and spec.chain != chain:
            continue
        value = _override_for(mgr, field, state)
        if value is not None:
            overrides[field] = value
    return overrides


def _chain_name(name: str) -> str | None:
    """The chain a mode name denotes, or None for ``[source]``/anything unknown."""
    upper = (name or "").upper()
    if upper.startswith("PCM"):
        return PCM
    return SDM if upper.startswith(("SDM", "DSD")) else None


def _chain_from_state(mgr: ConnectionManager) -> str | None:
    """The CONFIGURED mode's chain — decisive when it is pcm or sdm, None in auto."""
    index = (mgr.state or {}).get("mode")
    if index is None:
        return None
    for item in (mgr.enums or {}).get("modes", []):
        if str(item.get("index")) == str(index):
            return _chain_name(item.get("name") or "")
    return None


def _chain_from_status(mgr: ConnectionManager) -> str | None:
    """The chain the engine is running RIGHT NOW, per ``Status.active_mode``."""
    return _chain_name((mgr.status or {}).get("active_mode") or "")


def active_chain(mgr: ConnectionManager) -> str | None:
    """Which filter/shaper chain the engine currently has loaded.

    The configured mode answers it outright when set to pcm or sdm. In ``auto``
    the engine switches per source (readme §1.7, "Automatic switching"), so the
    configured value cannot say — but ``Status.active_mode`` reports the
    currently ACTIVE mode as a display string (protocol.md §5), which is exactly
    the chain that is loaded. None when neither can answer, which keeps the
    fields on the restore lane rather than guessing a chain.
    """
    chain = _chain_from_state(mgr)
    return chain if chain is not None else _chain_from_status(mgr)


def _index_for_enum_id(items: EnumItems, enum_id: str) -> str | None:
    """The list index of the item carrying this enum ID (the ID↔index join)."""
    for item in items:
        if str(item.get("value")) == str(enum_id):
            index = item.get("index")
            return None if index is None else str(index)
    return None


def _index_for_mode(items: EnumItems, form_value: str) -> str | None:
    """The ModesItem index for a config-form mode value (auto|pcm|sdm)."""
    want = _MODE_NAMES.get(str(form_value))
    if want is None:
        return None
    for item in items:
        if (item.get("name") or "").startswith(want):
            index = item.get("index")
            return None if index is None else str(index)
    return None


def _resolve(mgr: ConnectionManager, field: str, value: str, chain: str | None) -> str | None:
    """The live list index this form field+value becomes, or None when it cannot
    route live (wrong chain, missing enumeration, or an unknown value)."""
    spec = ROUTABLE[field]
    if spec.chain is not None and spec.chain != chain:
        return None
    items = (mgr.enums or {}).get(spec.enum) or []
    if field == "mode":
        return _index_for_mode(items, value)
    return _index_for_enum_id(items, value)


def _complete_filter_pair(pair: dict[str, str], state: dict[str, str]) -> bool:
    """Fill the unstaged half of a SetFilter edit from the current State.

    ``SetFilter value="N"`` alone sets BOTH the 1x and Nx filters (protocol.md
    §6), so a one-sided edit that omits its sibling silently clobbers it. Both
    args must therefore be explicit. Returns False when State cannot supply the
    missing side (older engines report neither ``filter1x`` nor ``filterNx``), in
    which case the edit belongs on the restore lane instead.
    """
    for arg, field in (("value", "filterNx"), ("value1x", "filter1x")):
        if arg in pair:
            continue
        current = state.get(field)
        if current is None:
            return False
        pair[arg] = str(current)
    return True


def _mode_blocks_batch(routable: dict[str, str]) -> bool:
    """Whether a mode change in this batch makes the chain edits unroutable.

    ``SetMode`` swaps the enumeration lists the filter/shaper indices are
    relative to, so indices resolved against the PRE-switch lists would be stale
    by the time the setter ran. Rather than re-enumerate mid-apply, a batch that
    changes mode alongside chain fields goes to the restore lane whole — which
    restarts once and re-reads everything consistently.
    """
    return "mode" in routable and len(routable) > 1


def _route_all(
    mgr: ConnectionManager, routable: dict[str, str], chain: str | None
) -> tuple[dict[str, dict[str, str]], set[str]]:
    """Resolve every routable field into setter args, dropping the ones that
    cannot translate. Returns the live edits and the fields they consumed."""
    live: dict[str, dict[str, str]] = {}
    routed: set[str] = set()
    for field, value in routable.items():
        index = _resolve(mgr, field, value, chain)
        if index is None:
            continue
        spec = ROUTABLE[field]
        live.setdefault(spec.setting, {})[spec.arg] = index
        routed.add(field)
    return live, routed


def _unroute_filter(live: dict[str, dict[str, str]], routed: set[str]) -> set[str]:
    """Hand the SetFilter pair back to the restore lane (State couldn't complete it)."""
    del live["filter"]
    return {field for field in routed if ROUTABLE[field].setting != "filter"}


def _merge(base: dict[str, dict[str, str]], extra: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    """Fold routed setter args into the already-staged live edits, without
    mutating either (``base`` is the pending store's own dict)."""
    merged = {setting: dict(params) for setting, params in base.items()}
    for setting, params in extra.items():
        merged[setting] = {**merged.get(setting, {}), **params}
    return merged


def split_live(
    mgr: ConnectionManager, http_fields: dict[str, str], live_edits: dict[str, dict[str, str]]
) -> tuple[dict[str, dict[str, str]], dict[str, str]]:
    """Fold every routable form field into ``live_edits``, returning it alongside
    the fields that still need the restore lane. An empty remainder means the
    whole batch applies live and the daemon is never restarted."""
    routable = {k: v for k, v in http_fields.items() if k in ROUTABLE}
    if not routable or _mode_blocks_batch(routable):
        return live_edits, dict(http_fields)
    live, routed = _route_all(mgr, routable, active_chain(mgr))
    if "filter" in live and not _complete_filter_pair(live["filter"], mgr.state or {}):
        routed = _unroute_filter(live, routed)
    return _merge(live_edits, live), {k: v for k, v in http_fields.items() if k not in routed}
