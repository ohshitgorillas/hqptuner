"""What the Control API client (4321) reports when the `State` readback after a setter disagrees with what was set.

The daemon is the support fake with the setters `_deaf`: each is answered `result="OK"` and never applied
(docs/protocol.md §6, OK is not proof), so `State` keeps reporting the index the test baked in while the client
verifies the index it sent. Two settings disagree at once, each with its own pair of values, and no value is
shared between them, so a report can be read for which value belongs to which setting.

The sentence is owner copy and is not asserted (docs/testing.md rule 9). What is asserted is what the test put on
the wire, the index each setter sent and the index HQPlayer reported back for it: that the report prints each of them
once, and not the way Python prints a dict or a tuple.
"""

import re

import pytest
from conftest import DaemonFactory

from hqptuner.engine.control import ControlClient
from hqptuner.engine.controlerrors import ControlError

#: The client's per-command deadline, in real seconds. Every command is answered at once, so it never runs out.
REPLY_TIMEOUT = 2.0

#: Per setting: the `State` attribute, the setter that writes it, the index HQPTuner sends, the index HQPlayer keeps.
SHAPER = ("shaper", "SetShaping", "27", "13")
JUNK_FILTER = ("filter_junk", "SetJunkFilter", "6", "4")
SETTINGS = [SHAPER, JUNK_FILTER]

BY_SETTING = [pytest.param(setting, id=setting[0]) for setting in SETTINGS]


async def _mismatch_report(daemon: DaemonFactory) -> str | None:
    """The text of the error the client raises when the `State` readback after every setter in ``SETTINGS``
    disagrees with what it sent; None when the client raises nothing."""
    port, _log, _state = await daemon(
        _deaf=" ".join(setter for _attribute, setter, _sent, _kept in SETTINGS),
        **{attribute: kept for attribute, _setter, _sent, kept in SETTINGS},
    )
    client = ControlClient("127.0.0.1", port, timeout=REPLY_TIMEOUT)
    await client.connect()
    try:
        for _attribute, setter, sent, _kept in SETTINGS:
            await client.set_command(setter, value=sent)
        await client.verify_state({attribute: sent for attribute, _setter, sent, _kept in SETTINGS})
    except ControlError as exc:
        return str(exc)
    finally:
        await client.close()
    return None


def _values_outside_a_python_pair(report: str, first: str, second: str) -> list[str]:
    """Each of ``first`` and ``second`` that ``report`` prints as a word of its own, once per time it does, sorted,
    after leaving out the text where the two are printed as a Python tuple, quoted or not."""
    a, b = re.escape(first), re.escape(second)
    untupled = re.sub(rf"\(\s*'?{a}'?\s*,\s*'?{b}'?\s*\)", "", report)
    return sorted(re.findall(rf"\b(?:{a}|{b})\b", untupled))


async def test_a_state_readback_mismatch_is_not_reported_as_a_python_dict(daemon: DaemonFactory) -> None:
    report = await _mismatch_report(daemon)
    assert report is not None
    assert "{" not in report


@pytest.mark.parametrize("setting", BY_SETTING)
async def test_a_state_readback_mismatch_does_not_print_a_settings_values_as_a_python_tuple(
    daemon: DaemonFactory, setting: tuple[str, str, str, str]
) -> None:
    _attribute, _setter, sent, kept = setting
    report = await _mismatch_report(daemon)
    assert report is not None
    assert _values_outside_a_python_pair(report, sent, kept) == sorted([sent, kept])
