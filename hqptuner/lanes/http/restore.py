"""Persistent config write lane (HTTP 8088) — a self-contained lane with its own retry/verify loop.

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
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Literal

import httpx

from hqptuner import voltrace
from hqptuner.conf import engineconf, httpauth, presetconf, presetzip
from hqptuner.conf.matrixpayload import parse_delete
from hqptuner.conf.matrixprofiles import (
    MATRIX_PROFILE_DELETE,
    MATRIX_PROFILE_SAVE,
    MATRIX_PROFILES,
)
from hqptuner.conf.matrixscope import has_profile
from hqptuner.errors import HQPTunerError
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


class RestoreOutcome(Enum):
    """What a persistent (restore-lane) apply came back with."""

    NOT_SUBMITTED = "not_submitted"  # never got a write through, or the edit could not be built
    APPLIED = "applied"  # converged: the running config now reflects the intended fields
    UNCONVERGED = "unconverged"  # submitted, but the running config never matched after the retries
    UNAVAILABLE = "unavailable"  # submitted, unconverged, and unfixable (an endpoint is gone)


Diff = dict[str, dict[str, str | None]]


class RestoreWriteFailedError(HQPTunerError):
    """No restore pass got a write through to the daemon: every one died on the wire."""

    code = "daemon_write_failed"

    def __init__(self, *, passes: int) -> None:
        """Render the wording naming how many passes were tried."""
        super().__init__(
            f"Could not reach HQPlayer to restore your settings after {passes} attempts. "
            "Check that HQPlayer is running, then try again."
        )


@dataclass(frozen=True)
class UnfixableDevice:
    """An intended output endpoint absent from the daemon's offered endpoints, beside the endpoints it offers."""

    want: str | None
    available: list[str]


@dataclass(frozen=True)
class RestoreDeclined:
    """A lane that was never usable for this apply: no client, or a credential already refused. Fields are wire keys."""

    error: str
    code: str

    @property
    def outcome(self) -> RestoreOutcome:
        """The verdict as one enum."""
        return RestoreOutcome.NOT_SUBMITTED


@dataclass(frozen=True)
class RestoreConverged:
    """A running config that reflects every field this apply wrote, after ``attempts`` passes. Fields are wire keys."""

    attempts: int
    active: str | None
    applied: Literal[True] = field(default=True, init=False)

    @property
    def outcome(self) -> RestoreOutcome:
        """The verdict as one enum."""
        return RestoreOutcome.APPLIED


@dataclass(frozen=True)
class RestoreUnconverged:
    """A running config that never matched after the retries; ``diff`` says what diverged. Fields are wire keys."""

    diff: Diff
    reason: Literal[RestoreOutcome.UNCONVERGED] = field(default=RestoreOutcome.UNCONVERGED, init=False)

    @property
    def outcome(self) -> RestoreOutcome:
        """The verdict as one enum."""
        return RestoreOutcome.UNCONVERGED


@dataclass(frozen=True)
class RestoreUnavailable:
    """A divergence made final by an endpoint that is gone, named in ``unfixable``. Fields are wire keys."""

    diff: Diff
    unfixable: dict[str, UnfixableDevice]
    reason: Literal[RestoreOutcome.UNAVAILABLE] = field(default=RestoreOutcome.UNAVAILABLE, init=False)

    @property
    def outcome(self) -> RestoreOutcome:
        """The verdict as one enum."""
        return RestoreOutcome.UNAVAILABLE


RestoreResult = RestoreDeclined | RestoreConverged | RestoreUnconverged | RestoreUnavailable


def verified_keys(merged: dict[str, str], intended: dict[str, str]) -> set[str]:
    """Return the fields this apply is entitled to hold itself to.

    The ones it actually wrote, plus the readback key a write-only verb is proven by.

    NOT the whole grounded surface. ``intended`` is the entire running config with
    the edits folded in, so diffing all of it demands that every untouched setting
    survive a daemon restart byte-identically — one field the daemon normalizes on
    its own (or one this build serializes differently than it parses) then wedges
    EVERY apply, forever, on a config the user cannot see is at fault. Applies are
    incremental against the running config (``restore_zip_from_running``), so the
    edits are the contract; the rest of the file is not this apply's business.
    """
    keys = {k for k in merged if k in intended}
    return keys | {_PROVEN_BY[k] for k in merged if k in _PROVEN_BY}


def config_diff(intended: dict[str, str], realized: dict[str, str], keys: set[str]) -> dict[str, dict[str, str | None]]:
    """Fields where the running config didn't match what the apply intended."""
    return {k: {"want": intended.get(k), "got": realized.get(k)} for k in keys if realized.get(k) != intended.get(k)}


@dataclass(frozen=True)
class PassVerdict:
    """One judged restore pass: what diverged, and the gone endpoint that makes the divergence final."""

    diff: Diff
    unfixable: UnfixableDevice | None

    @property
    def final(self) -> bool:
        """Whether another pass could not change the answer: converged, or an endpoint is gone."""
        return not self.diff or self.unfixable is not None


