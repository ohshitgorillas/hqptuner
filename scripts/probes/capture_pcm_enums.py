#!/usr/bin/env python3
"""Capture PCM-mode enumeration lists into data/engine-enums.json (Phase 2).

Read-switch-restore against the live daemon: verifies the engine is idle,
records current State, switches to PCM, captures filters/shapers/rates,
switches back, restores filter/shaper/rate indices, and verifies the restore
by State readback (result="OK" alone is not proof — protocol.md §6).
Aborts before any change unless the engine is stopped.
"""

import asyncio
import datetime
import json
import sys
from pathlib import Path

from hqptuner.engine.control import ControlClient

DATA = Path(__file__).resolve().parent.parent.parent / "hqptuner" / "data"
PCM_MODE_INDEX = "1"
RESTORE_KEYS = ("mode", "filter1x", "filterNx", "shaper", "rate")


async def _capture(client: ControlClient) -> dict[str, list[dict[str, str]]]:
    return {
        "filters_pcm": await client.get_enumeration("GetFilters"),
        "shapers_pcm": await client.get_enumeration("GetShapers"),
        "rates_pcm": await client.get_enumeration("GetRates"),
    }


async def _restore(client: ControlClient, orig: dict[str, str]) -> None:
    # mode first — it resets rate to auto and swaps the lists the other
    # indices are relative to
    await client.set_command("SetMode", value=orig["mode"])
    await client.set_command("SetFilter", value=orig["filterNx"], value1x=orig["filter1x"])
    await client.set_command("SetShaping", value=orig["shaper"])
    await client.set_command("SetRate", value=orig["rate"])


async def main() -> int:
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

    already_pcm = orig["mode"] == PCM_MODE_INDEX
    if not already_pcm:
        await client.set_command("SetMode", value=PCM_MODE_INDEX)
    captured = await _capture(client)
    if not already_pcm:
        await _restore(client, {k: v for k, v in orig.items() if v is not None})
        after = await client.get_state()
        mismatch = {k: (orig[k], after.get(k)) for k in RESTORE_KEYS if after.get(k) != orig[k]}
        if mismatch:
            print(f"RESTORE MISMATCH (original, current): {mismatch}")
            return 1

    enums = json.loads((DATA / "engine-enums.json").read_text())
    enums.update(captured)
    enums["pcm_captured"] = datetime.date.today().isoformat()
    (DATA / "engine-enums.json").write_text(json.dumps(enums, indent=2) + "\n")
    print(
        f"captured: {len(captured['filters_pcm'])} PCM filters, "
        f"{len(captured['shapers_pcm'])} dithers, {len(captured['rates_pcm'])} rates; "
        f"restore verified"
    )
    await client.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
