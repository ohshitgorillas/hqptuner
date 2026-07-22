"""Matrix profile operations (matrix-spec step 5) — the lane logic behind
``manager.matrix_switch_profile`` / ``manager.matrix_profile_action``.

Two lanes with very different costs: ``switch_profile`` rides 4321
``MatrixSetProfile`` (live, zero reload, memory-only — reverts on daemon
restart); ``profile_action`` rides ``POST /matrix/{load,save,delete}`` with the
complete current form, which reloads the engine (~3 s) — the API idle-gates it.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import httpx

from ..control import CommandError, ControlError

log = logging.getLogger(__name__)

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
    mid-outage and serving the UI a one-action-stale picker (hand-back finding).

    ``load`` additionally preserves post-process: the daemon replaces the whole
    matrix context — crossfeed / correction / loudness included (probe finding).
    HQPTuner's contract is "the settings you send are the settings you get
    back", so the pre-load post-process slice is snapshotted and re-applied
    with a plain ``POST /matrix`` once the load settles (a second ~3 s reload
    — the price of correctness)."""
    snapshot = await mgr.require_http().matrix_post_process_fields() if action == "load" else None
    await _form_post(mgr, lambda: mgr.require_http().matrix_profile_action(action, name))
    if action in ("save", "delete"):
        await _await_profile_list(mgr, action, name)
    if snapshot is not None:
        await mgr.await_http_ready()
        await _form_post(mgr, lambda: mgr.require_http().matrix_apply(snapshot))
        if not await _verify_post_process(mgr, snapshot):
            log.warning("post-process readback did not settle to the pre-load snapshot")
    await mgr.await_http_ready()
    await mgr.refresh_http_forms()
    return {"action": action, "name": name, "profiles": mgr.matrix_profiles or []}


async def _form_post(mgr: ConnectionManager, post: Any) -> None:
    """One retry behind await_http_ready — a back-to-back form-lane op 502s
    into the previous reload window otherwise."""
    try:
        await post()
    except httpx.HTTPError:
        await mgr.await_http_ready()
        await post()


async def _verify_post_process(mgr: ConnectionManager, snapshot: dict[str, str]) -> bool:
    """Readback-verify the restored post-process slice, polling past the
    post-reload transient (device-derived fields can render empty for a beat —
    probe finding). Gives up at the alarm deadline and reports honestly."""
    deadline = mgr.monotonic() + mgr.alarm_threshold
    while mgr.monotonic() < deadline:
        try:
            if await mgr.require_http().matrix_post_process_fields() == snapshot:
                return True
        except httpx.HTTPError:
            pass
        await mgr.sleep(_PROFILE_POLL)
    return False


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
