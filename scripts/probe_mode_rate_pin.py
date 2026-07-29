#!/usr/bin/env python3
"""Probe: does ``SetMode`` clear the rate pin ``SetRate`` wrote?

The daemon carries the request slot per family (``pcm@samplerate`` /
``sdm@bitrate``, measured in ``probe_rate_slots.py``), but ``State`` reports only
one ``rate`` attribute — the running family's. Two readings of that are possible
and they take the fix in opposite directions:

  remembered  the other family's pin is still held, merely unreported, and comes
              back when the engine returns to that family. Then only the two
              views' DISPLAY of a dormant family is wrong.
  cleared     ``SetMode`` drops the pin outright — the rates enumeration is
              mode-dependent (manual SS4.6) and a PCM pin has no member in the SDM
              list. Then the engine genuinely forgets and no display fix suffices.

Neither the readme nor the desktop manual says which. Sequence, all through
``SetRate`` / ``SetMode`` with ``State`` readback after each step (``result="OK"``
is not proof, protocol.md SS6):

  1  pin a rate in the starting family, read it back
  2  switch to the other family, read ``State.rate``       <- cleared or 0?
  3  pin a rate there too, read it back
  4  switch back to the starting family, read ``State.rate`` <- step 1's pin?

**Writes only the request slot and the output mode** — no config write, no
``/restore``, no daemon restart. Both families' original request indices and the
original mode are put back and verified by readback.

Refuses to run unless the engine is idle (``State state="0"``): a mode switch
mid-stream re-syncs the DAC.

    .venv/bin/python scripts/probe_mode_rate_pin.py
"""

import asyncio
import sys

from hqptuner.control import ControlClient

IDLE = "0"
SETTLE_S = 2.0

# config-form family -> the ModesItem name to match. Matched by name, not by a
# hardcoded index: the modes enum is device-dependent (livemap._MODE_NAMES).
MODE_NAMES = {"pcm": "PCM", "sdm": "SDM"}


def _mode_index(modes: list[dict[str, str]], family: str) -> str | None:
    want = MODE_NAMES[family].upper()
    return next((m["index"] for m in modes if (m.get("name") or "").upper().startswith(want)), None)


def _family_of(modes: list[dict[str, str]], index: str) -> str | None:
    name = next(((m.get("name") or "") for m in modes if m.get("index") == index), "").upper()
    return next((family for family, want in MODE_NAMES.items() if name.startswith(want.upper())), None)


def _pinnable(rates: list[dict[str, str]]) -> dict[str, str] | None:
    """The lowest non-auto entry of the current mode's rate list."""
    return next((r for r in rates if r.get("rate") not in (None, "0")), None)


async def _rate_now(client: ControlClient) -> tuple[str, str]:
    """``State``'s request index and the rate in Hz that index carries."""
    index = (await client.get_state()).get("rate", "?")
    rates = await client.get_enumeration("GetRates")
    hz = next((r.get("rate", "?") for r in rates if r.get("index") == index), "?")
    return index, hz


async def _set_mode(client: ControlClient, index: str) -> None:
    await client.set_command("SetMode", value=index)
    await asyncio.sleep(SETTLE_S)


async def _set_rate(client: ControlClient, index: str) -> None:
    await client.set_command("SetRate", value=index)
    await asyncio.sleep(SETTLE_S)


async def main() -> int:
    client = ControlClient()
    await client.connect()
    steps: list[tuple[str, str]] = []
    try:
        state = await client.get_state()
        if state.get("state") != IDLE:
            print(f"engine not idle (state={state.get('state')}) — aborting, nothing changed")
            return 1

        modes = await client.get_enumeration("GetModes")
        start_mode = state.get("mode")
        start_family = _family_of(modes, start_mode or "")
        if start_family is None:
            print(f"engine is in [source] mode (index {start_mode}) — aborting, nothing changed")
            print("this probe needs a forced family to switch away from and back to.")
            return 1
        other_family = "sdm" if start_family == "pcm" else "pcm"
        other_mode = _mode_index(modes, other_family)
        if other_mode is None:
            print(f"engine offers no {other_family.upper()} mode — aborting, nothing changed")
            return 1

        start_rate = state.get("rate", "0")
        pin = _pinnable(await client.get_enumeration("GetRates"))
        if pin is None:
            print(f"the {start_family} rate list carries no pinnable entry — aborting, nothing changed")
            return 1

        await _set_rate(client, pin["index"])
        index, hz = await _rate_now(client)
        steps.append((f"1  pinned {pin['rate']} Hz in {start_family}", f"State.rate index {index} = {hz} Hz"))

        await _set_mode(client, other_mode)
        index, hz = await _rate_now(client)
        steps.append((f"2  switched to {other_family}", f"State.rate index {index} = {hz} Hz"))

        other_start = index
        other_pin = _pinnable(await client.get_enumeration("GetRates"))
        if other_pin is not None:
            await _set_rate(client, other_pin["index"])
            index, hz = await _rate_now(client)
            steps.append((f"3  pinned {other_pin['rate']} Hz in {other_family}", f"index {index} = {hz} Hz"))

        await _set_mode(client, start_mode or "")
        index, hz = await _rate_now(client)
        steps.append((f"4  switched back to {start_family}", f"State.rate index {index} = {hz} Hz"))

        # restore both families' request slots and the original mode
        await _set_rate(client, start_rate)
        restored_start = (await client.get_state()).get("rate") == start_rate
        restored_other = True
        if other_pin is not None:
            await _set_mode(client, other_mode)
            await _set_rate(client, other_start)
            restored_other = (await client.get_state()).get("rate") == other_start
            await _set_mode(client, start_mode or "")
        restored_mode = (await client.get_state()).get("mode") == start_mode

        print(f"start: mode index {start_mode} ({start_family}), request index {start_rate}\n")
        print(f"{'step':46} State readback")
        print("-" * 92)
        for label, outcome in steps:
            print(f"{label:46} {outcome}")
        print(f"\nRESTORED: rate {restored_start}  other-family rate {restored_other}  mode {restored_mode}")
        return 0 if restored_start and restored_other and restored_mode else 1
    finally:
        await client.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
