"""Control client behavior against a fake daemon speaking real protocol XML
over a real socket, including the documented wire quirks (protocol.md §1).

Policy: docs/testing.md — one condition per test, behavior only.
"""

import asyncio
from collections.abc import AsyncIterator

import pytest

from hqptuner.control import CommandError, ControlClient

XML = '<?xml version="1.0" encoding="UTF-8"?>'


async def _serve(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    while True:
        try:
            data = await reader.read(4096)
        except ConnectionResetError:
            break
        if not data:
            break
        body = data.split(b"?>", 1)[-1].strip()
        if body == b"<GetInfo/>":
            writer.write(f'{XML}<GetInfo name="Fake" engine="6.0.4" version="6"/>\n'.encode())
        elif body == b"<GetFilters/>":
            # container split across two writes with a flush gap
            writer.write(f'{XML}<GetFilters><FiltersItem index="0" name="IIR" '.encode())
            await writer.drain()
            await asyncio.sleep(0.05)
            writer.write(
                b'value="64" arg="1"/><FiltersItem index="1" name="poly-sinc" value="1" arg="0"/>'
                b"</GetFilters>\n"
            )
        elif body.startswith(b"<Status"):
            # bare '&' (album) and double-escaped entity (artist) in one doc
            writer.write(
                f'{XML}<Status state="2" volume="-3"><metadata '
                f'artist="Simon &amp;amp; Garfunkel" album="Bookends & More"/></Status>\n'.encode()
            )
        elif body.startswith(b"<SetFilter"):
            writer.write(f'{XML}<SetFilter result="Error">invalid filter</SetFilter>\n'.encode())
        else:
            writer.write(f'{XML}<Unknown result="Error">Unknown command</Unknown>\n'.encode())
        await writer.drain()


@pytest.fixture
async def client() -> AsyncIterator[ControlClient]:
    server = await asyncio.start_server(_serve, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    c = ControlClient("127.0.0.1", port, timeout=2.0)
    await c.connect()
    yield c
    await c.close()
    server.close()
    await server.wait_closed()


async def test_get_info_returns_daemon_identity(client: ControlClient) -> None:
    assert (await client.get_info())["engine"] == "6.0.4"


async def test_enumeration_reassembles_split_frames(client: ControlClient) -> None:
    assert [i["name"] for i in await client.get_enumeration("GetFilters")] == ["IIR", "poly-sinc"]


async def test_bare_ampersand_in_attribute_is_tolerated(client: ControlClient) -> None:
    _, meta = await client.get_status()
    assert meta["album"] == "Bookends & More"


async def test_double_escaped_entities_are_fully_unescaped(client: ControlClient) -> None:
    _, meta = await client.get_status()
    assert meta["artist"] == "Simon & Garfunkel"


async def test_setter_error_result_raises(client: ControlClient) -> None:
    with pytest.raises(CommandError, match="invalid filter"):
        await client.set_command("SetFilter", value="999")
