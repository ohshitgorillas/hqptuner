#!/usr/bin/env python3
"""Probe: does `SetRate` accept a rate in Hz, and what does `State` report back?

`SetRate` is documented as taking a `RatesItem` **index** (protocol.md §6), and
that index is mode-dependent: running PCM, the list holds PCM rates only, so a
DSD tier has no index to send. protocol.md:236 notes that sending the Hz value
also returned `result="OK"` but that the test could not distinguish it from a
no-op. HQPTuner's live rate write depends on the answer twice over:

  1  can a rate be sent at all when the enumeration does not carry it — either
     because it belongs to the other output family, or because the list is
     degenerate (an idle network backend enumerates nothing but auto)?
  2  what does `State.rate` come back as afterwards? `writer._apply_uniform`
     verifies every uniform live setter by comparing the value sent to its
     `State` attribute, and `State.rate` is an INDEX. Sending Hz would make that
     comparison mismatch on a write that actually took, so `rate` needs its own
     readback rule — this says which one.

Three measurements, all in whatever mode the engine is already in (no `SetMode`,
so the enumeration lists never move underneath the readbacks):

  A  in-family Hz     96000     does a rate the list already carries take by Hz,
                                and does State report its index?
  B  out-of-family Hz 12288000  DSD256's 48k twin, sent while running PCM — the
                                case with no index at all
  C  restore                    the original pin back, verified by readback

**Writes only the live rate pin** — no config write, no `/restore`, no daemon
restart. Refuses to run unless the engine is idle (`State state="0"`): each rate
change re-syncs the DAC, and this repo's write probes do not interrupt a
listener. The original pin is put back and verified by `State` readback
(`result="OK"` is not proof, protocol.md §6) — `scripts/capture_pcm_enums.py`
is the pattern.

    .venv/bin/python scripts/probe_rate_hz.py
"""

import asyncio
import sys

from hqptuner.engine.control import ControlClient, ControlError

IN_FAMILY_HZ = "96000"
OUT_OF_FAMILY_HZ = "12288000"


def _rates(items: list[dict[str, str]]) -> str:
    """The enumeration as `index:rate` pairs, short enough to read in one line."""
    return " ".join(f"{item.get('index')}:{item.get('rate')}" for item in items) or "(empty)"


async def _observe(client: ControlClient, label: str, hz: str) -> None:
    """Send one rate in Hz and report everything that could carry the answer."""
    print(f"\n--- {label}: SetRate value={hz}")
    try:
        await client.set_command("SetRate", value=hz)
    except ControlError as exc:
        print(f"  refused: {exc}")
        return
    print("  result=OK")
    state = await client.get_state()
    status, _meta = await client.get_status()
    print(f"  State.rate         = {state.get('rate')!r}")
    print(f"  Status.active_rate = {status.get('active_rate')!r}")
    print(f"  GetRates           = {_rates(await client.get_enumeration('GetRates'))}")


async def main() -> int:
    client = ControlClient()
    await client.connect()
    state = await client.get_state()
    if state.get("state") != "0":
        print(f"engine not idle (state={state.get('state')}) — aborting, nothing changed")
        return 1
    original = state.get("rate")
    if original is None:
        print("State reports no rate — aborting, nothing changed")
        return 1
    mode = state.get("mode")
    print(f"mode index {mode!r}, original rate index {original!r}")
    print(f"GetRates before    = {_rates(await client.get_enumeration('GetRates'))}")

    await _observe(client, "A  in-family Hz", IN_FAMILY_HZ)
    await _observe(client, "B  out-of-family Hz", OUT_OF_FAMILY_HZ)

    print(f"\n--- C  restore: SetRate value={original}")
    await client.set_command("SetRate", value=original)
    after = await client.get_state()
    if after.get("rate") != original:
        print(f"  RESTORE MISMATCH: original {original!r}, now {after.get('rate')!r}")
        return 1
    print(f"  restored, verified by readback (State.rate = {after.get('rate')!r})")
    await client.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
