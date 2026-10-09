"""What the Control API client (4321) reports when HQPlayer does not answer a command in time.

The fake daemon's `_stall` knob is that HQPlayer: the command is received and logged, the connection stays open,
and nothing comes back. The client's deadline is a `VirtualDeadline`, handed in through the constructor, so the
wait runs out without a real second passing.

The sentence is owner copy and is not asserted (docs/testing.md rule 9). What is asserted is what the test put
there: the timeout the client was built with, which the report carries as its seconds, and the wire name of the
command that went unanswered, which it no longer carries.
"""

import re

import pytest
from conftest import DaemonFactory
from virtual_deadline import VirtualDeadline

from hqptuner.engine.control import ControlClient
from hqptuner.engine.controlerrors import ControlError

#: Two production-sized timeouts, so a report that names one fixed number of seconds is wrong on the other.
TIMEOUTS = [5.0, 30.0]

#: Two commands HQPlayer leaves unanswered: the handshake, and the settings snapshot read on every poll.
UNANSWERED = ["GetInfo", "State"]


def _numbers(text: str) -> list[float]:
    """Every number written in ``text``."""
    return [float(n) for n in re.findall(r"\d+(?:\.\d+)?", text)]


async def _unanswered_report(daemon: DaemonFactory, command: str, seconds: float) -> str:
    """The text of the error a client with a ``seconds`` timeout raises when HQPlayer never answers ``command``."""
    port, _log, _state = await daemon(_stall=command)
    deadline = VirtualDeadline()
    client = ControlClient("127.0.0.1", port, seconds, deadline=deadline)
    await client.connect()
    deadline.fall_silent()
    try:
        await client.request(f"<{command}/>")
    except ControlError as exc:
        return str(exc)
    finally:
        await client.close()
    return ""


@pytest.mark.parametrize("seconds", TIMEOUTS)
async def test_a_command_hqplayer_does_not_answer_reports_the_seconds_it_waited(
    daemon: DaemonFactory, seconds: float
) -> None:
    assert _numbers(await _unanswered_report(daemon, "GetInfo", seconds)) == [seconds]


@pytest.mark.parametrize("command", UNANSWERED)
async def test_a_command_hqplayer_does_not_answer_is_not_reported_by_its_wire_name(
    daemon: DaemonFactory, command: str
) -> None:
    assert command not in await _unanswered_report(daemon, command, TIMEOUTS[0])
