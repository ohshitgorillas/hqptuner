"""What the engine's live settings look like when they are read off the manager.

`live_snapshot` is a pure read of the manager's public snapshot of the engine —
the `state` mapping the daemon's `State` filled and the `enums` mapping its
enumeration queries filled — joined into a display record per live field. Both
halves arrive here off the fake control daemon over a real socket, so the shapes
under test are the wire's own.
"""

import pytest
from conftest import LiveManager

from hqptuner.lanes.live.snapshot import ChainUnknownError, live_snapshot

# --- the chain has to be knowable at all --------------------------------------


async def test_a_state_that_names_no_loaded_chain_refuses_the_snapshot(live_manager: LiveManager) -> None:
    # `[source]` with nothing playing: the configured mode names no family and the
    # engine has not settled on one either, so every chain-bound field would be a
    # guess. Half a snapshot would read as the engine's settings, so there is none.
    unknown, _, _ = await live_manager(mode="0", _active_mode="")
    with pytest.raises(ChainUnknownError):
        live_snapshot(unknown)


@pytest.mark.parametrize(
    ("overrides", "chain"),
    [
        ({"mode": "1"}, "pcm"),
        ({"mode": "2"}, "sdm"),
    ],
)
async def test_the_snapshot_names_the_chain_the_engine_has_loaded(
    live_manager: LiveManager, overrides: dict[str, str], chain: str
) -> None:
    manager, _, _ = await live_manager(**overrides)
    assert live_snapshot(manager).chain == chain
