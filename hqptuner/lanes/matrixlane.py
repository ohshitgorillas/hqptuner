"""Matrix profile operations (matrix-spec step 5) — the lane logic behind
``manager.matrix_switch_profile`` / ``manager.matrix_profile_action``.

Two lanes with very different costs: ``switch_profile`` rides 4321
``MatrixSetProfile`` (live, zero reload, memory-only — reverts on daemon
restart); ``profile_action`` rides ``POST /matrix/{load,save,delete}`` with the
complete current form, which reloads the engine (~3 s) — the API idle-gates it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import httpx

from ..control import CommandError, ControlError

if TYPE_CHECKING:  # avoid a circular import at runtime
    from ..manager import ConnectionManager

_PROFILE_POLL = 0.5  # cadence for polling the 4321 lane back after a reload


async def switch_profile(mgr: ConnectionManager, name: str) -> dict[str, Any]:
    """Live switch + State readback + form resync."""
    client = mgr.control
    if client is None:
        raise ControlError("daemon not connected")
    await client.set_matrix_profile(name)
    mgr.state = await client.get_state()
    await mgr.refresh_http_forms()
    return {"active": mgr.state.get("matrix_profile", "")}


async def profile_action(mgr: ConnectionManager, action: str, name: str) -> dict[str, Any]:
    """Form-lane save/delete/load, then resync forms and the profile list.

    Both halves must ride out the ~3 s engine reload these ops (and any op just
    before them) trigger: the POST retries once behind ``await_http_ready`` —a
    back-to-back action otherwise 502s into the previous reload window — and the
    profile-list refresh polls the 4321 lane back instead of sampling it once
    mid-outage and serving the UI a one-action-stale picker (hand-back finding)."""
    try:
        await mgr.require_http().matrix_profile_action(action, name)
    except httpx.HTTPError:
        await mgr.await_http_ready()
        await mgr.require_http().matrix_profile_action(action, name)
    if action in ("save", "delete"):
        await _await_profile_list(mgr, action, name)
    await mgr.await_http_ready()
    await mgr.refresh_http_forms()
    return {"action": action, "name": name, "profiles": mgr.matrix_profiles or []}


async def _await_profile_list(mgr: ConnectionManager, action: str, name: str) -> None:
    """Poll MatrixListProfiles until it REFLECTS the action (save → present,
    delete → absent), not merely until it answers: the daemon acks the POST
    before its ~3 s reload (probe timing), so an immediate resync reads
    pre-reload state and serves the UI a one-action-stale picker. Gives up at
    the alarm deadline — the regular poll loop catches up eventually."""
    deadline = mgr.monotonic() + mgr.alarm_threshold
    while mgr.monotonic() < deadline:
        client = mgr.control
        if client is not None:
            try:
                profiles = await client.get_matrix_profiles()
            except (CommandError, ControlError, OSError):
                profiles = None
            if profiles is not None:
                mgr.matrix_profiles = profiles
                if (name in profiles) if action == "save" else (name not in profiles):
                    return
        await mgr.sleep(_PROFILE_POLL)
