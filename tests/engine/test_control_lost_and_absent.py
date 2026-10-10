"""What a Control API (4321) failure tells the user when the connection is the
problem rather than the command: the daemon closed it under a command, or there
was never one to send on.

What is asserted is what the fixture knows: the wire name of the command in
flight, which the closed-connection error does not carry, and the host and port
the client was pointed at, which the no-connection error does.

The daemon is the repository's control fake; its `_close` knob receives and logs
a command, answers nothing, and closes the socket. The no-connection client is
pointed at a port nothing listens on and never connected.
"""

import pytest
from conftest import DaemonFactory

from hqptuner.engine.control import ControlClient
from hqptuner.engine.controlerrors import ControlError

#: Where the client looks for HQPlayer, and where the fake daemon listens.
HOST = "127.0.0.1"

#: The per-command deadline handed to the client. Nothing here waits it out:
#: the closed connection and the absent one both fail before it matters.
COMMAND_TIMEOUT = 2.0

#: The Control API command `ControlClient.get_info` sends, by its wire name.
COMMAND = "GetInfo"


async def _closed_under_command_text(daemon: DaemonFactory) -> str:
    """The error a command gets when the daemon closes the connection under it."""
    port, _log, _state = await daemon(_close=COMMAND)
    client = ControlClient(HOST, port, timeout=COMMAND_TIMEOUT)
    await client.connect()
    try:
        with pytest.raises(ControlError) as caught:
            await client.get_info()
    finally:
        await client.close()
    return str(caught.value)


async def _no_connection_text(port: int) -> str:
    """The error a command gets from a client that has no connection to HQPlayer."""
    client = ControlClient(HOST, port, timeout=COMMAND_TIMEOUT)
    with pytest.raises(ControlError) as caught:
        await client.get_info()
    return str(caught.value)


async def test_a_connection_closed_under_a_command_does_not_name_the_command(daemon: DaemonFactory) -> None:
    assert COMMAND not in await _closed_under_command_text(daemon)


async def test_a_command_with_no_connection_names_the_address_hqplayer_was_looked_for_at(closed_port: int) -> None:
    assert f"{HOST}:{closed_port}" in await _no_connection_text(closed_port)
