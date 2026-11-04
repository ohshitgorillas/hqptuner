#!/usr/bin/env python3
"""Capture one mode's enumeration lists into data/engine-enums.json (Phase 2).

Usage: capture_pcm_enums.py [pcm|sdm], PCM by default.

Read-switch-restore against the live daemon: verifies the engine is idle,
records current State, switches to the requested mode, captures
filters/shapers/rates, switches back, restores filter/shaper/rate indices, and
verifies the restore by State readback (result="OK" alone is not proof —
protocol.md §6). Already in the requested mode, it only reads.
Aborts before any change unless the engine is stopped.
"""

import asyncio
import datetime
import json
import sys
from pathlib import Path
from typing import NamedTuple

from hqptuner.engine.control import ControlClient

DATA = Path(__file__).resolve().parent.parent.parent / "hqptuner" / "data"
RESTORE_KEYS = ("mode", "filter1x", "filterNx", "shaper", "rate")


class Mode(NamedTuple):
    """One capturable mode: its State `mode` index and the engine-enums.json keys it writes."""

    state_index: str
    suffix: str
    stamp_key: str
    shaper_noun: str


MODES = {
    "pcm": Mode(state_index="1", suffix="pcm", stamp_key="pcm_captured", shaper_noun="dithers"),
    "sdm": Mode(state_index="2", suffix="sdm", stamp_key="captured", shaper_noun="modulators"),
}


async def _capture(client: ControlClient, mode: Mode) -> dict[str, list[dict[str, str]]]:
    return {
        f"filters_{mode.suffix}": await client.get_enumeration("GetFilters"),
        f"shapers_{mode.suffix}": await client.get_enumeration("GetShapers"),
        f"rates_{mode.suffix}": await client.get_enumeration("GetRates"),
    }


async def _restore(client: ControlClient, orig: dict[str, str]) -> None:
    # mode first — it resets rate to auto and swaps the lists the other
    # indices are relative to
    await client.set_command("SetMode", value=orig["mode"])
    await client.set_command("SetFilter", value=orig["filterNx"], value1x=orig["filter1x"])
    await client.set_command("SetShaping", value=orig["shaper"])
    await client.set_command("SetRate", value=orig["rate"])


async def main(argv: list[str]) -> int:
    """Capture one mode's filter, shaper and rate lists into engine-enums.json, restoring the engine afterwards."""
    mode_name = argv[1] if len(argv) > 1 else "pcm"
    if mode_name not in MODES:
        print(f"unknown mode {mode_name!r}; expected one of {sorted(MODES)}")
        return 2
    mode = MODES[mode_name]
    client = ControlClient()
    await client.connect()
    state = await client.get_state()
    if state.get("state") != "0":
        print(f"engine not idle (state={state.get('state')}) — aborting, nothing changed")
        return 1
    orig = {key: state.get(key) for key in RESTORE_KEYS}
    if any(value is None for value in orig.values()):
        print(f"missing State attributes {orig} — aborting, nothing changed")
        return 1
    print(f"original settings: {orig}")

    already_there = orig["mode"] == mode.state_index
    if not already_there:
        await client.set_command("SetMode", value=mode.state_index)
    captured = await _capture(client, mode)
    if not already_there:
        await _restore(client, {k: v for k, v in orig.items() if v is not None})
        after = await client.get_state()
        mismatch = {k: (orig[k], after.get(k)) for k in RESTORE_KEYS if after.get(k) != orig[k]}
        if mismatch:
            print(f"RESTORE MISMATCH (original, current): {mismatch}")
            return 1

    enums = json.loads((DATA / "engine-enums.json").read_text())
    enums.update(captured)
    enums[mode.stamp_key] = datetime.datetime.now(datetime.UTC).astimezone().date().isoformat()
    (DATA / "engine-enums.json").write_text(json.dumps(enums, indent=2) + "\n")
    print(
        f"captured: {len(captured[f'filters_{mode.suffix}'])} {mode.suffix.upper()} filters, "
        f"{len(captured[f'shapers_{mode.suffix}'])} {mode.shaper_noun}, "
        f"{len(captured[f'rates_{mode.suffix}'])} rates; "
        f"{'read only, nothing switched' if already_there else 'restore verified'}"
    )
    await client.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv)))
