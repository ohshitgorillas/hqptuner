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

from typing import TYPE_CHECKING, Any

from ..control import ControlClient, ControlError
from ..writer import apply_live
from . import livemap

if TYPE_CHECKING:  # avoid a circular import at runtime
    from ..manager import ConnectionManager

# Writes that invalidate an enumeration the NEXT live write resolves against:
# SetMode swaps the filter and shaper lists wholesale, and the rate list depends
# on both mode and the selected filter (manual §4.6). The poll loop re-enumerates
# only on a mode-index change, so without this the control the user reaches for
# next would resolve its value against a stale list.
_REENUMERATES = frozenset({"mode", "filter", "rate"})


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
        mgr.live_rates.clear()
        return
    mgr.live_rates[livemap.rate_family(hz)] = hz


async def _reassert_rate(mgr: ConnectionManager, client: ControlClient) -> list[dict[str, Any]]:
    """Put the entered family's remembered pin back on the engine.

    ``SetMode`` clears the rate pin outright — the engine keeps one, not one per
    family (measured 2026-07-28, ``scripts/probe_mode_rate_pin.py``). Without this
    a mode switch silently throws away the rate the user picked, and both this page
    and the Output tab fall back to the configured limit.

    A tier the entered mode does not offer is forgotten rather than approximated:
    pinning the nearest rate the engine does offer would be a rate the user never
    picked.
    """
    family = livemap.active_chain(mgr)
    hz = mgr.live_rates.get(family or "")
    if hz is None:
        return []
    index = livemap.rate_index_for(mgr, hz)
    if index is None:
        del mgr.live_rates[family or ""]
        return []
    return await apply_live(client, {"rate": {"value": index}})


async def apply_now(mgr: ConnectionManager, fields: dict[str, str]) -> dict[str, Any]:
    """Resolve, apply and readback-verify a batch of LIVE config-form fields."""
    client = mgr.control
    if client is None:
        raise ControlError("daemon not connected")
    edits = livemap.resolve_live(mgr, fields)
    report = await apply_live(client, edits)
    mgr.state = await client.get_state()  # live edits bypass the file: refresh running truth
    if _REENUMERATES & set(edits):
        mgr.enums = await client.get_all_enumerations()
    if _applied(report, "rate"):
        _remember_rate(mgr, fields["rate"])
    if _applied(report, "mode"):
        # after the re-enumeration above: the rates list is mode-dependent
        # (manual §4.6), so the remembered rate resolves against the NEW list
        report = report + await _reassert_rate(mgr, client)
        mgr.state = await client.get_state()
    return {"live": report}
