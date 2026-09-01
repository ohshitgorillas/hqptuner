"""Which chain the engine has loaded, and which output family a rate pin can land in."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from hqptuner.core.manager import ConnectionManager

PCM = "pcm"
SDM = "sdm"

EnumItems = list[dict[str, str]]

# No PCM rate the engine offers reaches DSD64, so the lowest SDM rate separates
# the two families outright — no rate in Hz is ambiguous between them.
_SDM_FLOOR = 2822400


def rate_family(hz: str) -> str:
    """Which output family a rate in Hz belongs to."""
    return SDM if int(hz) >= _SDM_FLOOR else PCM


# Every tier is n x 44100 or n x 48000 for the same n. A pin names the TIER, sent
# as its 48k member: with `auto_family` on (readme §1.2, forced by
# http.restore.FORCED_CONFIG) the engine keeps 44.1k material in its own family
# under that pin, so the 44.1k member is never what goes on the wire by choice.
_BASE_44K = 44100
_BASE_48K = 48000


def tier_rate(hz: str) -> str:
    """Return a rate as the 48k-base member of its tier — the form a pin takes.

    The 44.1k member converts exactly and anything else is already the 48k one.
    """
    value = int(hz)
    return str(value // _BASE_44K * _BASE_48K) if value % _BASE_44K == 0 else hz


def rate_index_for(mgr: ConnectionManager, hz: str) -> str | None:
    """Return the ``RatesItem`` index carrying this rate's tier, in the engine's current list.

    The tier's 48k member first; the rate as given only when the engine lists no
    48k member for it, which is a device doing DSD in one base family alone.
    """
    items = (mgr.readings.enums or {}).get("rates") or []
    index = index_for_rate(items, tier_rate(hz))
    return index if index is not None else index_for_rate(items, hz)


def pin_family(mgr: ConnectionManager) -> str | None:
    """Return the output family the engine will accept a rate pin for, or None for none.

    The CONFIGURED mode answers this, never the running chain, and the two come
    apart in exactly the case that matters: in ``[source]`` the engine has a chain
    loaded and still refuses every pin — ``SetRate`` answers ``result="OK"`` with
    ``State.rate`` unmoved (probe-verified on 6.0.4,
    ``scripts/probes/probe_rate_playing.py``). In ``[source]`` the output rate
    follows the source (readme §1.7), so there is no pin slot to write.
    """
    return _chain_from_state(mgr)


def unpinnable_rate(mgr: ConnectionManager, hz: str) -> bool:
    """Whether the engine will refuse this rate as a pin right now.

    Two ways it refuses, and both look identical on the wire — ``result="OK"``
    with ``State.rate`` unmoved. A rate for the family the engine is not running
    has no index to send at all: ``GetRates`` is mode-scoped and a bare Hz value is
    accepted and ignored (protocol.md §6, measured). And in ``[source]`` no rate is
    pinnable at all (``pin_family``).

    So it is held rather than refused, exactly as an edit to the dormant chain's
    card is (``resolve_live``): setting up the SDM side while PCM plays, or the
    whole output before leaving auto, is an ordinary thing to do on the LIVE page.
    ``lane._reassert_rate`` puts it on the engine when that family becomes
    pinnable — which is also what makes it survive the switch it was made for,
    since the engine keeps ONE pin and ``SetMode`` clears it outright.

    Auto (``"0"``) says *stop* pinning, which the engine does take: never held.
    """
    return hz != "0" and rate_family(hz) != pin_family(mgr)


def split_unpinnable_rate(mgr: ConnectionManager, fields: dict[str, str]) -> tuple[dict[str, str], str | None]:
    """Return the batch minus a rate the engine will not pin, and that rate.

    Split before `resolve_live` rather than routed inside it: the held rate does
    not belong to `stored`. That is the per-chain memory of filters and shapers,
    keyed by config-form field, and the rate has neither a chain of its own to be
    keyed under (its family comes from its VALUE) nor the same fate on the way
    back in — `LiveMemory.rates` and `_reassert_rate` land it, not `resolve_chain`.
    """
    hz = fields.get("rate")
    if hz is None or not unpinnable_rate(mgr, hz):
        return fields, None
    return {field: value for field, value in fields.items() if field != "rate"}, hz


def index_for_rate(items: EnumItems, hz: str) -> str | None:
    """Return the ``RatesItem`` index carrying this rate in Hz (``"0"`` = auto)."""
    for item in items:
        if str(item.get("rate")) == str(hz):
            index = item.get("index")
            return None if index is None else str(index)
    return None


def _chain_name(name: str) -> str | None:
    """Return the chain a mode name denotes, or None for ``[source]``/anything unknown."""
    upper = (name or "").upper()
    if upper.startswith("PCM"):
        return PCM
    return SDM if upper.startswith(("SDM", "DSD")) else None


def _chain_from_state(mgr: ConnectionManager) -> str | None:
    """Return the CONFIGURED mode's chain — decisive when it is pcm or sdm, None in auto."""
    index = (mgr.readings.state or {}).get("mode")
    if index is None:
        return None
    for item in (mgr.readings.enums or {}).get("modes", []):
        if str(item.get("index")) == str(index):
            return _chain_name(item.get("name") or "")
    return None


def _chain_from_status(mgr: ConnectionManager) -> str | None:
    """Return the chain the engine is running RIGHT NOW, from what Status reports.

    ``Status.active_mode`` looks like the whole answer and is not: it echoes the
    CONFIGURED mode, so in ``[source]`` — the one case this is reached in on a
    live daemon — it reads ``"[source]"`` and nothing else (probe-verified on
    6.0.4, ``scripts/probes/probe_rate_playing.py``). ``Status.active_rate``
    does answer, and unambiguously: it is the rate coming out, and its family is
    the chain that produced it (``rate_family``, no rate lands between the two).
    """
    status = mgr.readings.status or {}
    named = _chain_name(status.get("active_mode") or "")
    if named is not None:
        return named
    hz = status.get("active_rate") or ""
    return rate_family(hz) if hz.isdigit() and hz != "0" else None


def active_chain(mgr: ConnectionManager) -> str | None:
    """Which filter/shaper chain the engine currently has loaded.

    The configured mode answers it outright when set to pcm or sdm. In ``auto``
    the engine switches per source (readme §1.7, "Automatic switching"), so the
    configured value cannot say and Status answers instead (``_chain_from_status``).
    None when neither can answer, which keeps the fields on the restore lane
    rather than guessing a chain.

    This is not ``pin_family``, and the difference is the whole of auto mode: a
    chain is loaded there and takes filter and shaper edits live, while the rate
    pin is refused. Chain questions ask this one; rate questions ask that one.
    """
    chain = _chain_from_state(mgr)
    return chain if chain is not None else _chain_from_status(mgr)
