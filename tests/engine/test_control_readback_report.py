"""What the Control API client (4321) reports when the `State` readback after a setter disagrees with what was set.

The daemon is the support fake with the setters `_deaf`: each is answered `result="OK"` and never applied, so
`State` keeps reporting the index the test baked in while the client verifies the index it sent. Two settings
disagree at once, each with its own pair of values, and no value is shared between them, so a report can be read for
which value belongs to which setting.

What is asserted is what the test put on the wire, the index each setter sent and the index HQPlayer reported back
for it: that the report prints each of them once, and not the way Python prints a dict or a tuple.
"""

from conftest import DaemonFactory

from hqptuner.engine.control import ControlClient
from hqptuner.engine.controlerrors import ControlError

#: The client's per-command deadline, in real seconds. Every command is answered at once, so it never runs out.
REPLY_TIMEOUT = 2.0

#: Per setting: the `State` attribute, the setter that writes it, the index HQPTuner sends, the index HQPlayer keeps.
SHAPER = ("shaper", "SetShaping", "27", "13")
JUNK_FILTER = ("filter_junk", "SetJunkFilter", "6", "4")
SETTINGS = [SHAPER, JUNK_FILTER]


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


async def test_a_state_readback_mismatch_is_not_reported_as_a_python_dict(daemon: DaemonFactory) -> None:
    report = await _mismatch_report(daemon)
    assert report is not None
    assert "{" not in report
