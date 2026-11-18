"""What `apply_live` reports when HQPlayer refuses the `State` readback that follows a live setter.

The setting is the dither, written with `SetShaping` and verified by the `State` index read back after it. The daemon
is the support fake with `State` in its `_error` knob: the setter is answered `result="OK"` and applied, and the
readback is answered `result="Error"` with the fake's `_error_text` as the element's own text.

What is asserted is the refusal text the test put on the wire: that the row carries HQPlayer's words unchanged.
"""

from collections.abc import Awaitable, Callable

import pytest
from fixtures_daemons import Applied

from hqptuner.lanes.writer import LiveWriteFailed

#: The edit's setting name, which is also the `State` attribute that reads it back.
SETTING = "shaper"

#: The index HQPTuner sends.
SENT = "27"

#: Two refusals HQPlayer could give for the readback, distinct so no fixed sentence carries both.
REFUSALS = [
    pytest.param("State unavailable: engine reloading", id="reloading"),
    pytest.param("Access denied (session not ready)", id="denied"),
]


async def _refused_readback_error(apply_on_daemon: Callable[..., Awaitable[Applied]], refusal: str) -> str | None:
    """The `error` of the row `apply_live` reports for ``SETTING`` when HQPlayer answers the `State` readback
    `result="Error"` with ``refusal`` as its text; None when the row is not a failure."""
    report, _log = await apply_on_daemon({SETTING: {"value": SENT}}, _error="State", _error_text=refusal)
    row = report[0]
    return row.error if isinstance(row, LiveWriteFailed) else None


@pytest.mark.parametrize("refusal", REFUSALS)
async def test_a_refused_state_readback_reports_hqplayers_refusal_text_unchanged(
    apply_on_daemon: Callable[..., Awaitable[Applied]], refusal: str
) -> None:
    error = await _refused_readback_error(apply_on_daemon, refusal)
    assert error is not None
    assert refusal in error
