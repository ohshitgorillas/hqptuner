"""Two LIVE batches in flight at once on one engine, through ``apply_now``.

`SetFilter` carries the Nx filter as ``value`` and the 1x filter as
``value1x``, and a ``value`` alone moves both, so a
batch naming only the 1x filter still has to put an Nx index on the wire. When
an earlier batch that changed the Nx filter is still in flight, that index is
the earlier batch's, never the one the engine held before either batch began.

Everything runs against the fake control daemon over a real socket; the
assertion is on the traffic that reached it.
"""

import asyncio

from conftest import LiveManager
from fake_control import CommandLog

from hqptuner.lanes.live.lane import apply_now

#: The first batch: the Nx filter to enum ID 40, poly-sinc-gauss-long, which is
#: list index 1 on the fake's PCM chain. The engine starts at index 0.
NX_BATCH = {"filter": "40"}

#: The list index ``NX_BATCH`` puts on the wire as `SetFilter` ``value``.
NX_INDEX = "1"

#: The second batch: the 1x filter alone, to enum ID 25, sinc-M, list index 2.
ONE_X_BATCH = {"filter1x": "25"}


def _second_set_filter_value(log: CommandLog) -> list[str]:
    """The ``value`` of the second `SetFilter` the daemon received, as a
    one-item list, or an empty list where fewer than two arrived."""
    values = [attrs.get("value", "") for name, attrs in log if name == "SetFilter"]
    return values[1:2]


async def test_a_1x_only_batch_racing_an_nx_batch_sends_the_nx_filter_the_first_batch_set(
    live_manager: LiveManager,
) -> None:
    manager, log, _state = await live_manager()
    await asyncio.gather(apply_now(manager, dict(NX_BATCH)), apply_now(manager, dict(ONE_X_BATCH)))
    assert _second_set_filter_value(log) == [NX_INDEX]
