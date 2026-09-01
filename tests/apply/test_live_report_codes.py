"""A failed live setter's report line carries the raised error's OWN code.

`apply_live` reports one dict per setting; a failed one carries `ok: False`,
an `error` sentence and a `code`. The sentence is owner copy (docs/testing.md
rule 9) and stays out of the assertion; the code is a wire identifier and is
what this pins. The cases are built on the wire alone: the `_close` knob drops
the connection on the `Volume` command (transport death), `_error` answers it
`result="Error"` (refusal), `_deaf` answers OK without applying so the `State`
readback disagrees (mismatch), and an edit with no `value` or an unparseable
level never reaches the daemon at all (an error with no code of its own)."""

import pytest
from conftest import DaemonFactory

from hqptuner.engine.control import ControlClient
from hqptuner.lanes.writer import apply_live

CASES = [
    pytest.param({"_close": "Volume"}, {"value": "-20.0"}, "daemon_unavailable", id="transport-dies"),
    pytest.param({"_error": "Volume"}, {"value": "-20.0"}, "daemon_refused", id="refused"),
    pytest.param({"_deaf": "Volume", "volume": "-14.0"}, {"value": "-20.0"}, "daemon_refused", id="readback-mismatch"),
    pytest.param({}, {}, "invalid_input", id="missing-value"),
    pytest.param({}, {"value": "loud"}, "invalid_input", id="unparseable-volume"),
]


@pytest.mark.parametrize(("overrides", "edit", "code"), CASES)
async def test_a_failed_live_setter_reports_the_raised_errors_own_code(
    daemon: DaemonFactory, overrides: dict[str, str], edit: dict[str, str], code: str
) -> None:
    port, _log, _state = await daemon(**overrides)
    client = ControlClient("127.0.0.1", port, timeout=2.0)
    await client.connect()
    try:
        report = await apply_live(client, {"volume": edit})
    finally:
        await client.close()
    assert report[0]["code"] == code
