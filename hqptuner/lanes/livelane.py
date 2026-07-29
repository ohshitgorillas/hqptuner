"""The LIVE view's write lane — one batch of live settings, applied on the spot.

``POST /api/config/live`` lands here. It is deliberately not stage+apply: the
pending buffer is shared with the tabs view (``api/app.PendingStore``) and
``POST /config/apply`` flushes everything in it, so a LIVE control routed through
that pair would also apply edits the user staged elsewhere and never asked for.
This lane touches neither the pending store nor the persistent 8088 lane, so it
cannot restart the daemon.

``result="OK"`` is not proof of application (protocol.md §6): every setter here
is verified by a ``State`` readback, which is ``writer.apply_live``'s job and the
reason this lane reuses it rather than calling the setters itself.

No idle gate, here or anywhere in the write path (CLAUDE.md): a live setting
applies immediately even mid-playback, and what that costs is the user's to
spend.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from ..control import ControlClient, ControlError
from ..writer import apply_live
from . import livemap

if TYPE_CHECKING:  # avoid a circular import at runtime
    from ..manager import ConnectionManager

log = logging.getLogger(__name__)

# Writes that invalidate an enumeration the NEXT live write resolves against:
# SetMode swaps the filter and shaper lists wholesale, and the rate list depends
# on both mode and the selected filter (manual §4.6). The poll loop re-enumerates
# only on a mode-index change, so without this the control the user reaches for
# next would resolve its value against a stale list.
_REENUMERATES = frozenset({"mode", "filter", "rate"})


class LiveMemory:
    """What LIVE has set that the engine itself cannot hold on to.

    The engine keeps ONE rate pin and ONE filter/shaper pair, and `SetMode` clears
    the pin outright (measured 2026-07-28, `scripts/probe_mode_rate_pin.py`), so
    the moment the output family or the loaded chain changes there is nothing left
    on the engine to say what LIVE set for the other one. This is that record, and
    it is what `liveoverrides.live_overrides` reports for whichever is dormant.

    `rates` is per family, in Hz. `chain` is per chain, config-form field -> enum
    ID — IDs rather than list indices because an index is only meaningful while
    its chain is loaded, which is exactly the condition this outlives.
    """

    def __init__(self) -> None:
        self.rates: dict[str, str] = {}
        self.chain: dict[str, dict[str, str]] = {}

    def forget(self) -> None:
        """Drop everything — a LIVE setting lasts only until the daemon restarts,
        which is what a fresh handshake means. Holding on would report, and
        re-assert, a setting nothing is playing any more."""
        self.rates.clear()
        self.chain.clear()


def _applied(report: list[dict[str, Any]], setting: str) -> bool:
    """Whether this setting is in the report and verified by readback."""
    return any(entry["setting"] == setting and entry["ok"] for entry in report)


def _remember_rate(mgr: ConnectionManager, hz: str) -> None:
    """Record the rate LIVE just pinned under the family it belongs to.

    ``"0"`` is the engine's Auto and pins nothing, so it forgets instead. The rate
    menus carry no Auto entry (``store/schema.js``), so this is only reachable from
    a hand-made request.
    """
    if hz == "0":
        mgr.live.rates.clear()
        return
    mgr.live.rates[livemap.rate_family(hz)] = hz


async def _reassert_rate(mgr: ConnectionManager, client: ControlClient) -> list[dict[str, Any]]:
    """Put the entered family's remembered pin back on the engine.

    ``SetMode`` clears the rate pin outright — the engine keeps one, not one per
    family (measured 2026-07-28, ``scripts/probe_mode_rate_pin.py``). Without this
    a mode switch silently throws away the rate the user picked, and both this page
    and the Output tab fall back to the configured limit.

    Asks ``pin_family`` rather than ``active_chain``, because leaving ``[source]``
    is a switch this has to land on too: the rate was held for want of a pin slot,
    not for want of a chain, and in ``[source]`` a chain is loaded the whole time.

    A tier the entered mode does not offer is forgotten rather than approximated:
    pinning the nearest rate the engine does offer would be a rate the user never
    picked.
    """
    family = livemap.pin_family(mgr)
    hz = mgr.live.rates.get(family or "")
    if hz is None:
        return []
    index = livemap.rate_index_for(mgr, hz)
    if index is None:
        del mgr.live.rates[family or ""]
        return []
    return await apply_live(client, {"rate": {"value": index}})


def _held_fields(stored: dict[str, dict[str, str]], held_rate: str | None) -> dict[str, str]:
    """Everything this batch held, flat, as the caller's `stored` answer — the
    chains' fields and the off-family rate alike. Held is held: the frontend
    re-reads the running config on any of it, which is where a held value shows
    up (`liveoverrides.live_overrides`)."""
    held = {field: value for chain_held in stored.values() for field, value in chain_held.items()}
    return held if held_rate is None else {**held, "rate": held_rate}


def _remember_chain(mgr: ConnectionManager, chain: str, fields: dict[str, str]) -> None:
    """Record what LIVE set on one chain, in config-form terms.

    Applied and held edits are both recorded, and for the same reason: the engine
    holds one filter/shaper pair, so whichever chain is dormant next has nothing
    of its own left to report. This is that record (`LiveMemory`).
    """
    if fields:
        mgr.live.chain.setdefault(chain, {}).update(fields)


def _applied_chain_fields(report: list[dict[str, Any]], fields: dict[str, str]) -> dict[str, str]:
    """The chain-scoped fields in this batch whose setter verified by readback."""
    return {
        field: value
        for field, value in fields.items()
        if field in livemap.ROUTABLE
        and livemap.ROUTABLE[field].chain is not None
        and _applied(report, livemap.ROUTABLE[field].setting)
    }


async def reassert_chain(mgr: ConnectionManager, client: ControlClient) -> list[dict[str, Any]]:
    """Put back what LIVE set on the chain the engine has now loaded.

    `GetFilters`/`GetShapers` answer for the loaded chain only, so an edit made to
    the other card on the LIVE page could not reach the engine when it was made
    and was held instead (`livemap.resolve_live`). This is where it lands. Values
    the entered chain turns out not to carry are forgotten rather than
    approximated, and the memory itself is kept: it is what
    `liveoverrides.live_overrides` reports for the chain that is dormant next.

    Resolves against `mgr.enums` as it stands, so the caller must re-enumerate
    first — these are the lists the chain change just swapped.
    """
    chain = livemap.active_chain(mgr)
    if chain is None:
        return []
    edits, dropped = livemap.resolve_chain(mgr, chain)
    for field in dropped:
        del mgr.live.chain[chain][field]
    return await apply_live(client, edits) if edits else []


async def chain_entered(mgr: ConnectionManager, client: ControlClient, before: str | None, reenumerated: bool) -> None:
    """Handle the engine having loaded a different filter/shaper chain: refresh the
    lists it enumerates, then put back what LIVE set on the chain it entered.

    The chain can change with the configured mode standing still. In `[source]`
    mode the engine follows the source (readme §1.7), so a DSD track after a PCM
    one swaps the filter and shaper lists without touching `State.mode` — and
    watching the mode index alone therefore served the previous chain's lists for
    the whole of the next track. `reenumerated` says the caller already pulled
    fresh lists for a mode change, so this does not pull them twice.
    """
    after = livemap.active_chain(mgr)
    if after is None or after == before:
        return
    log.info("chain changed (%s -> %s)", before or "unknown", after)
    if not reenumerated:
        mgr.enums = await client.get_all_enumerations()
    if await reassert_chain(mgr, client):
        mgr.state = await client.get_state()


async def apply_now(mgr: ConnectionManager, fields: dict[str, str]) -> dict[str, Any]:
    """Resolve, apply and readback-verify a batch of LIVE config-form fields.

    Fields for the chain the engine has not loaded are held rather than refused —
    LIVE shows both chains at once — and come back under `stored` so the caller
    knows the value it sent is real but not yet playing. A rate the engine will not
    pin — the other family's, or any at all while the mode is `[source]` — is held
    on the same terms and for the same reason (`livemap.unpinnable_rate`), but into
    its own memory: the engine's rate pin is one slot the mode switch clears, not a
    per-chain list, so it is `LiveMemory.rates` that holds it and `_reassert_rate`
    that lands it.
    """
    client = mgr.control
    if client is None:
        raise ControlError("daemon not connected")
    fields, held_rate = livemap.split_unpinnable_rate(mgr, fields)
    edits, stored = livemap.resolve_live(mgr, fields)
    report = await apply_live(client, edits)
    mgr.state = await client.get_state()  # live edits bypass the file: refresh running truth
    if _REENUMERATES & set(edits):
        mgr.enums = await client.get_all_enumerations()
    if _applied(report, "rate"):
        _remember_rate(mgr, fields["rate"])
    if held_rate is not None:
        _remember_rate(mgr, held_rate)
    for chain, held in stored.items():
        _remember_chain(mgr, chain, held)
    loaded = livemap.active_chain(mgr)
    if loaded is not None:
        _remember_chain(mgr, loaded, _applied_chain_fields(report, fields))
    if _applied(report, "mode"):
        # after the re-enumeration above: the rates list is mode-dependent
        # (manual §4.6), so the remembered rate resolves against the NEW list, and
        # the entered chain's held settings against the lists SetMode just swapped
        report = report + await _reassert_rate(mgr, client) + await reassert_chain(mgr, client)
        mgr.state = await client.get_state()
    return {"live": report, "stored": _held_fields(stored, held_rate)}


def _mode_already_running(mgr: ConnectionManager, want: str) -> bool:
    """Whether the engine is already in the mode a preset asks for.

    Worth checking because ``SetMode`` is not free even when it changes nothing:
    it clears the engine's rate pin outright (measured 2026-07-28,
    ``scripts/probe_mode_rate_pin.py``) and reloads the chain. A preset saved and
    re-applied in the same mode should disturb neither.
    """
    index = (mgr.state or {}).get("mode")
    if index is None:
        return False
    return livemap.mode_form_value((mgr.enums or {}).get("modes") or [], index) == want


async def apply_preset(mgr: ConnectionManager, fields: dict[str, str]) -> dict[str, Any]:
    """Apply a live preset — a batch that may carry the output mode.

    ``resolve_live`` refuses mode beside anything else, and rightly: ``SetMode``
    swaps the filter, shaper and rate enumerations, so indices resolved before it
    ran are stale after. A preset is not obliged to be one batch, though. The mode
    goes first on its own — which re-enumerates and re-asserts what LIVE had set
    for the entered family and chain, exactly as a hand-made mode write does — and
    the rest is then resolved against the lists that switch produced.

    This is what lets a preset mean "run SDM, like this". Applying one saved on
    the other chain is not a conflict to refuse: switching is the request.
    """
    mode = fields.get("mode")
    rest = {field: value for field, value in fields.items() if field != "mode"}
    if mode is None or not rest:
        return await apply_now(mgr, fields)
    first: dict[str, Any] = {"live": [], "stored": {}}
    if not _mode_already_running(mgr, mode):
        first = await apply_now(mgr, {"mode": mode})
    second = await apply_now(mgr, rest)
    return {"live": [*first["live"], *second["live"]], "stored": {**first["stored"], **second["stored"]}}
