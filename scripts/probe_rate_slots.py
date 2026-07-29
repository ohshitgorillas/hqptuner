#!/usr/bin/env python3
"""Probe: how do hqplayerd's two per-family rate slots interact?

The daemon carries two rate settings per output family, and its own ``/config``
form labels them apart:

  request slot  ``pcm@samplerate`` / ``sdm@bitrate``      "Sample rate" / "Bit rate"
                offers an explicit Auto (0); this is the slot ``SetRate`` writes
  limit slot    ``defaults@samplerate`` / ``defaults@bitrate``   "Rate limit"
                no Auto entry; readme SS1.3.1 calls it the "output target rate",
                "Real value can be equal or lower when auto rate-family is used"

Neither ``hqplayerd-readme.txt`` nor the desktop manual distinguishes the two or
states a precedence rule, so HQPTuner cannot bind its Rate control correctly
without measuring. Three questions, answered off ``Status.active_rate`` while a
44.1 kHz source plays:

  A  request = Auto                does the limit slot cap at all, and does it
                                   follow the source's base family?
  B  request = DSD256, 48k twin    is a nonzero request a hard pin, or is it
                                   family-adjusted down like the limit is?
  D  request = DSD1024, above      when both slots are set, which one wins?
     the configured limit

**Writes only the request slot, and only via the live ``SetRate`` setter** — no
config write, no ``/restore``, no daemon restart. The original request index is
put back and verified by ``State`` readback (``result="OK"`` is not proof,
protocol.md SS6). The limit slot is read but never touched.

Requires playback: ``Status.active_rate`` reports nothing without a stream. The
engine must be PLAYING (``State state="2"``) — the reverse of this repo's other
probes, which refuse to run unless it is idle. Each rate change re-syncs the DAC,
so the listener hears a brief gap per measurement.

    .venv/bin/python scripts/probe_rate_slots.py
"""

import asyncio
import sys

from hqptuner.control import ControlClient

PLAYING = "2"
SETTLE_S = 5.0

# The 48k-family twin of each target, deliberately: on a 44.1 kHz source a
# family-adjusting slot lands on the 44.1k twin instead, which is exactly the
# distinction being measured. DSD1024 sits above the DSD512 limit the config
# carries, so it also discriminates request-vs-limit precedence.
MEASUREMENTS = (
    ("A  request = Auto", "0"),
    ("B  request = DSD256 (48k twin)", "12288000"),
    ("D  request = DSD1024 (48k twin, above limit)", "49152000"),
)

# Same rate in the other base family, for reading the results back as families
# rather than as bare numbers.
FAMILY_44K = {
    "2822400": "DSD64",
    "5644800": "DSD128",
    "11289600": "DSD256",
    "22579200": "DSD512",
    "45158400": "DSD1024",
}
FAMILY_48K = {
    "3072000": "DSD64",
    "6144000": "DSD128",
    "12288000": "DSD256",
    "24576000": "DSD512",
    "49152000": "DSD1024",
}


def _describe(hz: str) -> str:
    """A rate in Hz as ``DSD512 (44.1k family)``, or bare Hz when unrecognised."""
    if hz in FAMILY_44K:
        return f"{FAMILY_44K[hz]} (44.1k family)"
    if hz in FAMILY_48K:
        return f"{FAMILY_48K[hz]} (48k family)"
    return hz


def _index_for(rates: list[dict[str, str]], hz: str) -> str | None:
    """The ``RatesItem`` index carrying this rate in Hz (``SetRate`` takes the index)."""
    return next((item["index"] for item in rates if item.get("rate") == hz), None)


async def _active_rate(client: ControlClient) -> tuple[str, str]:
    """``Status``'s current output rate and the source rate feeding it."""
    status, metadata = await client.get_status()
    return status.get("active_rate", "?"), (metadata or {}).get("samplerate", "?")


async def _measure(client: ControlClient, rates: list[dict[str, str]], hz: str) -> tuple[str, str] | None:
    index = _index_for(rates, hz)
    if index is None:
        return None
    await client.set_command("SetRate", value=index)
    await asyncio.sleep(SETTLE_S)
    return await _active_rate(client)


async def main() -> int:
    client = ControlClient()
    await client.connect()
    try:
        state = await client.get_state()
        if state.get("state") != PLAYING:
            print(f"engine not playing (state={state.get('state')}) — aborting, nothing changed")
            print("Status.active_rate reports nothing without a stream; start a 44.1 kHz track first.")
            return 1
        original = state.get("rate")
        if original is None:
            print("State carries no rate attribute — aborting, nothing changed")
            return 1

        rates = await client.get_enumeration("GetRates")
        _, source = await _active_rate(client)
        print(f"source: {source} Hz    original request index: {original}")
        print("limit slot is read-only here; check defaults_bitrate in GET /api/config\n")

        results = []
        for label, hz in MEASUREMENTS:
            got = await _measure(client, rates, hz)
            if got is None:
                results.append((label, "engine does not offer this rate"))
                continue
            active, src = got
            results.append((label, f"{_describe(active)}    source {src} Hz"))

        await client.set_command("SetRate", value=original)
        await asyncio.sleep(SETTLE_S)
        after = await client.get_state()
        restored = after.get("rate") == original
        active, _ = await _active_rate(client)

        print(f"{'measurement':46} active output rate")
        print("-" * 92)
        for label, outcome in results:
            print(f"{label:46} {outcome}")
        print(f"\nRESTORED: {restored}    request index now {after.get('rate')}, output {_describe(active)}")
        return 0 if restored else 1
    finally:
        await client.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
