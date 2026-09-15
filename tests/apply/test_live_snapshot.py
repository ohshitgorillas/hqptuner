"""What the engine's live settings look like when they are read off the manager.

`live_snapshot` is a pure read of the manager's public snapshot of the engine —
the `state` mapping the daemon's `State` filled and the `enums` mapping its
enumeration queries filled — joined into a display record per live field. Both
halves arrive here off the fake control daemon over a real socket, so the shapes
under test are the wire's own (`docs/testing.md`: fakes speak the protocol).
"""

from conftest import LiveManager

from hqptuner.lanes.live.snapshot import live_snapshot

# --- the chain has to be knowable at all --------------------------------------


async def test_a_state_that_names_no_loaded_chain_reports_nothing(live_manager: LiveManager) -> None:
    # `[source]` with nothing playing: the configured mode names no family and the
    # engine has not settled on one either, so every chain-bound field would be a
    # guess. Half a snapshot would read as the engine's settings, so there is none.
    manager, _, _ = await live_manager(mode="0", _active_mode="")
    assert live_snapshot(manager) is None
