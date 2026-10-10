"""What `apply_live` reports for volume when HQPlayer refuses the `State` readback that follows the `Volume` write.

The daemon is the support fake with `State` in its `_error` knob: `Volume` is answered `result="OK"` and applied, and
every `State` is answered `result="Error"` with the fake's `_error_text` as the element's own text (docs/protocol.md
§6). The command log is read to confirm the refused `State` came after the `Volume` write, so the refusal is the
readback's and not some earlier read's.

The report row's `error` sentence is owner copy and is not asserted (docs/testing.md rule 9). What is asserted is the
refusal text the test put on the wire: that the volume row carries HQPlayer's words unchanged, which a row reporting
a readback mismatch has no way to carry.
"""

import pytest
from conftest import DaemonFactory

from hqptuner.engine.control import ControlClient
from hqptuner.lanes.writer import LiveWriteFailed, apply_live

#: The client's per-command deadline, in real seconds. Every command is answered at once, so it never runs out.
REPLY_TIMEOUT = 2.0

#: The edit's setting name, the command it goes out as, and the command that reads it back.
SETTING, SETTER, READBACK = "volume", "Volume", "State"

#: The level HQPTuner sends, inside the fake's default volume range.
SENT = "-20.0"

#: Two refusals HQPlayer could give for the readback, distinct so no fixed sentence carries both.
REFUSALS = [
    pytest.param("State unavailable: engine reloading", id="reloading"),
    pytest.param("Access denied (session not ready)", id="denied"),
]


async def _refused_volume_readback_error(daemon: DaemonFactory, refusal: str) -> str | None:
    """The `error` of the row `apply_live` reports for volume when HQPlayer answers the `State` read after the
    `Volume` write `result="Error"` with ``refusal`` as its text; None when the row is not a failure, or when no
    `State` was read after `Volume` went out."""
    port, log, _state = await daemon(_error=READBACK, _error_text=refusal)
    client = ControlClient("127.0.0.1", port, timeout=REPLY_TIMEOUT)
    await client.connect()
    try:
        report = await apply_live(client, {SETTING: {"value": SENT}})
    finally:
        await client.close()
    names = [name for name, _attrs in log]
    if SETTER not in names or READBACK not in names[names.index(SETTER) :]:
        return None
    row = report[0]
    return row.error if isinstance(row, LiveWriteFailed) else None


@pytest.mark.parametrize("refusal", REFUSALS)
async def test_a_refused_volume_readback_reports_hqplayers_refusal_text_unchanged(
    daemon: DaemonFactory, refusal: str
) -> None:
    error = await _refused_volume_readback_error(daemon, refusal)
    assert error is not None
    assert refusal in error
