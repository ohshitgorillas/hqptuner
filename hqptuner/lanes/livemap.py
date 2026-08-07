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

from hqptuner.lanes.livechain import PCM, SDM, EnumItems, active_chain, index_for_rate

if TYPE_CHECKING:
    from hqptuner.core.manager import ConnectionManager


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
MODE_NAMES = {"auto": "[source]", "pcm": "PCM", "sdm": "SDM"}

# Live-lane fields the FRONTEND stages directly (schema `lane: "live"`), so they
# never pass through `split_live` and are absent from ROUTABLE — but they make
# the config file just as stale, and a save that ignores them stores a setting
# the user is not hearing. Config-form field -> the State attribute carrying it.
# No enumeration in between: both sides are the same 0/1 flag, so the value is
# the value (`adaptive_volume` <-> `<engine volume_adaptive>`).
DIRECT: dict[str, str] = {"adaptive_volume": "adaptive"}


def _index_for_enum_id(items: EnumItems, enum_id: str) -> str | None:
    """Return the list index of the item carrying this enum ID (the ID↔index join)."""
    for item in items:
        if str(item.get("value")) == str(enum_id):
            index = item.get("index")
            return None if index is None else str(index)
    return None


def _index_for_mode(items: EnumItems, form_value: str) -> str | None:
    """Return the ModesItem index for a config-form mode value (auto|pcm|sdm)."""
    want = MODE_NAMES.get(str(form_value))
    if want is None:
        return None
    for item in items:
        if (item.get("name") or "").startswith(want):
            index = item.get("index")
            return None if index is None else str(index)
    return None


def mode_form_value(items: EnumItems, index: str) -> str | None:
    """Return the config-form mode value (auto|pcm|sdm) a ModesItem index denotes.

    The inverse of ``_index_for_mode``, and public because two other lanes need
    it: ``liveoverrides`` to report the running mode and ``livesnapshot`` to store
    it in a live preset. Matched by NAME for the same reason the forward join is —
    the modes enumeration is device-dependent, so positions are not stable.
    """
    for item in items:
        if str(item.get("index")) != str(index):
            continue
        name = (item.get("name") or "").upper()
        return next((form for form, want in MODE_NAMES.items() if name.startswith(want.upper())), None)
    return None


def _resolve(mgr: ConnectionManager, field: str, value: str, chain: str | None) -> str | None:
    """Return the live list index this form field+value becomes, or None when it cannot route live.

    It cannot route live on a wrong chain, a missing enumeration, or an unknown value.
    """
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
    """Resolve every routable field into setter args, dropping the ones that cannot translate.

    Returns the live edits and the fields they consumed.
    """
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
    """Fold routed setter args into the already-staged live edits, without mutating either.

    ``base`` is the pending store's own dict.
    """
    merged = {setting: dict(params) for setting, params in base.items()}
    for setting, params in extra.items():
        merged[setting] = {**merged.get(setting, {}), **params}
    return merged


def split_live(
    mgr: ConnectionManager, http_fields: dict[str, str], live_edits: dict[str, dict[str, str]]
) -> tuple[dict[str, dict[str, str]], dict[str, str]]:
    """Fold every routable form field into ``live_edits``, returning it alongside the restore lane's remainder.

    The remainder is the fields that still need the restore lane. An empty remainder means the
    whole batch applies live and the daemon is never restarted.
    """
    routable = {k: v for k, v in http_fields.items() if k in ROUTABLE}
    if not routable or _mode_blocks_batch(routable):
        return live_edits, dict(http_fields)
    live, routed = _route_all(mgr, routable, active_chain(mgr))
    if "filter" in live and not _complete_filter_pair(live["filter"], mgr.state or {}):
        routed = _unroute_filter(live, routed)
    return _merge(live_edits, live), {k: v for k, v in http_fields.items() if k not in routed}


# --- LIVE lane: the LIVE view's immediate, unstaged writes --------------------
# The LIVE view writes each control the moment it changes, so its batches resolve
# against the running enumerations exactly like the apply lane's live half above
# — plus two controls that lane never routes. `lanes/livelane.py` applies what
# this resolves.


