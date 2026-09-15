"""A staged apply of the mode the engine is already in puts no mode setter on
the wire.

`SetMode` swaps the filter/shaper/rate enumerations wholesale (architecture §5,
protocol.md §4). Everything runs against the fake daemons over a real socket;
the assertions are on the traffic that reached them (docs/testing.md).
"""

from conftest import LiveManager

# --- the mode the engine is already in ----------------------------------------
# `SetMode` is not free even when it changes nothing: it clears the engine's rate
# pin and reloads the chain (probe_mode_rate_pin.py on 6.0.4). So a staged apply
# of the running mode must put no mode setter on the wire at all.


async def test_a_mode_apply_matching_the_running_mode_sends_no_mode_setter(live_manager: LiveManager) -> None:
    manager, log, _ = await live_manager(mode="1")
    log.clear()
    await manager.applyops.apply({}, {"mode": "pcm"})
    assert "SetMode" not in [command for command, _attrs in log]
