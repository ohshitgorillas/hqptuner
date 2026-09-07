"""Two Control API reads queued on one connection in the same event-loop pass.

The client serializes round trips over its one connection with a lock, so a
second `State` read started before the first has returned waits its turn. What
the queued read gets when its turn comes is the question here: on a daemon that
drops the connection under `State` without answering (the fake's `_close` knob,
fake_control.CLOSE), the first read fails and takes the connection with it
(docs/architecture.md:31), and the queued read must then fail the same
documented way, `ControlError` (docs/architecture.md:72), rather than trip over
the connection the first read already dropped. On a healthy daemon both reads
are answered.

Policy: docs/testing.md — one condition per test, behavior only.
"""

import asyncio

import pytest
from conftest import DaemonFactory
from fake_control import DEFAULTS

from hqptuner.engine.control import ControlClient, ControlError

#: The per-command deadline, real seconds, as `test_control_stall.STALL_TIMEOUT`;
#: a dropped connection is answered by the socket, not the deadline, so this is
#: only a ceiling.
READ_TIMEOUT = 1.0


def _outcome(result: dict[str, str] | BaseException) -> object:
    """One read's result reduced to what the caller can act on: the documented
    error type, any other exception's type, or the `mode` the State frame carried."""
    if isinstance(result, ControlError):
        return ControlError
    if isinstance(result, BaseException):
        return type(result)
    return result["mode"]


@pytest.mark.parametrize(
    ("knobs", "expected"),
    [
        ({"_close": "State"}, [ControlError, ControlError]),
        ({}, [DEFAULTS["mode"], DEFAULTS["mode"]]),
    ],
)
async def test_a_state_read_queued_behind_one_the_daemon_dropped_fails_as_control_error(
    daemon: DaemonFactory, knobs: dict[str, str], expected: list[object]
) -> None:
    port, _log, _state = await daemon(**knobs)
    client = ControlClient("127.0.0.1", port, timeout=READ_TIMEOUT)
    await client.connect()
    try:
        results = await asyncio.gather(client.get_state(), client.get_state(), return_exceptions=True)
    finally:
        await client.close()
    assert [_outcome(r) for r in results] == expected
