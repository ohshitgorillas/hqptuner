"""What LIVE remembers for the loaded chain after a batch that also held a field for the other one.

A batch can carry fields for both chains. The field for the chain the engine has not loaded
is held, not sent, so the engine never confirmed it on the loaded chain. The loaded chain's
memory holds only what the engine confirmed there, even where the held field shares a
Control API setter with a loaded-chain field whose write verified. What that memory holds
is what goes back on the engine when the chain is loaded again, so the assertion is on the
traffic the fake control daemon receives on that re-entry.

Each held value is an enum ID the PCM lists also carry, at another index than the PCM
field's own (`tests/support/fake_control.py`): SDM modulator enum 0 is index 0, "none", on
the PCM shaper list, and SDM filter enum 57 is index 3 on the PCM filter list. A held value
remembered under PCM would reach the wire as that index.
"""

from typing import NamedTuple

import pytest
from conftest import LiveManager
from fake_control import CommandLog

from hqptuner.lanes.live.lane import apply_now

#: The engine starts with the PCM chain loaded.
PCM_LOADED = "1"

#: The writes that load the SDM chain and then the PCM chain again.
ENTER_SDM = {"mode": "sdm"}
ENTER_PCM = {"mode": "pcm"}


class SharedSetter(NamedTuple):
    """A batch pairing a PCM field with an SDM field behind the same setter, and the
    ``value`` the setter carries on PCM re-entry for the PCM field alone."""

    command: str
    batch: dict[str, str]
    reasserted: list[str]


#: Dither enum 5, NS9, is PCM shaper index 1; the held SDM modulator is enum 0.
SHAPER = SharedSetter("SetShaping", {"dither": "5", "modulator": "0"}, ["1"])
#: PCM Nx filter enum 25, sinc-M, is PCM filter index 2; the held SDM Nx filter is enum 57.
FILTER = SharedSetter("SetFilter", {"filter": "25", "oversampling": "57"}, ["2"])

SHARED_SETTERS = {"shaper": SHAPER, "filter": FILTER}


def _values_sent(log: CommandLog, command: str) -> list[str]:
    """The ``value`` of every ``command`` the daemon received, in order."""
    return [attrs.get("value", "") for name, attrs in log if name == command]


@pytest.mark.parametrize("shared", SHARED_SETTERS.values(), ids=SHARED_SETTERS.keys())
async def test_reentering_the_loaded_chain_sends_its_confirmed_value_and_never_a_field_held_for_the_other_chain(
    live_manager: LiveManager, shared: SharedSetter
) -> None:
    manager, log, _state = await live_manager(mode=PCM_LOADED)
    await apply_now(manager, dict(shared.batch))
    await apply_now(manager, dict(ENTER_SDM))
    reentry = len(log)
    await apply_now(manager, dict(ENTER_PCM))
    assert _values_sent(log[reentry:], shared.command) == shared.reasserted
