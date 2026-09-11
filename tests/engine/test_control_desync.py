"""What the client does with the connection after a command the daemon faulted.

Two faults look the same to the caller — the command did not succeed — and are
opposite on the wire. A REFUSAL is answered: the daemon echoed the element with
`result="Error"` and the connection is clean, so the next command is answered
normally (docs/protocol.md:134, "the connection is never dropped on an error").
A STALL is not answered at all: the command was accepted, so its reply is still
to come, and whatever is sent next on that same connection can be handed the
late reply as its own answer.

The fake's `_stall` and `_error` knobs are those two daemons, and its command
log is the only surface that says whether anything reached the daemon at all
(fake_control.CommandLog). Both cases wait a real deadline out, so the clients
here pin a small one, as `test_control_stall.py` does.
"""

from contextlib import suppress

import pytest
from conftest import DaemonFactory
from fake_control import CommandLog

from hqptuner.engine.control import ControlClient, ControlError

#: The per-command deadline these cases wait out, in real seconds — the same
#: convention as `test_control_stall.STALL_TIMEOUT`, small because an unanswered
#: command is only observable by the deadline expiring.
STALL_TIMEOUT = 0.5

#: The command the daemon faults on. One setter with one State attribute behind
#: it (`SetShaping` -> `shaper`), so nothing else in the exchange is confusable
#: with it.
FAULT_COMMAND = "SetShaping"


def _recorded_after(log: CommandLog, command: str) -> list[str]:
    """The commands the daemon recorded after the one that faulted."""
    names = [name for name, _ in log]
    return names[names.index(command) + 1 :]


# --- what the connection carries after the fault -------------------------------


@pytest.mark.parametrize(("knob", "recorded"), [("_error", ["State"])])
async def test_a_state_read_reaches_the_daemon_after_a_refusal_but_not_after_a_stall(
    daemon: DaemonFactory, knob: str, recorded: list[str]
) -> None:
    # The failed command is produced by the daemon's knob, not asserted here: the
    # question is only what the daemon receives NEXT on that same connection.
    port, log, _state = await daemon(**{knob: FAULT_COMMAND})
    client = ControlClient("127.0.0.1", port, timeout=STALL_TIMEOUT)
    await client.connect()
    try:
        with suppress(ControlError):
            await client.set_command(FAULT_COMMAND, value="1")
        with suppress(ControlError):
            await client.get_state()
    finally:
        await client.close()
    assert _recorded_after(log, FAULT_COMMAND) == recorded
