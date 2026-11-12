"""What a Control API attribute value looks like on the wire, and the one value HQPTuner will not send.

The daemon's 4321 parser does not decode `&quot;`, `&amp;` or `&apos;`, so a value goes out raw: a profile named
`Bob's EQ` is selected by `Bob's EQ`, never by an escaped spelling the daemon would not match. Values are written
inside double quotes, so a `"` is the one character that can close the attribute and let the rest of the value be
read as markup; a value holding one is refused before a byte reaches the socket.
"""

import functools

import fake_network
import pytest
from fake_control import XML, serve_recording

from hqptuner.engine.control import ControlClient
from hqptuner.engine.controlerrors import ControlError

#: The client's per-command deadline, in real seconds; every command is answered at once, so it never runs out.
REPLY_TIMEOUT = 2.0

#: What the recording daemon answers every command with.
ANSWER = '<MatrixSetProfile result="OK"/>'


async def _sent(*names: str) -> tuple[list[bytes], list[ControlError]]:
    """The bytes the daemon got from one `set_matrix_profile` call per name, and the errors the client raised."""
    wire: list[bytes] = []
    errors: list[ControlError] = []
    handler = functools.partial(serve_recording, wire=wire, answer=ANSWER)
    with fake_network.serving(handler) as port:
        client = ControlClient("127.0.0.1", port, timeout=REPLY_TIMEOUT, opener=fake_network.NETWORK.open_stream)
        await client.connect()
        try:
            for name in names:
                try:
                    await client.set_matrix_profile(name)
                except ControlError as exc:
                    errors.append(exc)
        finally:
            await client.close()
    return wire, errors


async def test_ampersand_apostrophe_and_angle_bracket_reach_the_daemon_unchanged() -> None:
    wire, _errors = await _sent("Bob's EQ & <Co>")
    assert wire == [f'{XML}<MatrixSetProfile value="Bob\'s EQ & <Co>"/>'.encode()]


async def test_a_value_that_closes_the_attribute_is_refused_as_invalid_input() -> None:
    _wire, errors = await _sent('x"/><Stop/')
    assert [error.code for error in errors] == ["invalid_input"]


@pytest.mark.parametrize("name", ['x"/><Stop/', '"'])
async def test_a_value_that_closes_the_attribute_leaves_the_next_command_the_only_one_written(name: str) -> None:
    wire, _errors = await _sent(name, "Default")
    assert wire == [f'{XML}<MatrixSetProfile value="Default"/>'.encode()]
