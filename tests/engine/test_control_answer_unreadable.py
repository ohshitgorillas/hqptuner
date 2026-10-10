"""What the Control API client (4321) reports when HQPlayer's answer to a command cannot be read.

Two answers are unreadable: one that arrives whole and does not parse as XML, and one that starts and never
finishes, a document opened and fed line after line with its end tag never sent. Either way the report names the
command HQPTuner sent, since nothing else tells the reader which exchange went wrong.

The sentence around the command is owner copy and is not asserted (docs/testing.md rule 9). What is asserted is
the wire name of the command, which the test put on the wire itself. Neither hostile answer carries either
command's name, so the name can only reach the report from the request.

The daemons here are raw sockets, since the shared fake answers only well-formed frames. Each one closes the
connection once it has said all it will say, so every read the client makes ends on data or on the close, and the
client waits on a `VirtualDeadline` that is never silenced, so no real timer runs. A client that stopped
recognising either answer reads the close and fails at once rather than waiting out a timeout.
"""

import asyncio
from collections.abc import Awaitable, Callable

import pytest
from virtual_deadline import VirtualDeadline

from hqptuner.engine.control import ControlClient
from hqptuner.engine.controlerrors import ControlError

XML = '<?xml version="1.0" encoding="UTF-8"?>'

#: The client's per-wait timeout. Its deadline is virtual and never silenced, so this never runs out.
TIMEOUT = 5.0

#: Two commands whose names appear nowhere in either hostile answer, so a report naming a fixed one is wrong on
#: the other.
COMMANDS = ["GetFilters", "MatrixGetProfile"]

#: A whole, newline-terminated frame that is not well-formed XML: its root closes, but carries one attribute twice.
#: Not a premature end, so no amount of further reading completes it.
UNPARSEABLE = b'<Reply value="1" value="2"/>\n'

#: The opening of a document whose end tag never comes.
ENDLESS_OPENING = b"<Reply>\n"

#: One line of the endless document's body, complete in itself, so every line leaves the document still open.
ENDLESS_LINE = b'<Item index="0"/>\n'

#: How much of the endless body goes out per write.
ENDLESS_CHUNK = ENDLESS_LINE * 4096

#: Where the fake stops feeding a client that is still reading and closes the socket, so a client with no limit of
#: its own still gets an error to report instead of reading forever.
ENDLESS_CEILING = 16 * 1024 * 1024

Handler = Callable[[asyncio.StreamReader, asyncio.StreamWriter], Awaitable[None]]


async def _answer_unparseable(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    """Take one command, answer it with a frame that does not parse, and close the connection."""
    await reader.read(4096)
    writer.write(XML.encode() + UNPARSEABLE)
    await writer.drain()
    writer.close()


async def _answer_endlessly(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    """Take one command and answer it with a document that never ends, until the client leaves or the ceiling."""
    await reader.read(4096)
    writer.write(XML.encode() + ENDLESS_OPENING)
    sent = 0
    try:
        while sent < ENDLESS_CEILING and not writer.is_closing():
            writer.write(ENDLESS_CHUNK)
            await writer.drain()
            sent += len(ENDLESS_CHUNK)
    except ConnectionError:
        return
    writer.close()


async def _report(handler: Handler, command: str) -> str:
    """The text of the error the client raises when ``handler``'s daemon answers ``command``; empty if none."""
    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    port = int(server.sockets[0].getsockname()[1])
    client = ControlClient("127.0.0.1", port, TIMEOUT, deadline=VirtualDeadline())
    try:
        await client.connect()
        await client.request(f"<{command}/>")
    except ControlError as exc:
        return str(exc)
    finally:
        await client.close()
        server.close()
        await server.wait_closed()
    return ""


@pytest.mark.parametrize("command", COMMANDS)
async def test_an_answer_that_does_not_parse_is_reported_by_the_command_it_answered(command: str) -> None:
    assert command in await _report(_answer_unparseable, command)


@pytest.mark.parametrize("command", COMMANDS)
async def test_an_answer_that_never_ends_is_reported_by_the_command_it_answered(command: str) -> None:
    assert command in await _report(_answer_endlessly, command)
