"""A live edit whose value falls outside its setter field's domain is refused before the wire.

The field is `adaptive_volume`, written with `SetAdaptiveVolume`, whose domain is a 0/1 flag: the two strings `0`
and `1` and nothing else; any other string is refused, not parsed. The daemon is the support fake, which applies
whatever a setter carries. What is pinned is the refusal: the row's code, and that no `SetAdaptiveVolume` reaches
HQPlayer, beside the two well-formed flags, which do reach it.
"""

import pytest
from conftest import DaemonFactory
from fake_control import CommandLog

from hqptuner.engine.control import ControlClient
from hqptuner.lanes.writer import LiveWriteFailed, apply_live

#: The client's per-command deadline, in real seconds. Every command is answered at once, so it never runs out.
REPLY_TIMEOUT = 2.0

#: The setting key the live batch names the field by.
SETTING = "adaptive_volume"

#: The setter that writes the field.
SETTER = "SetAdaptiveVolume"

#: The State attribute that reports the field, which is the fake's knob for where it starts.
STATE_ATTRIBUTE = "adaptive"

#: Where the field starts for a malformed edit.
START = "0"

#: The code a value HQPTuner refuses on its own carries.
INVALID_INPUT = "invalid_input"

#: Strings that are not `0` or `1`: the two the spec names, a number past the flag, a word, a sign, and padding.
MALFORMED = [
    pytest.param("01", id="leading-zero"),
    pytest.param("1.5", id="decimal"),
    pytest.param("2", id="past-the-flag"),
    pytest.param("true", id="word"),
    pytest.param("-1", id="signed"),
    pytest.param(" 1", id="padded"),
]

#: How many `SetAdaptiveVolume` commands reach HQPlayer for an edit, from where the field starts. Each well-formed
#: flag starts from the other one, so the edit changes the field.
SETTER_COUNTS = [pytest.param(value.values[0], START, 0, id=value.id) for value in MALFORMED] + [
    pytest.param("1", "0", 1, id="well-formed-on"),
    pytest.param("0", "1", 1, id="well-formed-off"),
]


async def _apply_flag(daemon: DaemonFactory, value: str, start: str = START) -> tuple[str | None, CommandLog]:
    """The `code` of the row `apply_live` reports for ``SETTING`` set to ``value`` from ``start`` (None when the row
    is not a failure), and the commands the daemon received."""
    port, log, _state = await daemon(**{STATE_ATTRIBUTE: start})
    client = ControlClient("127.0.0.1", port, timeout=REPLY_TIMEOUT)
    await client.connect()
    try:
        report = await apply_live(client, {SETTING: {"value": value}})
    finally:
        await client.close()
    row = report[0]
    return (row.code if isinstance(row, LiveWriteFailed) else None), log


@pytest.mark.parametrize("value", MALFORMED)
async def test_a_malformed_adaptive_volume_flag_is_reported_as_invalid_input(daemon: DaemonFactory, value: str) -> None:
    code, _log = await _apply_flag(daemon, value)
    assert code == INVALID_INPUT


@pytest.mark.parametrize(("value", "start", "sent"), SETTER_COUNTS)
async def test_adaptive_volume_reaches_hqplayer_only_as_a_well_formed_flag(
    daemon: DaemonFactory, value: str, start: str, sent: int
) -> None:
    _code, log = await _apply_flag(daemon, value, start)
    assert len([name for name, _attrs in log if name == SETTER]) == sent
