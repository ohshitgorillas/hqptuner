"""What `apply_live` reports when HQPlayer refuses the `State` readback that follows a live setter.

The setting is the dither, written with `SetShaping` and verified by the `State` index read back after it. The daemon
is the support fake with `State` in its `_error` knob: the setter is answered `result="OK"` and applied, and the
readback is answered `result="Error"` with the fake's `_error_text` as the element's own text (docs/protocol.md §6).

The report row's `error` sentence is owner copy and is not asserted (docs/testing.md rule 9). What is asserted is
the refusal text the test put on the wire: that the row carries HQPlayer's words unchanged.
"""

import pytest
from conftest import DaemonFactory

from hqptuner.engine.control import ControlClient
from hqptuner.lanes.writer import LiveWriteFailed, apply_live

#: The client's per-command deadline, in real seconds. Every command is answered at once, so it never runs out.
REPLY_TIMEOUT = 2.0

#: The edit's setting name, which is also the `State` attribute that reads it back.
SETTING = "shaper"

#: The index HQPTuner sends.
SENT = "27"

#: Two refusals HQPlayer could give for the readback, distinct so no fixed sentence carries both.
REFUSALS = [
    pytest.param("State unavailable: engine reloading", id="reloading"),
    pytest.param("Access denied (session not ready)", id="denied"),
]


async def _refused_readback_error(daemon: DaemonFactory, refusal: str) -> str | None:
    """The `error` of the row `apply_live` reports for ``SETTING`` when HQPlayer answers the `State` readback
    `result="Error"` with ``refusal`` as its text; None when the row is not a failure."""
    port, _log, _state = await daemon(_error="State", _error_text=refusal)
    client = ControlClient("127.0.0.1", port, timeout=REPLY_TIMEOUT)
    await client.connect()
    try:
        report = await apply_live(client, {SETTING: {"value": SENT}})
    finally:
        await client.close()
    row = report[0]
    return row.error if isinstance(row, LiveWriteFailed) else None


@pytest.mark.parametrize("refusal", REFUSALS)
async def test_a_refused_state_readback_reports_hqplayers_refusal_text_unchanged(
    daemon: DaemonFactory, refusal: str
) -> None:
    error = await _refused_readback_error(daemon, refusal)
    assert error is not None
    assert refusal in error
