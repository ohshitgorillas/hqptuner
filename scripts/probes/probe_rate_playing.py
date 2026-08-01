#!/usr/bin/env python3
"""Probe: what eats a live `SetRate` — playback, or `[source]` mode?

Every earlier rate measurement (protocol.md:236, :237) was taken with the engine
**stopped** and in an explicit PCM/SDM mode. protocol.md:213 says so outright:
"Behavior during active playback unobserved." Observed on Opal 2026-07-29,
playing 24/44.1 through Roon in `[source]` mode, `SetRate value="9"` (705600 Hz,
the index the running list carries) returned `result="OK"` and left `State.rate`
at `"0"` — which is the mismatch `control.verify_state` reports and the LIVE page
shows the user.

Two candidate causes, indistinguishable from reads:

  1  the engine ignores a rate pin while `mode` is `[source]`, because in that
     mode the output rate follows the source (readme §1.7)
  2  the engine ignores a rate pin while the transport is running, whatever the
     mode

Three measurements separate them:

  A  pin in [source]   SetRate to a tier the running list carries, mode left at
                       [source]. Reproduces the report.
  B  pin in PCM        SetMode PCM, re-enumerate, pin the same Hz by its index
                       in the NEW list. Takes -> cause 1. Ignored too -> cause 2.
  C  restore           original mode and rate back, verified by State readback.

Also records `Status.active_mode` at every step: HQPTuner reads it to decide
which filter chain is loaded (`livemap._chain_from_status`), and in `[source]`
it appears to echo `[source]` rather than resolving to PCM/SDM.

**Writes only live settings** — mode and the rate pin, both memory-only. No
config write, no `/restore`, no daemon restart. Unlike this repo's other write
probes it runs WHILE PLAYING and deliberately so: that is the condition under
test. `SetMode` pauses audio briefly while the engine reorients. Run it only
with the listener's say-so (granted 2026-07-29 for this drive test).

    .venv/bin/python scripts/probes/probe_rate_playing.py
"""

import asyncio
import sys

from hqptuner.engine.control import ControlClient

PIN_HZ = "705600"
PCM_MODE_NAME = "PCM"


def _rates(items: list[dict[str, str]]) -> str:
    """The enumeration as `index:rate` pairs, short enough to read in one line."""
    return " ".join(f"{item.get('index')}:{item.get('rate')}" for item in items) or "(empty)"


def _index_of(items: list[dict[str, str]], hz: str) -> str | None:
    """The `RatesItem` index carrying this rate in Hz, or None if absent."""
    return next((str(item["index"]) for item in items if str(item.get("rate")) == hz), None)


def _mode_index(items: list[dict[str, str]], name: str) -> str | None:
    """The index of the mode whose display name starts with this."""
    return next((str(i["index"]) for i in items if str(i.get("name", "")).upper().startswith(name)), None)


async def _report(client: ControlClient, label: str) -> dict[str, str]:
    """Everything that could carry the answer, after one write."""
    state = await client.get_state()
    status, meta = await client.get_status()
    print(f"  {label}")
    print(f"    State.mode/rate/state = {state.get('mode')!r} {state.get('rate')!r} {state.get('state')!r}")
    print(f"    Status.active_mode    = {status.get('active_mode')!r}")
    print(f"    Status.active_rate    = {status.get('active_rate')!r}")
    print(f"    metadata.samplerate   = {meta.get('samplerate')!r}  sdm={meta.get('sdm')!r}")
    return state


async def main() -> int:
    client = ControlClient()
    await client.connect()
    state = await client.get_state()
    original_mode, original_rate = state.get("mode"), state.get("rate")
    if original_mode is None or original_rate is None:
        print("State reports no mode/rate — aborting, nothing changed")
        return 1
    if state.get("state") != "2":
        print(f"engine not playing (state={state.get('state')!r}) — this probe needs a running transport")
        return 1
    modes = await client.get_enumeration("GetModes")
    rates = await client.get_enumeration("GetRates")
    print(f"original mode index {original_mode!r}, rate index {original_rate!r}")
    print(f"GetRates before = {_rates(rates)}")
    await _report(client, "baseline")

    print(f"\n--- A  pin {PIN_HZ} in the mode as found")
    index = _index_of(rates, PIN_HZ)
    if index is None:
        print(f"  {PIN_HZ} has no index in the running list — aborting, nothing changed")
        return 1
    await client.set_command("SetRate", value=index)
    print(f"  SetRate value={index} -> result=OK")
    after_a = await _report(client, "after A")
    print(f"  VERDICT A: pin {'took' if after_a.get('rate') == index else 'IGNORED'}")

    pcm = _mode_index(modes, PCM_MODE_NAME)
    if pcm is None:
        print("\nno PCM mode in GetModes — skipping B")
    else:
        print(f"\n--- B  SetMode PCM (index {pcm}), then pin {PIN_HZ} in the new list")
        await client.set_command("SetMode", value=pcm)
        await _report(client, "after SetMode")
        rates_pcm = await client.get_enumeration("GetRates")
        print(f"    GetRates after SetMode = {_rates(rates_pcm)}")
        index_pcm = _index_of(rates_pcm, PIN_HZ)
        if index_pcm is None:
            print(f"  {PIN_HZ} has no index in the PCM list — skipping the pin")
        else:
            await client.set_command("SetRate", value=index_pcm)
            print(f"  SetRate value={index_pcm} -> result=OK")
            after_b = await _report(client, "after B")
            print(f"  VERDICT B: pin {'took' if after_b.get('rate') == index_pcm else 'IGNORED'}")

    print(f"\n--- C  restore mode {original_mode!r}, rate {original_rate!r}")
    await client.set_command("SetMode", value=original_mode)
    await client.set_command("SetRate", value=original_rate)
    final = await _report(client, "after restore")
    if (final.get("mode"), final.get("rate")) != (original_mode, original_rate):
        print(f"  RESTORE MISMATCH: want {(original_mode, original_rate)!r}")
        return 1
    print("  restored, verified by readback")
    await client.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
