#!/usr/bin/env python3
"""Probe whether `SetFilter` and `SetShaping` take while the mode is `[source]`.

`SetRate` does not — it returns `result="OK"` and leaves `State.rate` at `"0"`
until an explicit mode is configured (measured 2026-07-29,
`scripts/probes/probe_rate_playing.py`). HQPTuner now resolves the loaded chain in
`[source]` from `Status.active_rate` and sends filter and shaper edits live there
rather than holding them, so the same question has to be asked of the chain
setters before that is shipped: a setter that is silently ignored produces the
same readback mismatch on the LIVE page, and the fix would be to hold those too.

Two measurements, mode left exactly as found:

  A  SetFilter    to a neighboring index in the running GetFilters list
  B  SetShaping   likewise, in the running GetShapers list

Each is verified by `State` readback (`result="OK"` is not proof, protocol.md §6)
and put straight back, also verified. **Writes only live settings** — no config
write, no `/restore`, no daemon restart. Runs mid-playback deliberately: that is
the condition under test, and a filter change re-primes the pipeline rather than
stopping it. Run with the listener's say-so (granted 2026-07-29, drive test).

    .venv/bin/python scripts/probes/probe_chain_source.py
"""

import asyncio
import sys

from hqptuner.engine.control import ControlClient


def _other_index(items: list[dict[str, str]], current: str) -> str | None:
    """Any index in this list that is not the one already selected."""
    return next((str(i["index"]) for i in items if str(i.get("index")) != str(current)), None)


async def _restore(client: ControlClient, command: str, state: dict[str, str]) -> None:
    """Put a chain setting back exactly as found — BOTH members for the filter.

    ``SetFilter value=`` alone sets the 1x and Nx filters to the same index
    (protocol.md §6, ``ControlClient.set_filter``), so restoring the Nx member by
    value alone silently overwrites the 1x one. This probe did exactly that on
    2026-07-29 and left a split pair collapsed; the split form is the only correct
    restore, and it is why this takes the whole original State rather than one
    attribute.
    """
    if command == "SetFilter":
        await client.set_filter(state["filterNx"], state["filter1x"])
    else:
        await client.set_command(command, value=state["shaper"])


async def _observe(client: ControlClient, label: str, command: str, enum: str, attr: str) -> None:
    """Set one chain setting to a neighboring index, read State back, restore."""
    print(f"\n--- {label}")
    original_state = await client.get_state()
    original = original_state.get(attr)
    items = await client.get_enumeration(enum)
    target = _other_index(items, original or "")
    if original is None or target is None:
        print(f"  no usable target in {enum} (State.{attr}={original!r}) — skipped")
        return
    await client.set_command(command, value=target)
    after = await client.get_state()
    print(f"  {command} value={target} -> result=OK, State.{attr} = {after.get(attr)!r} (was {original!r})")
    print(f"  VERDICT: {'took' if after.get(attr) == target else 'IGNORED'}")
    await _restore(client, command, original_state)
    back = await client.get_state()
    moved = {k: (v, back.get(k)) for k, v in original_state.items() if back.get(k) != v}
    if moved:
        print(f"  RESTORE MISMATCH (want, got): {moved}")
    else:
        print(f"  restored to {original!r}, whole State verified by readback")


async def main() -> int:
    """Establish whether SetFilter and SetShaping take while the mode is [source], restoring each setting after."""
    client = ControlClient()
    await client.connect()
    state = await client.get_state()
    status, _meta = await client.get_status()
    print(f"State.mode = {state.get('mode')!r}, state = {state.get('state')!r}")
    print(f"Status.active_mode = {status.get('active_mode')!r}, active_rate = {status.get('active_rate')!r}")
    if state.get("mode") != "0":
        print("mode is not [source] — this probe has nothing to measure")
        return 1

    await _observe(client, "A  filter", "SetFilter", "GetFilters", "filterNx")
    await _observe(client, "B  shaper", "SetShaping", "GetShapers", "shaper")
    await client.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