class LiveRouteError(Exception):
    """A LIVE batch that could not be resolved, carrying one reason per field.

    Raised rather than dropping the unroutable fields the way ``split_live``
    does. Its fallback is the restore lane, which is always correct and only
    slower; LIVE has no fallback, so a silently skipped field would leave its
    control displaying a value the engine never took.
    """

    def __init__(self, reasons: dict[str, str]) -> None:
        """Build the message by joining the per-field reasons in field order, and keep the mapping on ``reasons``."""
        super().__init__("; ".join(f"{field}: {why}" for field, why in sorted(reasons.items())))
        self.reasons = reasons


_LIVE_ONLY: dict[str, LiveField] = {
    # Target output rate. Deliberately absent from ROUTABLE, and for the reason
    # stated there: the config form's `defaults_samplerate`/`defaults_bitrate` are
    # a per-family ceiling under forced auto-family, a different slot from the
    # target rate `SetRate` writes. LIVE carries the target slot itself, as an
    # actual rate in Hz ("0" = auto) — and `RatesItem` has no `value` attribute
    # (`<RatesItem index rate/>`, protocol.md §6), so this one joins on `rate`.
    # A live-set rate is ephemeral by design: httplane.FORCED_CONFIG re-forces
    # samplerate=0 on every persistent apply, so LIVE experiments never reach the
    # config file.
    "rate": LiveField("rate", "value", "rates", None, "rate"),
    # Junk (playback) filter. Already index-domain on both sides — the daemon's
    # /config form has no field for it, so the frontend has always carried the
    # list index (store/schema.js `junk_filter`) — which makes the translation a
    # membership check: an index the running enumeration does not carry is
    # refused here instead of failing its readback afterwards.
    "junk_filter": LiveField("junk_filter", "value", "junk_filters", None, "filter_junk"),
}

_FILTER_FIELDS = tuple(field for field, spec in ROUTABLE.items() if spec.setting == "filter")


def live_fields() -> tuple[str, ...]:
    """Every config-form field the LIVE lane accepts."""
    return (*ROUTABLE, *_LIVE_ONLY, *DIRECT)


def _known_index(items: EnumItems, index: str) -> str | None:
    """``index`` back, but only if the running enumeration carries it."""
    return str(index) if any(str(item.get("index")) == str(index) for item in items) else None


def _live_index(mgr: ConnectionManager, field: str, value: str, chain: str | None) -> str | None:
    """Return the list index this LIVE field+value becomes, or None when it cannot."""
    if field in ROUTABLE:
        return _resolve(mgr, field, value, chain)
    items = (mgr.enums or {}).get(_LIVE_ONLY[field].enum) or []
    return index_for_rate(items, value) if field == "rate" else _known_index(items, value)


def _why_unresolved(field: str, value: str) -> str:
    """Why a field would not resolve, in terms the control that sent it can show."""
    spec = ROUTABLE.get(field) or _LIVE_ONLY[field]
    return f"{value} is not in the engine's live {spec.enum} list"


def _off_chain(field: str, chain: str | None) -> bool:
    """Whether this field belongs to the chain the engine does NOT have loaded."""
    spec = ROUTABLE.get(field)
    return spec is not None and spec.chain is not None and spec.chain != chain


