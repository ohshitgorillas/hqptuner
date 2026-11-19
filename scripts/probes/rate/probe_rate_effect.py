#!/usr/bin/env python3
"""Probe whether a rate pin moves the OUTPUT rate mid-stream, or only `State.rate`.

`scripts/probes/rate/probe_rate_playing.py` established that `SetRate` takes in an explicit
mode and is ignored in `[source]`. It also left one thing unexplained: the pin
that took (`State.rate="9"`, 705600 Hz) did not move `Status.active_rate`, which
stayed at 1411200. Two readings fit that, and they mean very different things for
the LIVE page:

  1  the pin applies at the next stream start, so a mid-playback rate change is
     recorded but not heard — the LIVE rate control would then be misleading in
     EVERY mode, not just `[source]`
  2  `active_rate` simply had not caught up in the moment it was read

So: pin two different rates in explicit PCM, giving each a full second and a
fresh `Status` read, and watch whether `active_rate` follows `State.rate`.

  A  pin 352800   8x the 44.1k source
  B  pin 176400   4x, a clear step down from A
  C  restore      the mode and rate as found, verified by `State` readback

**Writes only live settings** — mode and the rate pin, both memory-only. No config
write, no `/restore`, no daemon restart. Runs mid-playback deliberately: a pin
that only lands between streams is exactly what this is looking for. `SetMode`
pauses audio briefly while the engine reorients. Run with the listener's say-so
(granted 2026-07-29, drive test).

    .venv/bin/python scripts/probes/rate/probe_rate_effect.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "kit"))

from probekit import PIN_TARGETS, SETTLE_WAIT, connect_playing, index_of, mode_index, restore_live

from hqptuner.engine.control import ControlClient


async def _pin(client: ControlClient, hz: str, rates: list[dict[str, str]]) -> None:
    """Pin one rate, let the engine settle, and report State against Status."""
    index = index_of(rates, hz)
    if index is None:
        print(f"\n  {hz} has no index in the running list — skipped")
        return
    print(f"\n--- pin {hz} (index {index})")
    await client.set_command("SetRate", value=index)
    await asyncio.sleep(SETTLE_WAIT)
    state = await client.get_state()
    status, _meta = await client.get_status()
    active = status.get("active_rate")
    print(f"  State.rate = {state.get('rate')!r} (want {index!r})   Status.active_rate = {active!r}")
    took = "pin recorded" if state.get("rate") == index else "PIN IGNORED"
    heard = "output followed" if active == hz else "OUTPUT DID NOT FOLLOW"
    print(f"  VERDICT: {took}, {heard}")


async def main() -> int:
    """Establish whether a rate pin in explicit PCM moves the output mid-stream or only the State.rate slot."""
    started = await connect_playing("this probe needs a running transport")
    if started is None:
        return 1
    client, original_mode, original_rate = started
    status, meta = await client.get_status()
    meta = meta or {}
    print(f"mode {original_mode!r}, rate {original_rate!r}, active_rate {status.get('active_rate')!r}")
    print(f"source: samplerate {meta.get('samplerate')!r} bits {meta.get('bits')!r} sdm {meta.get('sdm')!r}")

    pcm = mode_index(await client.get_enumeration("GetModes"), "PCM")
    if pcm is None:
        print("no PCM mode in GetModes — aborting, nothing changed")
        return 1
    if original_mode != pcm:
        print(f"\n--- SetMode PCM (index {pcm}) so the pin is accepted at all")
        await client.set_command("SetMode", value=pcm)
        await asyncio.sleep(SETTLE_WAIT)
    rates = await client.get_enumeration("GetRates")
    for hz in PIN_TARGETS:
        await _pin(client, hz, rates)

    print(f"\n--- restore mode {original_mode!r}, rate {original_rate!r}")
    return await restore_live(client, original_mode, original_rate)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
