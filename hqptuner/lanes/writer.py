"""Write-path orchestration (Phase 3).

Applies a staged change set to the live daemon:

- **live lane** — Control API (4321) setters, each confirmed by a `State`
  readback (`result="OK"` is not proof of application, protocol.md §6);
- **http lane** — NOT a form POST despite the name: the persistent lane edits
  the running config XML and pushes it with `POST /restore` (`scope=system`),
  on which the daemon self-restarts in ~5.6 s (`lanes/http/restore.py`,
  settings-classification.md). The connection manager's outage path handles
  the restart/resync. There is no `POST /config` route in this codebase.

Live edits apply in a fixed safe order: mode first (it resets rate to auto and
swaps the enumeration lists the other indices are relative to), then filter,
shaper, junk filter, adaptive volume, volume. No idle gate — live
settings apply immediately even during playback: the engine reorients and audio
pauses briefly before resuming. Nothing here restarts the daemon or drops the
client; that is the http lane's `POST /restore`, above.
"""

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import Enum
from typing import Literal, NamedTuple

from hqptuner.audit import AuditLog
from hqptuner.engine.control import ControlClient, Reply
from hqptuner.engine.controlerrors import CommandError

_VOLUME_TOLERANCE = 0.05
# a decimal level as the volume control sends it: sign, digits, optional fraction and exponent
_NUMBER = re.compile(r"\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*")

# A setter answers with the daemon's refusal, or None when its readback verified.
Handler = Callable[[ControlClient, dict[str, str]], Awaitable[CommandError | None]]


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
        """Render the mismatch wording naming the wanted and the read-back value."""
        super().__init__(f"Volume readback mismatch: want {want} got {got}")


class LiveSetting(NamedTuple):
    """A setting the Control API sets with one ``value`` attribute and reports back under one ``State`` attribute.

    Set it, read State, done.
    """

    command: str  # Control API element name
    state: str  # State attribute carrying it back


async def _verified(client: ControlClient, reply: Reply, expected: dict[str, str]) -> CommandError | None:
    """Return the daemon's refusal of ``reply``, else the State readback's mismatch against ``expected``."""
    refused = reply.refusal()
    if refused is not None:
        return refused
    return await client.state_mismatch(expected)


async def _apply_filter(client: ControlClient, params: dict[str, str]) -> CommandError | None:
    nx = params["value"]
    x1 = params.get("value1x")
    # value alone sets both 1x and Nx; value1x splits them (protocol.md §6)
    reply = await client.send_filter(nx, x1)
    return await _verified(client, reply, {"filterNx": nx, "filter1x": x1 if x1 is not None else nx})


async def _apply_volume(client: ControlClient, params: dict[str, str]) -> CommandError | None:
    want = params["value"]
    refused = (await client.send_volume(want)).refusal()
    if refused is not None:
        return refused
    state = await client.get_state()  # volume is a float — verify with tolerance
    got = state.get("volume")
    if got is None or abs(float(got) - float(want)) > _VOLUME_TOLERANCE:
        return VolumeMismatchError(want=want, got=got)
    return None


# The live lane, one row per setting — and INSERTION ORDER IS APPLY ORDER, so a
# new live setting is one row here rather than an entry in an order tuple, an
# entry in a handler map and a setter wrapper that can drift from either.
#
# `filter` and `volume` carry their own handler because they are genuinely not
# the uniform shape: SetFilter takes two arguments (1x and Nx), and volume is a
# float that must be verified with a tolerance rather than compared for equality.
SETTINGS: dict[str, LiveSetting | Handler] = {
    "mode": LiveSetting("SetMode", "mode"),
    "filter": _apply_filter,
    "shaper": LiveSetting("SetShaping", "shaper"),
    "junk_filter": LiveSetting("SetJunkFilter", "filter_junk"),
    "adaptive_volume": LiveSetting("SetAdaptiveVolume", "adaptive"),
    "volume": _apply_volume,
}


def known_live_settings() -> tuple[str, ...]:
    """Return the live-lane setting keys the write path understands, in apply order."""
    return tuple(SETTINGS)


async def apply_live(
    client: ControlClient, edits: dict[str, dict[str, str]], audit: AuditLog | None = None
) -> list[LiveWriteResult]:
    """Apply each live edit in the safe order, verifying by readback.

    One refused edit does not abort the rest — each reports its own outcome. A ``ControlError``
    (a dead transport is not an answer) propagates and aborts the batch.

    ``audit`` arrives from the caller rather than a module-level handle so this
    stays a pure function of its arguments; omitting it logs nothing.
    """
    log = audit if audit is not None else AuditLog(None)
    report: list[LiveWriteResult] = []
    for setting in SETTINGS:
        if setting not in edits:
            continue
        report.append(await _apply_one(client, setting, edits[setting], log))
    return report


async def _apply_uniform(client: ControlClient, spec: LiveSetting, params: dict[str, str]) -> CommandError | None:
    value = params["value"]
    reply = await client.send(spec.command, value=value)
    return await _verified(client, reply, {spec.state: value})


def _malformed(setting: str, params: dict[str, str]) -> str | None:
    """Return why an edit cannot be sent at all, or None when it is well formed.

    Checked before the wire is touched: every setter reads ``value``, and volume parses it as a number.
    """
    if "value" not in params:
        return str(KeyError("value"))
    if setting == "volume" and _NUMBER.fullmatch(params["value"]) is None:
        return f"could not convert string to float: {params['value']!r}"
    return None


async def _send(client: ControlClient, setting: str, params: dict[str, str]) -> CommandError | None:
    spec = SETTINGS[setting]
    if isinstance(spec, LiveSetting):
        return await _apply_uniform(client, spec, params)
    return await spec(client, params)


async def _apply_one(client: ControlClient, setting: str, params: dict[str, str], audit: AuditLog) -> LiveWriteResult:
    value = params.get("value", "")
    malformed = _malformed(setting, params)
    if malformed is not None:
        audit.live_write(setting, value, None, ok=False)
        return LiveWriteFailed(setting=setting, error=malformed, code="invalid_input")
    # daemon_refused for a refusal or a readback mismatch: the refusal's own code is the verdict
    refused = await _send(client, setting, params)
    if refused is not None:
        audit.live_write(setting, value, None, ok=False)
        return LiveWriteFailed(setting=setting, error=str(refused), code=refused.code)
    # no refusal means the readback matched, so the value sent is also the
    # value confirmed — there is no other way for a setter to succeed
    audit.live_write(setting, value, value, ok=True)
    return LiveWriteOk(setting=setting)