def _route_live(
    mgr: ConnectionManager, fields: dict[str, str], chain: str | None
) -> tuple[dict[str, dict[str, str]], dict[str, str], dict[str, str]]:
    """Every field as setter args, alongside the held ones and the unresolvable ones.

    Held means for a chain that is not loaded; unresolvable means it would not resolve at all.
    """
    edits: dict[str, dict[str, str]] = {}
    stored: dict[str, str] = {}
    reasons: dict[str, str] = {}
    for field, value in fields.items():
        if field in DIRECT:
            # both sides are the same 0/1 flag, so there is nothing to translate,
            # and the form field's name is already the writer's setting key
            edits[field] = {"value": value}
            continue
        if _off_chain(field, chain):
            # No enumeration exists to resolve it against — GetFilters/GetShapers
            # answer for the loaded chain only — so it is held as the config-form
            # enum ID the caller sent and resolved when that chain loads. Not
            # validated here for the same reason: there is nothing to validate it
            # against until then, and `resolve_chain` drops what does not survive.
            stored[field] = value
            continue
        index = _live_index(mgr, field, value, chain)
        if index is None:
            reasons[field] = _why_unresolved(field, value)
            continue
        spec = ROUTABLE.get(field) or _LIVE_ONLY[field]
        edits.setdefault(spec.setting, {})[spec.arg] = index
    return edits, stored, reasons


def resolve_live(
    mgr: ConnectionManager, fields: dict[str, str]
) -> tuple[dict[str, dict[str, str]], dict[str, dict[str, str]]]:
    """Return a LIVE batch as ``writer.apply_live`` edits plus what is held per chain, or ``LiveRouteError``.

    All-or-nothing: the whole batch resolves before a single setter runs, because
    the LIVE page has no Apply button to retry from and a half-applied batch would
    leave the engine in a state no control on the page describes.

    A field for the chain the engine has not loaded is held rather than refused.
    LIVE shows both chains' cards at once, so editing the dormant one is an
    ordinary thing to do there; the edit is real and simply lands when that chain
    does (``livelane._reassert_chain``).
    """
    # The whole batch, not just the ROUTABLE part `split_live` guards: the rate
    # list is mode-dependent too (manual §4.6), so a mode change invalidates every
    # index resolved beside it, not only the chain fields'.
    if _mode_blocks_batch(fields):
        raise LiveRouteError(
            {
                "mode": "an output-mode change cannot be batched with other live settings: SetMode swaps the "
                "enumerations the other values were resolved against"
            }
        )
    edits, stored, reasons = _route_live(mgr, fields, active_chain(mgr))
    if "filter" in edits and not _complete_filter_pair(edits["filter"], mgr.state or {}):
        unfillable = "State reports no current filter, so the other half of the SetFilter pair cannot be filled in"
        reasons.update(dict.fromkeys((f for f in fields if f in _FILTER_FIELDS and f not in stored), unfillable))
    if reasons:
        raise LiveRouteError(reasons)
    return edits, _by_chain(stored)


def _by_chain(stored: dict[str, str]) -> dict[str, dict[str, str]]:
    """Held fields grouped under the chain each belongs to."""
    grouped: dict[str, dict[str, str]] = {}
    for field, value in stored.items():
        grouped.setdefault(str(ROUTABLE[field].chain), {})[field] = value
    return grouped


def resolve_chain(mgr: ConnectionManager, chain: str) -> tuple[dict[str, dict[str, str]], set[str]]:
    """Return a chain's remembered settings as ``writer.apply_live`` edits, alongside fields its lists do not carry.

    Those dropped fields are dropped rather than approximated, the same rule ``_reassert_rate``
    applies to a tier the entered mode does not offer: the nearest filter the
    engine does have is a filter the user never picked. Resolved against
    ``mgr.enums`` as it stands, so the caller must re-enumerate after the mode
    change first — the lists this joins through are the ones SetMode just swapped.
    """
    edits: dict[str, dict[str, str]] = {}
    dropped: set[str] = set()
    for field, value in (mgr.live.chain.get(chain) or {}).items():
        spec = ROUTABLE[field]
        index = _index_for_enum_id((mgr.enums or {}).get(spec.enum) or [], value)
        if index is None:
            dropped.add(field)
            continue
        edits.setdefault(spec.setting, {})[spec.arg] = index
    # SetFilter sets both halves at once, so a one-sided re-assert would clobber
    # the other; State supplies the missing half now that the chain is loaded.
    if "filter" in edits and not _complete_filter_pair(edits["filter"], mgr.state or {}):
        del edits["filter"]
    return edits, dropped
