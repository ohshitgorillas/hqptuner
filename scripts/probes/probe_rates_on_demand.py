#!/usr/bin/env python3
"""Probe whether `GetRates` can be made to answer truthfully ON DEMAND.

`core/manager._poll` re-enumerates only when `mode` or `state` moves, on the
reading that an idle backend answers `GetRates` with auto alone and the same
daemon serves the full ladder "once asked again". Which of the two that hangs on
decides the whole live-rate design:

  * if a SECOND `GetRates` on the same connection answers fully, HQPTuner can ask
    at selection time and clamp to what the daemon says it can do;
  * if only a transport move fills the list, asking again buys nothing and a
    degenerate list cannot be told from a device that genuinely cannot go higher.

Read-only: `GetRates`, `State`, `Status`. No setter, no config write, no
`/restore` — safe to run mid-playback, so no idle gate.

    .venv/bin/python scripts/probes/probe_rates_on_demand.py
"""

import asyncio

from hqptuner.engine.control import ControlClient


def _rates(items: list[dict[str, str]]) -> str:
    """Render the enumeration as `index:rate` pairs, short enough to read in one line."""
    return " ".join(f"{item.get('index')}:{item.get('rate')}" for item in items) or "(empty)"


async def _ask(client: ControlClient, label: str) -> None:
    items = await client.get_enumeration("GetRates")
    print(f"  {label}: {len(items)} item(s)  {_rates(items)}")


async def _session(label: str) -> None:
    """One fresh connection, asked twice in a row."""
    client = ControlClient()
    await client.connect()
    try:
        state = await client.get_state()
        status, _ = await client.get_status()
        print(
            f"\n--- {label}  state={state.get('state')} mode={state.get('mode')} "
            f"rate={state.get('rate')} active_rate={status.get('active_rate')}"
        )
        await _ask(client, "first  GetRates")
        await _ask(client, "second GetRates")
        await _ask(client, "third  GetRates")
    finally:
        await client.close()


async def main() -> None:
    """Ask two fresh connections for the rates list, three times each."""
    await _session("connection 1")
    await _session("connection 2")


if __name__ == "__main__":
    asyncio.run(main())
