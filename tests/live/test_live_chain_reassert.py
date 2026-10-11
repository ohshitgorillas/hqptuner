"""What LIVE puts back on the engine when the chain it held edits for is loaded.

An edit to the dormant chain is held as the config-form enum ID the caller sent,
since only the loaded chain's lists can resolve it. When a mode write loads that
chain, each held value is resolved against the lists the engine now enumerates
and sent as its index there; a value those lists do not carry is left out rather
than sent as an index that means some other filter or shaper.

Everything runs against the fake control daemon over a real socket, driven
through ``apply_now``; the assertion is on the traffic that reached it. The
fake's SDM filter list carries enum 23, sinc-M, at index 1, and its SDM shaper
list carries enum IDs 0 and 3 only (`tests/support/fake_control.py`).
"""

import pytest
from conftest import LiveManager
from fake_control import CommandLog

from hqptuner.lanes.live.lane import apply_now

#: Two edits to the SDM chain, made while the engine runs PCM, so both are held:
#: the Nx oversampling filter to enum 23, which the SDM filter list carries, and
#: the modulator to enum 5, NS9, which only the PCM shaper list carries.
HELD_FOR_SDM = {"oversampling": "23", "modulator": "5"}

#: The write that loads the SDM chain.
ENTER_SDM = {"mode": "sdm"}

#: The SDM filter list index of enum 23. A lane that sent the enum ID itself
#: would put "23" on the wire instead.
SINC_M_SDM_INDEX = "1"


def _values_sent(log: CommandLog, command: str) -> list[str]:
    """The ``value`` of every ``command`` the daemon received, in order."""
    return [attrs.get("value", "") for name, attrs in log if name == command]


@pytest.mark.parametrize(
    ("command", "sent"),
    [
        pytest.param("SetFilter", [SINC_M_SDM_INDEX], id="listed-filter-sent-as-its-index"),
        pytest.param("SetShaping", [], id="unlisted-modulator-left-out"),
    ],
)
async def test_entering_a_chain_sends_its_held_values_only_as_indices_its_running_lists_carry(
    live_manager: LiveManager, command: str, sent: list[str]
) -> None:
    manager, log, _state = await live_manager(mode="1")
    await apply_now(manager, dict(HELD_FOR_SDM))
    await apply_now(manager, dict(ENTER_SDM))
    assert _values_sent(log, command) == sent
