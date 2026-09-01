"""The LIVE view's write lane — one batch of live settings, applied on the spot.

``POST /api/config/live`` lands here. It is deliberately not stage+apply: the
pending buffer is shared with the tabs view (``api/pendingapi.PendingStore``) and
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

from hqptuner.engine.control import ENUM_COMMANDS, ControlClient, ControlError
from hqptuner.lanes.live import routing
from hqptuner.lanes.live.chain import active_chain
from hqptuner.lanes.writer import apply_live

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)

# Writes that invalidate an enumeration the NEXT live write resolves against:
# SetMode swaps the filter and shaper lists wholesale, and the rate list depends
# on both mode and the selected filter (manual §4.6). The poll loop re-enumerates
# only on a mode-index change, so without this the control the user reaches for
# next would resolve its value against a stale list.
_REENUMERATES = frozenset({"mode", "filter", "rate"})


class LiveMemory:
    """What LIVE has set that the engine itself cannot hold on to.

    The engine keeps ONE filter/shaper pair, so the moment the loaded chain
    changes there is nothing left on the engine to say what LIVE set for the
    other one. This is that record, and it is what `overrides.live_overrides`
    reports for whichever chain is dormant.

    `chain` is per chain, config-form field -> enum ID — IDs rather than list
    indices because an index is only meaningful while its chain is loaded, which
    is exactly the condition this outlives.
    """

    def __init__(self) -> None:
        """Start out remembering nothing — no setting held for any chain."""
        self.chain: dict[str, dict[str, str]] = {}

    def forget(self) -> None:
        """Drop everything — a LIVE setting lasts only until the daemon restarts.

        A fresh handshake is what a restart looks like from here. Holding on would report, and
        re-assert, a setting nothing is playing any more.
        """
        self.chain.clear()


def _applied(report: list[dict[str, Any]], setting: str) -> bool:
    """Whether this setting is in the report and verified by readback."""
    return any(entry["setting"] == setting and entry["ok"] for entry in report)


async def _refresh_rates(mgr: ConnectionManager, client: ControlClient, fields: dict[str, str]) -> None:
    """Re-ask the daemon for the rates list, replacing the cached one, if this batch carries a rate.

    ``mgr.readings.enums`` is fetched at connect and re-fetched by the poll loop only when
    ``mode`` or ``state`` moves (``manager._poll``). That is right for the dropdowns
    it feeds and wrong for a write: ``GetRates`` answers per mode AND per transport
    state, so a connect taken while the transport was idle caches the auto entry
    alone, and no ``mode``/``state`` transition is pending to clear it. Every rate
    the user then picks resolves against that degenerate list and is refused.

    The first ask on a fresh connection is already truthful — verified on 6.0.4,
    two connections, three ``GetRates`` each, all six answers the full 11-item
    ladder (``scripts/probes/probe_rates_on_demand.py``) — so asking here is enough
    and no device-capability cross-check is needed.
    """
    if "rate" not in fields:
        return
    mgr.readings.enums = {**(mgr.readings.enums or {}), "rates": await client.get_enumeration(ENUM_COMMANDS["rates"])}


def _held_fields(stored: dict[str, dict[str, str]]) -> dict[str, str]:
    """Everything this batch held, flat, as the caller's `stored` answer.

    Held is held: the frontend re-reads the running config on any of it, which is
    where a held value shows up (`overrides.live_overrides`).
    """
    return {field: value for chain_held in stored.values() for field, value in chain_held.items()}


def _remember_chain(mgr: ConnectionManager, chain: str, fields: dict[str, str]) -> None:
    """Record what LIVE set on one chain, in config-form terms.

    Applied and held edits are both recorded, and for the same reason: the engine
    holds one filter/shaper pair, so whichever chain is dormant next has nothing
    of its own left to report. This is that record (`LiveMemory`).
    """
    if fields:
        mgr.readings.live.chain.setdefault(chain, {}).update(fields)


def _applied_chain_fields(report: list[dict[str, Any]], fields: dict[str, str]) -> dict[str, str]:
    """Return the chain-scoped fields in this batch whose setter verified by readback."""
    return {
        field: value
        for field, value in fields.items()
        if field in routing.ROUTABLE
        and routing.ROUTABLE[field].chain is not None
        and _applied(report, routing.ROUTABLE[field].setting)
    }


def remember_routed(mgr: ConnectionManager, report: list[dict[str, Any]], fields: dict[str, str]) -> None:
    """Record a staged apply's live-routed chain fields, the same bookkeeping ``apply_now`` does for LIVE's.

    The staged lane routes chain fields live too (``routing.split_live``), and a
    value the record never learns is a value the next chain entry cannot re-assert
    and the next auto-save on the other chain cannot report — it falls back to the
    config file's stale copy instead (``overrides.live_overrides``), quietly
    reverting the setting the user just applied.
    """
    chain = active_chain(mgr)
    if chain is not None:
        _remember_chain(mgr, chain, _applied_chain_fields(report, fields))


async def reassert_chain(mgr: ConnectionManager, client: ControlClient) -> list[dict[str, Any]]:
    """Put back what LIVE set on the chain the engine has now loaded.

    `GetFilters`/`GetShapers` answer for the loaded chain only, so an edit made to
    the other card on the LIVE page could not reach the engine when it was made
    and was held instead (`routing.resolve_live`). This is where it lands. Values
    the entered chain turns out not to carry are forgotten rather than
    approximated, and the memory itself is kept: it is what
    `overrides.live_overrides` reports for the chain that is dormant next.

    Resolves against `mgr.readings.enums` as it stands, so the caller must re-enumerate
    first — these are the lists the chain change just swapped.
    """
    chain = active_chain(mgr)
    if chain is None:
        return []
    edits, dropped = routing.resolve_chain(mgr, chain)
    for field in dropped:
        del mgr.readings.live.chain[chain][field]
    return await apply_live(client, edits, mgr.audit) if edits else []


async def chain_entered(
    mgr: ConnectionManager, client: ControlClient, before: str | None, *, reenumerated: bool
) -> None:
    """Handle the engine having loaded a different filter/shaper chain.

    Refresh the lists it enumerates, then put back what LIVE set on the chain it entered.

    The chain can change with the configured mode standing still. In `[source]`
    mode the engine follows the source (readme §1.7), so a DSD track after a PCM
    one swaps the filter and shaper lists without touching `State.mode` — and
    watching the mode index alone therefore served the previous chain's lists for
    the whole of the next track. `reenumerated` says the caller already pulled
    fresh lists for a mode change, so this does not pull them twice.
    """
    after = active_chain(mgr)
    if after is None or after == before:
        return
    log.info("chain changed (%s -> %s)", before or "unknown", after)
    if not reenumerated:
        mgr.readings.enums = await client.get_all_enumerations()
    if await reassert_chain(mgr, client):
        mgr.readings.state = await client.get_state()


async def refresh_after_live(mgr: ConnectionManager, client: ControlClient, edits: dict[str, dict[str, str]]) -> None:
    """Re-read what a live batch just invalidated: the running state always, the enumerations when the batch moved one.

    Live edits bypass the config file, so State is the only record of them. The
    enumerations are the subtler half: a write in ``_REENUMERATES`` swaps a list
    the NEXT write resolves its value against, and refreshing State alone also
    consumes the mode transition the poll loop watches to re-enumerate on its own
    (``manager._poll``) — so a caller that skipped this left both the cache and
    the fallback stale. Every live-routing caller runs it, staged lane included.
    """
    mgr.readings.state = await client.get_state()
    if _REENUMERATES & set(edits):
        mgr.readings.enums = await client.get_all_enumerations()


async def apply_now(mgr: ConnectionManager, fields: dict[str, str]) -> dict[str, Any]:
    """Resolve, apply and readback-verify a batch of LIVE config-form fields.

    A batch carrying a rate re-asks the daemon for the rates list first
    (`_refresh_rates`): the cached one can be degenerate, and resolving a rate
    against it refused every tier the user picked.

    Fields for the chain the engine has not loaded are held rather than refused —
    LIVE shows both chains at once — and come back under `stored` so the caller
    knows the value it sent is real but not yet playing.

    Everything after `apply_live` is bookkeeping for the NEXT write — the write
    itself is already readback-verified — so a control-connection failure there is
    logged, not raised. `SetFilter` and `SetMode` reload the engine and the daemon
    can drop the connection under the refresh that follows; raising turned a change
    the user watched land into an error on the control they just touched. The poll
    loop reconnects and reloads state and enumerations (`manager._connect_and_load`).
    """
    client = mgr.control
    if client is None:
        raise ControlError("daemon not connected")
    await _refresh_rates(mgr, client, fields)
    edits, stored = routing.resolve_live(mgr, fields)
    report = await apply_live(client, edits, mgr.audit)
    try:
        await refresh_after_live(mgr, client, edits)
    except ControlError as exc:
        log.warning("post-apply refresh failed: %s", exc)
    for chain, held in stored.items():
        _remember_chain(mgr, chain, held)
    loaded = active_chain(mgr)
    if loaded is not None:
        _remember_chain(mgr, loaded, _applied_chain_fields(report, fields))
    if _applied(report, "mode"):
        # after the re-enumeration above: the entered chain's held settings
        # resolve against the lists SetMode just swapped
        try:
            report = report + await reassert_chain(mgr, client)
            mgr.readings.state = await client.get_state()
        except ControlError as exc:
            log.warning("post-apply re-assert failed: %s", exc)
    return {"live": report, "stored": _held_fields(stored)}


def mode_already_running(mgr: ConnectionManager, want: str) -> bool:
    """Whether the engine is already in the mode a preset asks for.

    Worth checking because ``SetMode`` is not free even when it changes nothing:
    it clears the engine's rate pin outright (probe-verified on 6.0.4,
    ``scripts/probes/probe_mode_rate_pin.py``) and reloads the chain. A preset saved and
    re-applied in the same mode should disturb neither.
    """
    index = (mgr.readings.state or {}).get("mode")
    if index is None:
        return False
    return routing.mode_form_value((mgr.readings.enums or {}).get("modes") or [], index) == want


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
    if not mode_already_running(mgr, mode):
        first = await apply_now(mgr, {"mode": mode})
    second = await apply_now(mgr, rest)
    return {"live": [*first["live"], *second["live"]], "stored": {**first["stored"], **second["stored"]}}


def _mode_apart(http_fields: dict[str, str]) -> str | None:
    """Return the staged mode value when it goes on the wire as its own batch.

    Every live mode write does, whatever else is staged with it. ``SetMode`` swaps
    the lists every later value resolves against, so it has to go through the
    re-enumerating path (``apply_now``) — beside other routable fields because
    those fields resolve against the lists it swapped
    (``routing._mode_blocks_batch``), and ALONE because the batch after it does.
    A mode routed as an ordinary edit left the enumerations stale and the poll
    loop blind to the switch it watches for, so the next apply's filter resolved
    against the departed mode's list and the engine took a different filter than
    the one named.

    Only in a batch that can go fully live, though. One restore-lane field means
    the restart is happening regardless, and that restart boots the daemon onto
    its config file, so the mode belongs in that file with the rest of the batch,
    not on a live setter the restore would immediately overwrite.
    """
    if any(field not in routing.ROUTABLE for field in http_fields):
        return None
    return http_fields.get("mode")


async def mode_then_split(
    mgr: ConnectionManager, http_fields: dict[str, str], live_edits: dict[str, dict[str, str]]
) -> tuple[list[dict[str, Any]], dict[str, dict[str, str]], dict[str, str]]:
    """Route the tabs view's staged batch, mode first.

    ``apply_preset``'s two-batch workaround, ported to the apply lane.

    Without a re-enumeration between ``SetMode`` and the rest, a staged mode
    beside other routable fields sends the whole batch to the restore lane
    (``routing._mode_blocks_batch``) — one daemon restart, playback
    interrupted. ``apply_now`` is that re-enumeration (plus the rate-pin and chain
    re-asserts a verified mode write always needs), so the mode goes through it
    alone and the remainder splits against the lists the switch produced. A mode
    the engine is already running is dropped rather than re-sent — ``SetMode``
    clears the rate pin even when it changes nothing (``mode_already_running``).
    A mode that cannot resolve or apply sends the whole batch to the restore
    lane, exactly as before. A mode that reaches the daemon and does not verify
    does NOT: the batch stays live and reports the setter as failed. The restore
    lane restarts the daemon, and the user was told before Apply that this batch
    would not.

    A staged mode with nothing beside it takes the same route (``_mode_apart``):
    the batch that needs the post-switch lists is then the NEXT apply rather than
    the remainder of this one, and it is no less entitled to them.
    """
    mode = _mode_apart(http_fields)
    if mode is None:
        edits, remainder = routing.split_live(mgr, http_fields, live_edits)
        return [], edits, remainder
    if mode_already_running(mgr, mode):
        report: list[dict[str, Any]] = []
    else:
        try:
            report = (await apply_now(mgr, {"mode": mode}))["live"]
        except (routing.LiveRouteError, ControlError) as exc:
            log.warning("mode-first batch fell back to the restore lane: %s", exc)
            return [], live_edits, dict(http_fields)
        # A mode the daemon answered OK and did not take comes back unverified in
        # the report (`writer.apply_live`), and that is where it stays. The
        # pending-changes bar told the user before Apply whether this batch
        # restarts the daemon; escalating to the restore lane here would restart
        # it anyway, on a batch the user was promised would not.
    rest = {field: value for field, value in http_fields.items() if field != "mode"}
    edits, remainder = routing.split_live(mgr, rest, live_edits)
    if remainder:
        # the rest fell back to the restore lane, whose restart boots the daemon
        # from its config file — the mode just applied live rides along or the
        # restart reverts it (the file never learned it)
        remainder = {**remainder, "mode": http_fields["mode"]}
    return report, edits, remainder
