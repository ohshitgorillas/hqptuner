"""Control API receive resilience.

The daemon emits track <metadata> with unescaped characters during playback,
which strict XML parsing can't handle. The receiver must still deliver the
Status root attributes (active_filter/active_shaper/active_rate) rather than
blocking to timeout — otherwise the signal-path display goes blank mid-track.

A reply can also reach the client in several writes, and a write can end on a
child's ``/>`` or inside a quoted attribute value carrying ``>`` or ``/>``. The
split cases serve one reply as the writes they list, yielding the loop between
writes so the client reads each one before the next lands, and read the parsed
root back.
"""

import asyncio
import xml.etree.ElementTree as ET
from collections.abc import AsyncIterator, Awaitable, Callable

import pytest

from hqptuner.engine.control import ControlClient

XML = '<?xml version="1.0" encoding="UTF-8"?>'

#: Loop passes the fake yields between two writes, so the client's pending read takes the first before the second.
YIELDS = 3

Reply = Callable[[tuple[str, ...]], Awaitable[ET.Element]]


async def test_get_status_recovers_root_when_metadata_is_malformed(
    garbled_metadata_client: ControlClient,
) -> None:
    status, _meta = await garbled_metadata_client.get_status()
    assert status["active_filter"] == "poly-sinc-gauss-long"


@pytest.fixture
async def split_reply() -> AsyncIterator[Reply]:
    """The root a client parses from one reply the fake sends as the writes it is given."""
    servers: list[asyncio.Server] = []
    clients: list[ControlClient] = []

    async def reply(writes: tuple[str, ...]) -> ET.Element:
        async def serve(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await reader.read(4096)
            for piece in writes:
                writer.write(piece.encode())
                await writer.drain()
                for _ in range(YIELDS):
                    await asyncio.sleep(0)
            await reader.read(4096)
            writer.close()

        server = await asyncio.start_server(serve, "127.0.0.1", 0)
        servers.append(server)
        client = ControlClient("127.0.0.1", server.sockets[0].getsockname()[1], timeout=2.0)
        clients.append(client)
        await client.connect()
        return await client.request("<GetFilters/>")

    yield reply
    for client in clients:
        await client.close()
    for server in servers:
        server.close()
        await server.wait_closed()


#: The `<FiltersItem>` children the split reply below carries.
FILTER_ITEMS = 2

CHILDREN_SPLIT_AFTER_A_SELF_CLOSE = (
    f'{XML}<GetFilters><FiltersItem index="0" name="alpha"/>',
    '<FiltersItem index="1" name="beta"/>',
    "</GetFilters>\n",
)


async def test_a_reply_whose_writes_end_on_a_childs_self_close_keeps_every_child(split_reply: Reply) -> None:
    assert len(list(await split_reply(CHILDREN_SPLIT_AFTER_A_SELF_CLOSE))) == FILTER_ITEMS


@pytest.mark.parametrize(
    ("writes", "name"),
    [
        ((f'{XML}<GetFilters result="OK" name="a/>', 'b"/>\n'), "a/>b"),
        ((f'{XML}<GetFilters result="OK" name="x>', 'y"><FiltersItem index="0"/>', "</GetFilters>\n"), "x>y"),
    ],
    ids=["self-closing root cut after a quoted '/>'", "open root cut after a quoted '>'"],
)
async def test_a_reply_cut_inside_a_quoted_attribute_keeps_the_whole_value(
    split_reply: Reply, writes: tuple[str, ...], name: str
) -> None:
    assert (await split_reply(writes)).attrib["name"] == name
