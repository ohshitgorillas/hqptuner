"""Persistent config write lane (HTTP 8088) — a self-contained lane with its
own retry/verify loop.

The lane writes by **restore**, not by form POST: build an archive whose working
``hqplayerd.xml`` is the running config with the staged edits applied, push it to
``POST /restore`` (scope=system), and let the daemon self-restart. That is the
only route that can express settings the daemon's own ``/config`` form renders
lossily (``volume_fixed``'s 0/1/2 domain behind a bare checkbox).

Every apply is incremental against the RUNNING config, never a rebuild from the
active preset's snapshot: a rebuild resets every field the user did not stage in
that particular apply, so sequential applies clobber each other. See
``presetzip.restore_zip_from_running``.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import httpx

from hqptuner.conf import engineconf, presetconf, presetzip, xmledit
from hqptuner.conf.matrixconf import (
    MATRIX_PROFILE_DELETE,
    MATRIX_PROFILE_SAVE,
    MATRIX_PROFILES,
    parse_delete,
)
from hqptuner.conf.matrixscope import has_profile
from hqptuner.lanes import presetfields, settle

if TYPE_CHECKING:  # avoid a circular import at runtime
    from hqptuner.core.manager import ConnectionManager

log = logging.getLogger(__name__)

RECONNECT_FAST = 1.0
_PERSIST_RETRIES = 2  # corrective re-applies before giving up on a fixable divergence

# A staged edit whose readback lives under a DIFFERENT key: the profile verbs are
# write-only commands, and what proves one landed is the profile list they edit.
_PROVEN_BY = {MATRIX_PROFILE_SAVE: MATRIX_PROFILES, MATRIX_PROFILE_DELETE: MATRIX_PROFILES}

# Fields HQPTuner pins on every config write so the friendly-rate UI holds: the
# per-family Rate dropdown sets a ceiling (defaults_samplerate/defaults_bitrate)
# and the engine follows the source's 44.1/48 base — which requires auto_family
# on and the fixed sample/bit rate left on Auto. Not exposed in the UI.
FORCED_CONFIG = {"auto_family": "1", "samplerate": "0", "bitrate": "0"}


def verified_keys(merged: dict[str, str], intended: dict[str, str]) -> set[str]:
    """The fields this apply is entitled to hold itself to: the ones it actually
    wrote, plus the readback key a write-only verb is proven by.

    NOT the whole grounded surface. ``intended`` is the entire running config with
    the edits folded in, so diffing all of it demands that every untouched setting
    survive a daemon restart byte-identically — one field the daemon normalizes on
    its own (or one this build serializes differently than it parses) then wedges
    EVERY apply, forever, on a config the user cannot see is at fault. Applies are
    incremental against the running config (``restore_zip_from_running``), so the
    edits are the contract; the rest of the file is not this apply's business."""
    keys = {k for k in merged if k in intended}
    return keys | {_PROVEN_BY[k] for k in merged if k in _PROVEN_BY}


def config_diff(intended: dict[str, str], realized: dict[str, str], keys: set[str]) -> dict[str, dict[str, str | None]]:
    """Fields where the running config didn't match what the apply intended."""
    return {k: {"want": intended.get(k), "got": realized.get(k)} for k in keys if realized.get(k) != intended.get(k)}


async def apply(mgr: ConnectionManager, edits: dict[str, str]) -> dict[str, Any]:
    """Apply ``edits`` to the running config via POST /restore, then verify and
    self-correct. Each pass: fetch a fresh /backup, build a restore archive whose
    working config is the running config with edits applied (plus the forced
    auto-family fields), restore, and read the running config back. Converged →
    done. Diverged but correctable → retry. Diverged on a net_device the daemon
    no longer offers (endpoint gone) → unfixable: surface and stop, since no
    restart conjures absent hardware."""
    if mgr.http_client is None:
        return {"submitted": False, "error": "no credentials for HTTP config lane"}
    # the restore restarts the daemon onto the config it carries, and a live edit
    # never reached that file — so the active preset's stored values for those
    # settings ride along, under the staged edits, which win (presetfields)
    merged = {**presetfields.stored_live_fields(mgr), **edits, **FORCED_CONFIG}
    # the profile the listener is on: the restart comes up on <matrix>, so that
    # profile's matrix is what <matrix> has to become
    active_profile = _active_profile(mgr, edits)
    diff: dict[str, dict[str, str | None]] = {}
    last_error: str | None = None
    for attempt in range(_PERSIST_RETRIES + 1):
        final, pass_diff, pass_error = await _one_pass(mgr, merged, attempt, active_profile)
        if final is not None:
            return final
        # a transient write failure must not erase the divergence an earlier pass
        # found: a daemon that accepts the restore and then dies is unconverged,
        # not un-submitted, and the caller has to see applied=False
        if pass_diff:
            diff = pass_diff
        if pass_error is not None:
            last_error = pass_error
    if last_error is not None and not diff:
        return {"submitted": False, "error": last_error}  # never got a write through
    return {"submitted": True, "applied": False, "reason": "unconverged", "diff": diff}


def _active_profile(mgr: ConnectionManager, edits: dict[str, str]) -> str:
    """The matrix profile this apply should install as the live matrix.

    Empty for the default matrix, and empty too when this batch deletes the
    profile that is active — a matrix about to be removed is not one to adopt.
    Both staged delete shapes count (a plain name, or the fan-out JSON).
    """
    name = (mgr.state or {}).get("matrix_profile", "")
    if not name or MATRIX_PROFILE_DELETE not in edits:
        return name
    return "" if parse_delete(edits[MATRIX_PROFILE_DELETE])[0] == name else name


