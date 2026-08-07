#!/usr/bin/env python3
"""Probe: in `[source]` mode, does `SetRate` move the OUTPUT even though `State.rate` keeps reading `"0"`?

`scripts/probes/probe_rate_playing.py` concluded `[source]` refuses every pin. That
conclusion is not sound and this probe exists to replace it. Two flaws:

  1  it pinned 705600 while the engine was ALREADY outputting 705600, so the
     output could not have been seen to move either way
  2  it judged by `State.rate`, which is the REQUEST slot's readback, not by
     `Status.active_rate`, which is what actually comes out

The manual makes the difference load-bearing (`docs/vendor/manual/04-04-pcm.txt`
lines 15-17): "When default output mode is set to `[source]` ... this is only a
default and upper limit for output rate, specific rate is selected by the
playback engine during playback time". A daemon that honours the request as a cap
in `[source]` while reporting the request slot as `"0"` produces exactly the
reading that probe got.

So: with the mode held at `[source]`, request two rates that are BELOW what is
playing and clearly apart from each other, give each a full second, and judge by
`Status.active_rate`.

  A  request 352800   8x the 44.1k source
  B  request 176400   4x, a clear step down from A
  C  restore          mode and request slot as found, verified by readback

**Writes only live settings** — the mode (only if it has to be moved to
`[source]` at all) and the rate request, both memory-only. No config write, no
`/restore`, no daemon restart. Runs mid-playback deliberately: `[source]` selects
its rate "during playback time", so there is nothing to measure stopped. Run with
the listener's say-so (granted 2026-07-29, drive test).

    .venv/bin/python scripts/probes/probe_rate_source_effect.py
"""

import asyncio
import sys

from hqptuner.engine.control import ControlClient

SETTLE = 1.0
TARGETS = ("352800", "176400")


def _index_of(items: list[dict[str, str]], hz: str) -> str | None:
    """The `RatesItem` index carrying this rate in Hz, or None if absent."""
    return next((str(item["index"]) for item in items if str(item.get("rate")) == hz), None)


def _mode_index(items: list[dict[str, str]], name: str) -> str | None:
    """The index of the mode whose display name starts with this."""
    return next((str(i["index"]) for i in items if str(i.get("name", "")).upper().startswith(name)), None)


async def _request(client: ControlClient, hz: str, rates: list[dict[str, str]]) -> None:
    """Request one rate, let the engine settle, and judge by what comes out."""
    index = _index_of(rates, hz)
    if index is None:
        print(f"\n  {hz} has no index in the running list — skipped")
        return
    print(f"\n--- request {hz} (index {index})")
    await client.set_command("SetRate", value=index)
    await asyncio.sleep(SETTLE)
    state = await client.get_state()
    status, _meta = await client.get_status()
    active = status.get("active_rate")
    print(f"  State.rate = {state.get('rate')!r}   Status.active_rate = {active!r}   (asked for {hz})")
    slot = "slot recorded it" if state.get("rate") == index else "slot still reads auto"
    print(f"  VERDICT: {slot}, and the OUTPUT {'followed' if active == hz else 'DID NOT follow'}")


async def main() -> int:
    client = ControlClient()
    await client.connect()
    state = await client.get_state()
    original_mode, original_rate = state.get("mode"), state.get("rate")
    if original_mode is None or original_rate is None:
        print("State reports no mode/rate — aborting, nothing changed")
        return 1
    if state.get("state") != "2":
        print(f"engine not playing (state={state.get('state')!r}) — [source] picks its rate during playback")
        return 1
    status, meta = await client.get_status()
    meta = meta or {}
    print(f"mode {original_mode!r}, rate {original_rate!r}, active_rate {status.get('active_rate')!r}")
    print(f"source: samplerate {meta.get('samplerate')!r} bits {meta.get('bits')!r} sdm {meta.get('sdm')!r}")

    source_mode = _mode_index(await client.get_enumeration("GetModes"), "[SOURCE]")
    if source_mode is None:
        print("no [source] mode in GetModes — aborting, nothing changed")
        return 1
    if original_mode != source_mode:
        print(f"\n--- SetMode [source] (index {source_mode}) — the condition under test")
        await client.set_command("SetMode", value=source_mode)
        await asyncio.sleep(SETTLE)
    status, _meta = await client.get_status()
    print(f"  baseline in [source]: active_rate {status.get('active_rate')!r}")

    rates = await client.get_enumeration("GetRates")
    for hz in TARGETS:
        await _request(client, hz, rates)

    print(f"\n--- restore mode {original_mode!r}, rate {original_rate!r}")
    await client.set_command("SetMode", value=original_mode)
    await client.set_command("SetRate", value=original_rate)
    await asyncio.sleep(SETTLE)
    final = await client.get_state()
    if (final.get("mode"), final.get("rate")) != (original_mode, original_rate):
        got = (final.get("mode"), final.get("rate"))
        print(f"  RESTORE MISMATCH: want {(original_mode, original_rate)!r}, got {got!r}")
        return 1
    status, _meta = await client.get_status()
    print(f"  restored, verified by readback (active_rate now {status.get('active_rate')!r})")
    await client.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
