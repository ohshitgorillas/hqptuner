"""What `apply_live` reports when a setting's `State` readback disagrees with what was set.

The setting is the dither, verified by the `State` index read back after `SetShaping`. The daemon is the support
fake with that setter `_deaf`, answered `result="OK"` and never applied (docs/protocol.md §6), so the readback keeps
the index the test baked in while the lane verifies the one it sent.

The report row's `error` is owner copy and is not asserted (docs/testing.md rule 9). What is asserted is what the
test put on the wire, the index sent and the index HQPlayer reported: that the report prints each of them once, and
not the way Python prints a dict or a tuple.
"""

import re

from conftest import DaemonFactory

from hqptuner.engine.control import ControlClient
from hqptuner.lanes.writer import LiveWriteFailed, apply_live

#: The client's per-command deadline, in real seconds. Every command is answered at once, so it never runs out.
REPLY_TIMEOUT = 2.0

#: The edit's setting name, which is also the `State` attribute that reads it back, and the setter it goes out as.
SETTING, SETTER = "shaper", "SetShaping"

#: The index HQPTuner sends, and the index HQPlayer keeps.
SENT, KEPT = "27", "13"


async def _mismatch_error(daemon: DaemonFactory) -> str | None:
    """The `error` of the row `apply_live` reports for ``SETTING`` when HQPlayer keeps ``KEPT`` after being sent
    ``SENT``; None when the row is not a failure."""
    port, _log, _state = await daemon(_deaf=SETTER, **{SETTING: KEPT})
    client = ControlClient("127.0.0.1", port, timeout=REPLY_TIMEOUT)
    await client.connect()
    try:
        report = await apply_live(client, {SETTING: {"value": SENT}})
    finally:
        await client.close()
    row = report[0]
    return row.error if isinstance(row, LiveWriteFailed) else None


def _values_outside_a_python_pair(text: str, first: str, second: str) -> list[str]:
    """Each of ``first`` and ``second`` that ``text`` prints as a word of its own, once per time it does, sorted, after
    leaving out the text where the two are printed as a Python tuple, quoted or not."""
    a, b = re.escape(first), re.escape(second)
    untupled = re.sub(rf"\(\s*'?{a}'?\s*,\s*'?{b}'?\s*\)", "", text)
    return sorted(re.findall(rf"\b(?:{a}|{b})\b", untupled))


async def test_a_state_readback_mismatch_is_not_reported_as_a_python_dict(daemon: DaemonFactory) -> None:
    error = await _mismatch_error(daemon)
    assert error is not None
    assert "{" not in error


async def test_a_state_readback_mismatch_does_not_print_the_two_values_as_a_python_tuple(
    daemon: DaemonFactory,
) -> None:
    error = await _mismatch_error(daemon)
    assert error is not None
    assert _values_outside_a_python_pair(error, SENT, KEPT) == sorted([SENT, KEPT])
