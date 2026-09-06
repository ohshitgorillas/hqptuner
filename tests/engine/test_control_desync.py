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

from collections.abc import AsyncIterator
from contextlib import suppress
from typing import Any

import pytest
from conftest import DaemonFactory
from fake_control import CommandLog

from hqptuner.engine.control import ControlClient, ControlError
from hqptuner.lanes.writer import apply_live

#: The per-command deadline these cases wait out, in real seconds — the same
#: convention as `test_control_stall.STALL_TIMEOUT`, small because an unanswered
#: command is only observable by the deadline expiring.
STALL_TIMEOUT = 0.5

#: The command the daemon faults on. One setter with one State attribute behind
#: it (`SetShaping` -> `shaper`), so nothing else in the exchange is confusable
#: with it.
FAULT_COMMAND = "SetShaping"

#: The batch: the faulted setter's field first, then a second live field on an
#: unrelated setter (`SetJunkFilter` -> `filter_junk`).
BATCH: dict[str, dict[str, str]] = {"shaper": {"value": "1"}, "junk_filter": {"value": "2"}}
SECOND_FIELD = "junk_filter"


def _recorded_after(log: CommandLog, command: str) -> list[str]:
    """The commands the daemon recorded after the one that faulted."""
    names = [name for name, _ in log]
    return names[names.index(command) + 1 :]


def _reported(report: list[dict[str, Any]], setting: str) -> Any:
    return next(entry for entry in report if entry["setting"] == setting)["ok"]


@pytest.fixture
async def stalling_client(daemon: DaemonFactory) -> AsyncIterator[ControlClient]:
    """A connected client whose daemon receives `SetShaping` and never answers."""
    port, _log, _state = await daemon(_stall=FAULT_COMMAND)
    client = ControlClient("127.0.0.1", port, timeout=STALL_TIMEOUT)
    await client.connect()
    yield client
    await client.close()


# --- what the connection carries after the fault -------------------------------


@pytest.mark.parametrize(("knob", "recorded"), [("_stall", []), ("_error", ["State"])])
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


# --- what the batch above the connection reports -------------------------------


async def test_a_field_behind_a_stalled_setter_is_not_reported_applied(
    live_client: ControlClient, stalling_client: ControlClient
) -> None:
    # Same batch, two daemons: the healthy one applies both fields, so a report
    # of "not applied" for the second field is the stall's doing and not the
    # batch's shape.
    healthy = await apply_live(live_client, BATCH)
    stalled = await apply_live(stalling_client, BATCH)
    assert (_reported(healthy, SECOND_FIELD), _reported(stalled, SECOND_FIELD)) == (True, False)
