"""What the Control API client (4321) reports when HQPlayer's answer to a command is one it cannot read.

The daemon here is the support fake (`fake_control.handle`) with one command's answer swapped for one of two
answers the client cannot take.

A broken answer is a newline-terminated frame no XML parser accepts. The frame is malformed rather than unfinished,
so it is not the premature end of document the client reads past (docs/protocol.md §1): the client gives up on it
and raises.

An endless answer is a document that opens an attribute and then streams filler with no closing quote, no closing
tag and no newline. Every prefix of it is a premature end of document, the case the client reads past, so only the
client's own size limit ends the read. The stream stops at `STREAM_CEILING` and the connection closes, so a client
with no limit below it fails on a dropped connection rather than reading without bound.

The report's sentence is owner copy and is not asserted (docs/testing.md rule 9). What is asserted is what the test
put there: the wire name of the command the answer was for, which neither the broken frame nor the streamed bytes
ever spell, and for a broken frame the message expat gives for it, which is the parser's text rather than
HQPTuner's.
"""

import asyncio
import functools
from collections.abc import Awaitable, Callable
from pyexpat import errors

import pytest
from fake_control import DEFAULTS, XML, CommandLog, handle

from hqptuner.engine.control import ControlClient
from hqptuner.engine.controlerrors import ControlError

#: The client's per-command deadline, in real seconds. A broken frame is answered at once and the filler streams
#: without pause, so it never runs out.
REPLY_TIMEOUT = 2.0

#: Two commands whose answer the client cannot read: the handshake, and the settings snapshot read on every poll.
ANSWERED = ["GetInfo", "State"]

#: The broken frame each command in ``ANSWERED`` is answered with.
MALFORMED_FRAME = '<Oops a="1" b/>'

#: Broken frames, each beside the message expat gives for it. Neither frame spells a command's name.
BROKEN = [
    pytest.param(MALFORMED_FRAME, errors.XML_ERROR_INVALID_TOKEN, id="invalid-token"),
    pytest.param('<Oops a="1" a="2"/>', errors.XML_ERROR_DUPLICATE_ATTRIBUTE, id="duplicate-attribute"),
]

#: How the endless answer opens: a root element whose attribute value is never closed.
ENDLESS_HEAD = '<Oops a="'

#: One write of filler, inside the open attribute value.
FILLER = b"x" * 65536

#: Bytes of filler the fake sends before it gives up and closes, far past any answer the protocol describes.
STREAM_CEILING = 16 * 1024 * 1024

#: A connection handler for the fake daemon, as `asyncio.start_server` calls it.
Serve = Callable[[asyncio.StreamReader, asyncio.StreamWriter], Awaitable[None]]


async def _serve_broken(
    reader: asyncio.StreamReader, writer: asyncio.StreamWriter, *, command: str, frame: str
) -> None:
    """Answer every command as the support fake does, except ``command``, which is answered ``frame``."""
    state = dict(DEFAULTS)
    log: CommandLog = []
    while data := await reader.read(4096):
        body = data.split(b"?>", 1)[-1].strip().decode()
        answer = handle(body, state, log)
        if not isinstance(answer, str):
            break
        writer.write(f"{XML}{frame if log[-1][0] == command else answer}\n".encode())
        await writer.drain()
    writer.close()


async def _stream_endless(writer: asyncio.StreamWriter) -> None:
    """Send the endless answer until the client stops reading or `STREAM_CEILING` is reached."""
    writer.write(f"{XML}{ENDLESS_HEAD}".encode())
    sent = 0
    try:
        while sent < STREAM_CEILING:
            writer.write(FILLER)
            await writer.drain()
            sent += len(FILLER)
    except ConnectionError:
        return


async def _serve_endless(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, *, command: str) -> None:
    """Answer every command as the support fake does, except ``command``, whose answer never ends."""
    state = dict(DEFAULTS)
    log: CommandLog = []
    while data := await reader.read(4096):
        body = data.split(b"?>", 1)[-1].strip().decode()
        answer = handle(body, state, log)
        if log[-1][0] == command:
            await _stream_endless(writer)
            break
        if not isinstance(answer, str):
            break
        writer.write(f"{XML}{answer}\n".encode())
        await writer.drain()
    writer.close()


async def _report(command: str, serve: Serve) -> str:
    """The text of the error the client raises when ``command`` is sent to a daemon run by ``serve``; empty if none."""
    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    port = int(server.sockets[0].getsockname()[1])
    client = ControlClient("127.0.0.1", port, timeout=REPLY_TIMEOUT)
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


async def _broken_answer_report(command: str, frame: str) -> str:
    """The text of the error the client raises when HQPlayer answers ``command`` with ``frame``; empty if none."""
    return await _report(command, functools.partial(_serve_broken, command=command, frame=frame))


async def _endless_answer_report(command: str) -> str:
    """The text of the error the client raises when HQPlayer's answer to ``command`` never ends; empty if none."""
    return await _report(command, functools.partial(_serve_endless, command=command))


@pytest.mark.parametrize("command", ANSWERED)
async def test_an_answer_that_will_not_parse_is_reported_with_the_command_it_answered(command: str) -> None:
    assert command in await _broken_answer_report(command, MALFORMED_FRAME)


@pytest.mark.parametrize(("frame", "parser_error"), BROKEN)
async def test_an_answer_that_will_not_parse_is_reported_with_the_parsers_own_error(
    frame: str, parser_error: str
) -> None:
    assert parser_error in await _broken_answer_report("State", frame)


@pytest.mark.parametrize("command", ANSWERED)
async def test_an_answer_that_never_ends_is_reported_with_the_command_it_answered(command: str) -> None:
    assert command in await _endless_answer_report(command)
