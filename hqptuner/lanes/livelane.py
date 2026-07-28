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

from ..control import ControlError
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
    return {"live": report}