async def apply(mgr: ConnectionManager, edits: dict[str, str], *, switched: bool = False) -> RestoreResult:
    """Apply ``edits`` to the running config via POST /restore, then verify and self-correct.

    ``switched`` marks an apply that just loaded a different preset: the restart
    dropped the live matrix profile (the daemon persists the selection nowhere,
    readme §1.12), and the cached state still names the OLD preset's profile —
    adopting it would install that profile into the preset just switched to.

    Each pass: fetch a fresh /backup, build a restore archive whose
    working config is the running config with edits applied (plus the forced
    auto-family fields), restore, and read the running config back. Converged →
    done. Diverged but correctable → retry. Diverged on a net_device the daemon
    no longer offers (endpoint gone) → unfixable: surface and stop, since no
    restart conjures absent hardware.

    Raises ``HttpLaneDeclinedError`` when the lane is not usable, settled before the
    first pass: every pass opens with ``await_http_ready``, which polls to the alarm
    deadline, so a daemon that has already refused us would cost three deadlines to
    say what the poll loop established long ago. Raises ``RestoreWriteFailedError``
    when no pass got a write through at all, and ``GroundingError`` for an edit that
    cannot be built against the running config.
    """
    declined = httpauth.decline_error(mgr)
    if declined is not None:
        raise declined
    # the restore restarts the daemon onto the config it carries, and a live edit
    # never reached that file — so the running values for those settings ride
    # along (store as fallback), under the staged edits, which win (presetfields)
    merged = {**presetfields.carried_live_fields(mgr), **edits, **FORCED_CONFIG}
    # the profile the listener is on: the restart comes up on <matrix>, so that
    # profile's matrix is what <matrix> has to become — unless a preset switch
    # already dropped it (profiles do not follow the listener across presets)
    active_profile = "" if switched else _active_profile(mgr, edits)
    # taken before the first pass, not inside it: a pass refused with 503 and the
    # next one adopted are one restore the caller has to outlast
    mark = settle.mark_connect(mgr)
    verdict: PassVerdict | None = None
    attempts = 0
    for attempt in range(1, _PERSIST_RETRIES + 2):
        # a preset switch (or a prior attempt) just restarted the daemon and the
        # active label flips before the restart finishes — wait for the HTTP lane
        # to actually serve before writing, rather than racing it
        await settle.await_http_ready(mgr)
        try:
            intended = await _restore_once(mgr, merged, active_profile, mark=mark)
        except httpauth.AuthRefused as exc:
            # Terminal, not retryable: two more passes cannot turn a refused
            # password into an accepted one. Reached only when the refusal began
            # inside the window between two polls; recorded here, so the guard
            # above answers for it from now on, and its refusal is this one's.
            mgr.readings.credentials_ok = False
            declined = httpauth.decline_error(mgr)
            if declined is not None:
                raise declined from exc
            raise
        except httpx.HTTPError as exc:
            # the daemon dropped mid-write: transient, so the next pass retries.
            # A pass that dies must not erase the divergence an earlier one found:
            # a daemon that accepts the restore and then dies is unconverged.
            log.warning("restore pass %d dropped mid-write: %s", attempt, exc)
            await mgr.clock.sleep(RECONNECT_FAST)
            continue
        verdict, attempts = await _judge(mgr, merged, intended, attempt), attempt
        if verdict.final:
            break
    return await _outcome(mgr, mark, verdict, attempts)


async def _outcome(
    mgr: ConnectionManager, mark: settle.Mark | None, verdict: PassVerdict | None, attempts: int
) -> RestoreResult:
    """Answer for the passes that ran: the last judged one decides, and none judged means none got through."""
    if verdict is None:
        raise RestoreWriteFailedError(passes=_PERSIST_RETRIES + 1)
    if verdict.final:
        # the restore restarted the daemon and `verify` proves only that the
        # 8088 lane serves the new config; the 4321 control connection is still
        # the dead one, so wait for the reconnect before answering the user
        await settle.await_ready(mgr, mark)
    if not verdict.diff:
        return RestoreConverged(attempts, mgr.readings.active_config)
    if verdict.unfixable is None:
        return RestoreUnconverged(verdict.diff)
    return RestoreUnavailable(verdict.diff, {presetconf.NET_DEVICE: verdict.unfixable})


def _active_profile(mgr: ConnectionManager, edits: dict[str, str]) -> str:
    """Return the matrix profile this apply should install as the live matrix.

    Empty for the default matrix, and empty too when this batch deletes the
    profile that is active — a matrix about to be removed is not one to adopt.
    """
    name = (mgr.readings.state or {}).get("matrix_profile", "")
    if not name or MATRIX_PROFILE_DELETE not in edits:
        return name
    return "" if parse_delete(edits[MATRIX_PROFILE_DELETE])[0] == name else name


