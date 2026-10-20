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

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from enum import Enum
from typing import Literal

from hqptuner.audit import AuditLog
from hqptuner.engine.control import ControlClient, Reply
from hqptuner.engine.controlerrors import CommandError, ControlError, readback_mismatch
from hqptuner.fields import query
from hqptuner.fields.model import Decimal, Setter

_VOLUME_TOLERANCE = 0.05

# A setter answers with the daemon's refusal, or None when its readback verified.
Handler = Callable[[ControlClient, Setter, dict[str, str]], Awaitable[CommandError | None]]

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


class VolumeMismatchError(CommandError):
    """A post-apply volume readback landed outside ``_VOLUME_TOLERANCE`` of what was set."""

    def __init__(self, *, want: str, got: str | None) -> None:
        """Render the ``readback_mismatch`` sentence for ``volume``, naming the wanted and the read-back value."""
        super().__init__(readback_mismatch("volume", want, got))


async def _sent(client: ControlClient, setter: Setter, params: dict[str, str]) -> Reply:
    """Send ``setter``'s command with each of its readback arguments the edit gives, and return the answer."""
    return await client.send(setter.command, **{arg: params[arg] for arg in setter.readback if arg in params})


async def _verified(client: ControlClient, reply: Reply, expected: dict[str, str]) -> CommandError | None:
    """Return the daemon's refusal of ``reply``, else the State readback's mismatch against ``expected``."""
    refused = reply.refusal()
    if refused is not None:
        return refused
    return await client.state_mismatch(expected)


async def _apply_uniform(client: ControlClient, setter: Setter, params: dict[str, str]) -> CommandError | None:
    reply = await _sent(client, setter, params)
    return await _verified(client, reply, {state: params[arg] for arg, state in setter.readback.items()})


async def _apply_filter(client: ControlClient, setter: Setter, params: dict[str, str]) -> CommandError | None:
    # value alone sets both 1x and Nx; value1x splits them
    reply = await _sent(client, setter, params)
    return await _verified(
        client, reply, {state: params.get(arg, params["value"]) for arg, state in setter.readback.items()}
    )


def _volume_mismatch(want: str, got: str | None) -> VolumeMismatchError | None:
    """Return the mismatch of the volume ``got`` read back against ``want``, or None within ``_VOLUME_TOLERANCE``.

    Volume is a float, so it is verified with a tolerance rather than compared for equality.
    """
    if got is None or abs(float(got) - float(want)) > _VOLUME_TOLERANCE:
        return VolumeMismatchError(want=want, got=got)
    return None


async def _apply_volume(client: ControlClient, setter: Setter, params: dict[str, str]) -> CommandError | None:
    want = params["value"]
    refused = (await _sent(client, setter, params)).refusal()
    if refused is not None:
        return refused
    state, refused = await client.state_readback()
    if refused is not None:
        return refused
    return _volume_mismatch(want, state.get(setter.readback["value"]))


# The setters that are genuinely not the uniform shape carry their own handler: SetFilter's
# ``value`` alone sets both 1x and Nx, and volume is a float that must be verified with a
# tolerance rather than compared for equality. Every other setter is ``_apply_uniform``.
_HANDLERS: Mapping[str, Handler] = {"filter": _apply_filter, "volume": _apply_volume}


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

    Checked before the wire is touched: every setter reads ``value``, and a setter whose field is a decimal number,
    the volume, parses it as one.
    """
    if "value" not in params:
        return str(KeyError("value"))
    row = query.field(setter.key)
    if row is not None and isinstance(row.domain, Decimal) and not row.domain.accepts(params["value"]):
        return f"could not convert string to float: {params['value']!r}"
    return None


async def _apply_one(client: ControlClient, setter: Setter, params: dict[str, str], audit: AuditLog) -> LiveWriteResult:
    setting = setter.key
    value = params.get("value", "")
    malformed = _malformed(setter, params)
    if malformed is not None:
        audit.live_write(setting, value, None, ok=False)
        return LiveWriteFailed(setting=setting, error=malformed, code="invalid_input")
    # daemon_refused for a refusal or a readback mismatch: the refusal's own code is the verdict
    try:
        refused = await _HANDLERS.get(setting, _apply_uniform)(client, setter, params)
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
