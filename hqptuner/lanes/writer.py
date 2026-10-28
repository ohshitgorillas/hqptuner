"""Write-path orchestration.

Applies a staged change set to the live daemon:

- **live lane** — Control API (4321) setters, each confirmed by a `State`
  readback (`result="OK"` is not proof of application);
- **http lane** — NOT a form POST despite the name: the persistent lane edits
  the running config XML and pushes it with `POST /restore` (`scope=system`),
  on which the daemon self-restarts in ~5.6 s (`lanes/http/restore.py`). The
  connection manager's outage path handles the restart/resync. There is no `POST /config` route in this codebase.

Live edits apply in a fixed safe order: mode first (it resets rate to auto and
swaps the enumeration lists the other indices are relative to), then filter,
shaper, the pinned rate, junk filter, adaptive volume, volume. The pinned rate
(`SetRate`) is sent only by the LIVE lane, alone in its batch
(`lanes/live/rate`), never from the pending buffer. No idle gate — live
settings apply immediately even during playback: the engine reorients and audio
pauses briefly before resuming. Nothing here restarts the daemon or drops the
client; that is the http lane's `POST /restore`, above.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum
from typing import Literal

from hqptuner.audit import AuditLog
from hqptuner.engine.control import ControlClient, state_mismatch_of
from hqptuner.engine.controlerrors import CommandError, ControlError, readback_mismatch
from hqptuner.engine.view import out_of_domain, says
from hqptuner.fields import query
from hqptuner.fields.model import Setter

# Told the setting whose write a dropped connection interrupted, before the ``ControlError`` propagates.
Interrupted = Callable[[str], None]


class LiveWriteOutcome(Enum):
    """Whether a live-lane setter's write verified by readback."""

    OK = "ok"
    FAILED = "failed"


@dataclass(frozen=True)
class LiveWriteOk:
    """A live-lane setter whose readback verified. The fields are the wire keys."""

    setting: str
    ok: Literal[True] = field(default=True, init=False)

    @property
    def outcome(self) -> LiveWriteOutcome:
        """The verdict as an enum, for callers that branch on it."""
        return LiveWriteOutcome.OK


@dataclass(frozen=True)
class LiveWriteFailed:
    """A live-lane setter that did not verify, with the reason and its code. The fields are the wire keys."""

    setting: str
    error: str
    code: str
    ok: Literal[False] = field(default=False, init=False)

    @property
    def outcome(self) -> LiveWriteOutcome:
        """The verdict as an enum, for callers that branch on it."""
        return LiveWriteOutcome.FAILED


# One live-lane setter's outcome — the setting written, and whether its readback verified.
LiveWriteResult = LiveWriteOk | LiveWriteFailed


class ToleranceMismatchError(CommandError):
    """A post-apply numeric readback landed outside its setter's ``tolerance`` of what was set."""

    def __init__(self, *, setting: str, want: str, got: str | None) -> None:
        """Render the ``readback_mismatch`` sentence for ``setting``, naming the wanted and the read-back value."""
        super().__init__(readback_mismatch(setting, want, got))


def _sent_args(setter: Setter, params: dict[str, str]) -> dict[str, str]:
    """Return each of ``setter``'s readback arguments the edit gives, as the command carries them."""
    return {arg: params[arg] for arg in query.readback(setter) if arg in params}


def _expected(setter: Setter, params: dict[str, str]) -> dict[str, str]:
    """Return each State attribute ``setter``'s readback reads with the value the edit wants it to hold.

    An argument the edit omits reads back as the edit's ``value`` when the setter's ``value_fills``.
    """
    return {
        state: params.get(arg, params[query.PRIMARY]) if setter.value_fills else params[arg]
        for arg, state in query.readback(setter).items()
    }


def _mismatch(setter: Setter, expected: dict[str, str], state: dict[str, str]) -> CommandError | None:
    """Return how ``state`` misses what ``expected`` wants, or None when it holds it.

    A setter with a ``tolerance`` reads back a number, matched within it; every other setter matches State exactly.
    """
    if setter.tolerance is None:
        return state_mismatch_of(expected, state)
    for attr, want in expected.items():
        got = state.get(attr)
        if got is None or abs(float(got) - float(want)) > setter.tolerance:
            return ToleranceMismatchError(setting=setter.key, want=want, got=got)
    return None


async def _written(client: ControlClient, setter: Setter, params: dict[str, str]) -> CommandError | None:
    """Send ``setter``'s command and return the daemon's refusal, else the readback's mismatch, else None."""
    refused = (await client.send(setter.command, **_sent_args(setter, params))).refusal()
    if refused is not None:
        return refused
    state, refused = await client.state_readback()
    if refused is not None:
        return refused
    return _mismatch(setter, _expected(setter, params), state)


async def apply_live(
    client: ControlClient,
    edits: dict[str, dict[str, str]],
    audit: AuditLog | None = None,
    *,
    on_interrupted: Interrupted | None = None,
) -> list[LiveWriteResult]:
    """Apply each live edit in the register's setter order, verifying by readback.

    One refused edit does not abort the rest — each reports its own outcome. A ``ControlError``
    (a dead transport is not an answer) propagates and aborts the batch, after the edit it
    interrupted is audited as unverified and named to ``on_interrupted``, so a caller can tell
    the setting in flight from the ones never sent.

    ``audit`` arrives from the caller rather than a module-level handle so this
    stays a pure function of its arguments; omitting it logs nothing.
    """
    log = audit if audit is not None else AuditLog(None)
    report: list[LiveWriteResult] = []
    for setter in query.setters():
        if setter.key not in edits:
            continue
        try:
            report.append(await _apply_one(client, setter, edits[setter.key], log))
        except ControlError:
            if on_interrupted is not None:
                on_interrupted(setter.key)
            raise
    return report


def _malformed(setter: Setter, params: dict[str, str]) -> str | None:
    """Return why an edit cannot be sent at all, or None when it is well formed.

    Checked before the wire is touched: every setter reads ``value``, and each field the setter writes whose
    argument the edit carries must hold a value of its domain.
    """
    if query.PRIMARY not in params:
        return str(KeyError(query.PRIMARY))
    for row in query.written_by(setter):
        value = None if row.live is None else params.get(row.live.arg)
        refused = None if value is None else out_of_domain(row, value)
        if refused is not None:
            return says(refused)
    return None


async def _apply_one(client: ControlClient, setter: Setter, params: dict[str, str], audit: AuditLog) -> LiveWriteResult:
    setting = setter.key
    value = params.get(query.PRIMARY, "")
    malformed = _malformed(setter, params)
    if malformed is not None:
        audit.live_write(setting, value, None, ok=False)
        return LiveWriteFailed(setting=setting, error=malformed, code="invalid_input")
    # daemon_refused for a refusal or a readback mismatch: the refusal's own code is the verdict
    try:
        refused = await _written(client, setter, params)
    except ControlError:
        # the write may have reached the engine, so it is on the record, unverified, before it propagates
        audit.live_write(setting, value, None, ok=False)
        raise
    if refused is not None:
        audit.live_write(setting, value, None, ok=False)
        return LiveWriteFailed(setting=setting, error=str(refused), code=refused.code)
    # no refusal means the readback matched, so the value sent is also the
    # value confirmed — there is no other way for a setter to succeed
    audit.live_write(setting, value, value, ok=True)
    return LiveWriteOk(setting=setting)