async def _one_pass(
    mgr: ConnectionManager, merged: dict[str, str], attempt: int, active_profile: str = ""
) -> tuple[dict[str, Any] | None, dict[str, dict[str, str | None]], str | None]:
    """One restore+verify pass. Returns ``(final, diff, error)`` — a non-None
    ``final`` is a terminal answer for the caller; otherwise the pass is
    retryable and ``diff``/``error`` describe why."""
    # a preset switch (or a prior attempt) just restarted the daemon and the
    # active label flips before the restart finishes — wait for the HTTP lane
    # to actually serve before writing, rather than racing it
    await mgr.await_http_ready()
    try:
        intended = await _restore_once(mgr, merged, active_profile)
    except xmledit.GroundingError as exc:
        return {"submitted": False, "error": str(exc)}, {}, None
    except httpx.HTTPError as exc:
        await mgr.sleep(RECONNECT_FAST)  # daemon dropped mid-write: transient, retry
        return None, {}, str(exc)
    keys = verified_keys(merged, intended)
    diff = config_diff(intended, await verify(mgr, intended, keys), keys)
    if not diff:
        final: dict[str, Any] = {
            "submitted": True,
            "applied": True,
            "attempts": attempt + 1,
            "active": mgr.active_config,
        }
        return final, {}, None
    # the diff is the whole diagnosis of an unconverged apply, and the UI has room
    # for field names but not for want/got pairs — so it goes to the log too
    log.warning("apply pass %d did not converge: %s", attempt + 1, diff)
    unfixable = await _unfixable_device(mgr, diff)
    if unfixable:
        final = {"submitted": True, "applied": False, "reason": "unavailable", "unfixable": unfixable, "diff": diff}
        return final, diff, None
    return None, diff, None


async def _restore_once(mgr: ConnectionManager, merged: dict[str, str], active_profile: str = "") -> dict[str, str]:
    """Build a restore archive (running config ⊕ edits) from a fresh backup, push
    it, and return the intended config it should produce. Raises GroundingError
    (bad edit, or an unusable backup) or httpx.HTTPError (daemon dropped
    mid-write)."""
    backup = await mgr.presetops.backup_or_cached(for_write=True)
    mgr.presetops.persist_backup(backup)  # survives a crash mid-apply
    # a profile the daemon holds in memory only is live but absent from the file:
    # there is no stored matrix to adopt, so the live one is left as it is
    running = presetzip.snapshot_member(backup, None, mgr.active_config)
    adopt = active_profile if active_profile and has_profile(running, active_profile) else None
    # parked filter uploads ride the same restore (data/<name> members land in
    # the daemon's home dir, where staged process paths resolve)
    restore_zip, intended_xml = presetzip.restore_zip_from_running(
        backup,
        merged,
        presetzip.ApplyContext(
            active=mgr.active_config,
            matrix_profile=adopt,
            audit=mgr.audit,
            extra_members=mgr.presetops.parked_filter_members(),
        ),
    )
    # under auto-save the daemon's data/cfgs mirror is only ever refreshed by a
    # restore that is happening anyway — this one qualifies
    mirror = presetfields.autosave_mirror(mgr, intended_xml)
    if mirror:
        restore_zip = engineconf.rewrite_zip(restore_zip, mirror)
    await mgr.require_http().restore(restore_zip, scope="system")
    return presetconf.read_config(intended_xml)


async def verify(mgr: ConnectionManager, intended: dict[str, str], keys: set[str]) -> dict[str, str]:
    """Poll a fresh /backup until the running config reflects every intended
    field this apply wrote (``keys``), or the alarm deadline passes. Returns the
    last realized config (read from the backup's base hqplayerd.xml) so the caller
    can diff it — the unconverged read is the diff, so it is kept even when the
    poll gives up."""
    realized: dict[str, str] = {}

    async def probe() -> dict[str, str] | None:
        nonlocal realized
        fresh = await settle.fresh_backup(mgr)
        if fresh is None:
            return None
        realized = presetconf.read_config(engineconf.base_config_xml(fresh, mgr.active_config))
        mgr.file_config = realized  # fresh file truth for the lossy-form fields
        converged = all(realized.get(key) == intended.get(key) for key in keys)
        return realized if converged else None

    # the restore just restarted the daemon: nothing has landed yet, so spend the
    # first interval waiting rather than on a read that cannot succeed
    await mgr.sleep(RECONNECT_FAST)
    return await settle.poll_until(mgr, probe, interval=RECONNECT_FAST) or realized


async def _net_device_options(mgr: ConnectionManager) -> set[str | None] | None:
    """Endpoint values the daemon currently offers for net_device, or None when
    the form can't be read (treated as 'no evidence', never as 'gone')."""
    try:
        form = await mgr.require_http().get_config()
    except httpx.HTTPError:
        return None
    field = next((f for f in form["fields"] if f.get("name") == "net_device"), None)
    return {o.get("value") for o in (field or {}).get("options", [])}


async def _unfixable_device(mgr: ConnectionManager, diff: dict[str, dict[str, str | None]]) -> dict[str, Any]:
    """A divergence is unfixable only when the intended net_device is no longer
    in the daemon's endpoint list — the target NAA endpoint is gone, and no
    restart brings it back. Everything else is correctable by retry."""
    if presetconf.NET_DEVICE not in diff:
        return {}
    want = diff[presetconf.NET_DEVICE]["want"]
    options = await _net_device_options(mgr)
    if options is None or want in options:
        return {}
    return {"net_device": {"want": want, "available": sorted(o for o in options if o)}}
