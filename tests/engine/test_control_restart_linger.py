"""A daemon that has accepted a restart still answers for a moment on 4321.

Measured on hqplayerd: after a
restart request is accepted, the pre-restart daemon keeps answering, 4321 drops
about 0.3 s later and comes back about 3 s after that. The fake states that
moment in commands rather than seconds, through its ``_linger`` knob: the
instance that accepted the restart answers ``_linger`` more commands on its open
connection, drops the one after, turns away ``_restart_window`` connects, and
only then answers as the restarted instance.

Each case restores a file whose mode differs from the one the daemon is running,
so the State a command is answered with names which instance answered it.
"""

import contextlib

import pytest
from conftest import DaemonFactory
from fake_control import restart_into

from hqptuner.engine.control import ControlClient
from hqptuner.engine.controlerrors import ControlError

#: The per-command deadline the clients are built with. Every case here ends on
#: an answer or a dropped connection, never on this running out.
TIMEOUT = 2.0

#: The family of the restored file: the daemon runs PCM before the restart.
RESTORED_MODE = "sdm"

#: The restored file's shaper enum IDs, one per chain.
RESTORED_DITHER = "5"
RESTORED_MODULATOR = "3"

#: Connects turned away while the daemon restarts.
WINDOW = 2


async def _state_once_answered(port: int) -> dict[str, str]:
    """Dial until a connection answers ``State``, through the restart window, and
    return that answer: the first State the restarted instance gives."""
    for _ in range(WINDOW):
        client = ControlClient("127.0.0.1", port, timeout=TIMEOUT)
        with contextlib.suppress(ControlError):
            await client.connect()
            await client.get_state()
        await client.close()
    client = ControlClient("127.0.0.1", port, timeout=TIMEOUT)
    await client.connect()
    answer = await client.get_state()
    await client.close()
    return answer


@pytest.mark.parametrize("linger", [1, 3])
async def test_a_command_answered_after_a_restart_is_accepted_is_not_answered_by_the_restarted_instance(
    daemon: DaemonFactory, linger: int
) -> None:
    port, _log, state = await daemon(_linger=str(linger), _restart_window=str(WINDOW))
    client = ControlClient("127.0.0.1", port, timeout=TIMEOUT)
    await client.connect()
    restart_into(state, RESTORED_MODE, RESTORED_DITHER, RESTORED_MODULATOR)
    lingering: dict[str, str] = {}
    for _ in range(linger):
        lingering = await client.get_state()
    with contextlib.suppress(ControlError):
        await client.get_state()  # the command the restart drops
    await client.close()
    restarted = await _state_once_answered(port)
    assert lingering["mode"] != restarted["mode"]
