"""Write-path orchestration (Phase 3).

Applies a staged change set to the live daemon:

- **live lane** — Control API (4321) setters, each confirmed by a `State`
  readback (`result="OK"` is not proof of application, protocol.md §6);
- **http lane** — NOT a form POST despite the name: the persistent lane edits
  the running config XML and pushes it with `POST /restore` (`scope=system`),
  on which the daemon self-restarts in ~5.6 s (`lanes/httplane.py`,
  settings-classification.md). The connection manager's outage path handles
  the restart/resync. There is no `POST /config` route in this codebase.

Live edits apply in a fixed safe order: mode first (it resets rate to auto and
swaps the enumeration lists the other indices are relative to), then filter,
shaper, rate, junk filter, adaptive volume, volume. No idle gate — live
settings apply immediately even during playback: the engine reorients and audio
pauses briefly before resuming. Nothing here restarts the daemon or drops the
client; that is the http lane's `POST /restore`, above.
"""

from collections.abc import Awaitable, Callable
from typing import Any, NamedTuple

from .control import ControlClient, ControlError

_VOLUME_TOLERANCE = 0.05

Handler = Callable[[ControlClient, dict[str, str]], Awaitable[None]]


class LiveSetting(NamedTuple):
    """A setting the Control API sets with a single ``value`` attribute and
    reports back under a single ``State`` attribute — set it, read State, done."""

    command: str  # Control API element name
    state: str  # State attribute carrying it back


async def _apply_filter(client: ControlClient, params: dict[str, str]) -> None:
    nx = params["value"]
    x1 = params.get("value1x")
    await client.set_filter(nx, x1)
    # value alone sets both 1x and Nx; value1x splits them (protocol.md §6)
    await client.verify_state({"filterNx": nx, "filter1x": x1 if x1 is not None else nx})


async def _apply_volume(client: ControlClient, params: dict[str, str]) -> None:
    want = params["value"]
    await client.set_volume(want)
    state = await client.get_state()  # volume is a float — verify with tolerance
    got = state.get("volume")
    if got is None or abs(float(got) - float(want)) > _VOLUME_TOLERANCE:
        raise ControlError(f"Volume readback mismatch: want {want} got {got}")


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
    "rate": LiveSetting("SetRate", "rate"),
    "junk_filter": LiveSetting("SetJunkFilter", "filter_junk"),
    "adaptive_volume": LiveSetting("SetAdaptiveVolume", "adaptive"),
    "volume": _apply_volume,
}


def known_live_settings() -> tuple[str, ...]:
    """The live-lane setting keys the write path understands, in apply order."""
    return tuple(SETTINGS)


async def apply_live(client: ControlClient, edits: dict[str, dict[str, str]]) -> list[dict[str, Any]]:
    """Apply each live edit in the safe order, verifying by readback. One edit
    failing does not abort the rest — each reports its own outcome."""
    report: list[dict[str, Any]] = []
    for setting in SETTINGS:
        if setting not in edits:
            continue
        report.append(await _apply_one(client, setting, edits[setting]))
    return report


async def _apply_uniform(client: ControlClient, spec: LiveSetting, params: dict[str, str]) -> None:
    value = params["value"]
    await client.set_command(spec.command, value=value)
    await client.verify_state({spec.state: value})


async def _apply_one(client: ControlClient, setting: str, params: dict[str, str]) -> dict[str, Any]:
    spec = SETTINGS[setting]
    try:
        if isinstance(spec, LiveSetting):
            await _apply_uniform(client, spec, params)
        else:
            await spec(client, params)
    except (ControlError, KeyError, ValueError) as exc:
        return {"setting": setting, "ok": False, "error": str(exc)}
    return {"setting": setting, "ok": True}