async def _judge(mgr: ConnectionManager, merged: dict[str, str], intended: dict[str, str], attempt: int) -> PassVerdict:
    """Read the running config back after one restore and say how it differs from what the pass intended."""
    keys = verified_keys(merged, intended)
    # both sides of the persistent apply, recorded whether or not it converged: a
    # pass that converges on every key it verified can still have carried the wrong
    # startup volume, and the prose warning below only fires when it does not
    voltrace.observe(mgr, "apply_intended", voltrace.subset(intended))
    realized = await verify(mgr, intended, keys)
    voltrace.observe(mgr, "apply_realized", voltrace.subset(realized))
    diff = config_diff(intended, realized, keys)
    if not diff:
        return PassVerdict(diff, None)
    # the diff is the whole diagnosis of an unconverged apply, and the UI has room
    # for field names but not for want/got pairs — so it goes to the log too
    log.warning("apply pass %d did not converge: %s", attempt, diff)
    return PassVerdict(diff, await _unfixable_device(mgr, diff))


async def _restore_once(
    mgr: ConnectionManager, merged: dict[str, str], active_profile: str = "", *, mark: settle.Mark | None
) -> dict[str, str]:
    """Build a restore archive from a fresh backup, push it, and return the intended config it should produce.

    The archive's working config is the running config ⊕ edits. ``mark`` is the caller's connect mark.

    Raises GroundingError (bad edit, or an unusable backup) or httpx.HTTPError (daemon dropped mid-write).
    """
    backup = await mgr.require_http().backup()
    mgr.presetops.persist_backup_for_restore(backup)  # survives a crash mid-apply
    # a profile the daemon holds in memory only is live but absent from the file:
    # there is no stored matrix to adopt, so the live one is left as it is
    running = presetzip.snapshot_member(backup, None, mgr.readings.active_config)
    adopt = active_profile if active_profile and has_profile(running, active_profile) else None
    # parked filter uploads ride the same restore (data/<name> members land in
    # the daemon's home dir, where staged process paths resolve)
    restore_zip, intended_xml = presetzip.restore_zip_from_running(
        backup,
        merged,
        presetzip.ApplyContext(
            active=mgr.readings.active_config,
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
    await settle.restore(mgr, restore_zip, mark=mark, scope="system")
    return presetconf.read_config(intended_xml)


async def verify(mgr: ConnectionManager, intended: dict[str, str], keys: set[str]) -> dict[str, str]:
    """Poll a fresh /backup until the running config reflects this apply's intended fields, or the deadline passes.

    The fields polled for are the ones this apply wrote (``keys``), and the deadline is the alarm deadline. Returns the
    last realized config (read from the backup's base hqplayerd.xml) so the caller can diff it — the unconverged read is
    the diff, so it is kept even when the poll gives up.
    """
    realized: dict[str, str] = {}

    async def probe() -> dict[str, str] | None:
        nonlocal realized
        fresh = await settle.fresh_backup(mgr)
        try:
            xml = None if fresh is None else engineconf.base_config_xml(fresh, mgr.readings.active_config)
        except engineconf.UnreadableArchiveError:
            xml = None
        if xml is None:
            return None
        realized = presetconf.read_config(xml)
        mgr.readings.file_config = realized  # fresh file truth for the lossy-form fields
        converged = all(realized.get(key) == intended.get(key) for key in keys)
        return realized if converged else None

    # the restore just restarted the daemon: nothing has landed yet, so spend the
    # first interval waiting rather than on a read that cannot succeed
    await mgr.clock.sleep(RECONNECT_FAST)
    return await settle.poll_until(mgr, probe, interval=RECONNECT_FAST) or realized


def _net_device_options(mgr: ConnectionManager) -> set[str] | None:
    """Endpoint values the daemon offers for net_device, off the /config form snapshot; None when there is none.

    An absent form is treated as 'no evidence', never as 'gone'.
    """
    form = mgr.readings.config_form
    if form is None:
        return None
    field = next((f for f in form["fields"] if f.get("name") == presetconf.NET_DEVICE), None)
    return {o["value"] for o in (field or {}).get("options", [])}


async def _unfixable_device(mgr: ConnectionManager, diff: Diff) -> UnfixableDevice | None:
    """Report a divergence as unfixable only when the intended net_device is no longer in the daemon's endpoint list.

    The target NAA endpoint is gone, and no restart brings it back. Everything else is correctable by retry. The
    endpoint list is re-read first: the restore restarted the daemon, so the snapshot predates it, and the refresh
    keeps whatever it last had when the daemon does not answer.
    """
    if presetconf.NET_DEVICE not in diff:
        return None
    await mgr.refresh_http_forms()
    want = diff[presetconf.NET_DEVICE]["want"]
    options = _net_device_options(mgr)
    if options is None or want in options:
        return None
    return UnfixableDevice(want, sorted(o for o in options if o))
