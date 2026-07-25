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
settings apply immediately even during playback (audio stops, client resets;
that is the intended behavior).
"""

from collections.abc import Awaitable, Callable
from typing import Any

from .control import ControlClient, ControlError

_ORDER = ("mode", "filter", "shaper", "rate", "junk_filter", "adaptive_volume", "volume")
_VOLUME_TOLERANCE = 0.05


async def _apply_mode(client: ControlClient, params: dict[str, str]) -> None:
    await client.set_mode(params["value"])
    await client.verify_state({"mode": params["value"]})


async def _apply_filter(client: ControlClient, params: dict[str, str]) -> None:
    nx = params["value"]
    x1 = params.get("value1x")
    await client.set_filter(nx, x1)
    # value alone sets both 1x and Nx; value1x splits them (protocol.md §6)
    await client.verify_state({"filterNx": nx, "filter1x": x1 if x1 is not None else nx})


async def _apply_shaper(client: ControlClient, params: dict[str, str]) -> None:
    await client.set_shaping(params["value"])
    await client.verify_state({"shaper": params["value"]})


async def _apply_rate(client: ControlClient, params: dict[str, str]) -> None:
    await client.set_rate(params["value"])
    await client.verify_state({"rate": params["value"]})


async def _apply_junk_filter(client: ControlClient, params: dict[str, str]) -> None:
    await client.set_junk_filter(params["value"])
    await client.verify_state({"filter_junk": params["value"]})


async def _apply_adaptive_volume(client: ControlClient, params: dict[str, str]) -> None:
    await client.set_adaptive_volume(params["value"])
    await client.verify_state({"adaptive": params["value"]})


async def _apply_volume(client: ControlClient, params: dict[str, str]) -> None:
    want = params["value"]
    await client.set_volume(want)
    state = await client.get_state()  # volume is a float — verify with tolerance
    got = state.get("volume")
    if got is None or abs(float(got) - float(want)) > _VOLUME_TOLERANCE:
        raise ControlError(f"Volume readback mismatch: want {want} got {got}")


_HANDLERS: dict[str, Callable[[ControlClient, dict[str, str]], Awaitable[None]]] = {
    "mode": _apply_mode,
    "filter": _apply_filter,
    "shaper": _apply_shaper,
    "rate": _apply_rate,
    "junk_filter": _apply_junk_filter,
    "adaptive_volume": _apply_adaptive_volume,
    "volume": _apply_volume,
}


def known_live_settings() -> tuple[str, ...]:
    """The live-lane setting keys the write path understands, in apply order."""
    return _ORDER


async def apply_live(client: ControlClient, edits: dict[str, dict[str, str]]) -> list[dict[str, Any]]:
    """Apply each live edit in the safe order, verifying by readback. One edit
    failing does not abort the rest — each reports its own outcome."""
    report: list[dict[str, Any]] = []
    for setting in _ORDER:
        if setting not in edits:
            continue
        report.append(await _apply_one(client, setting, edits[setting]))
    return report


async def _apply_one(client: ControlClient, setting: str, params: dict[str, str]) -> dict[str, Any]:
    try:
        await _HANDLERS[setting](client, params)
    except (ControlError, KeyError, ValueError) as exc:
        return {"setting": setting, "ok": False, "error": str(exc)}
    return {"setting": setting, "ok": True}
