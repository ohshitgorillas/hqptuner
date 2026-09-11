"""Discovery: reading a reply datagram, collapsing the replies, and filling in
what each daemon says about itself.

The datagram bodies here are the wire's own (docs/protocol.md §2, and the 6.0.2
reply measured on this host), written by the test rather than read back from the
app. The reply body carries no address of its own on the wire, so the daemon
host is the sender address of the datagram (docs/protocol.md:38); the second
payload below invents an ``address`` attribute purely so a record built from the
body reads differently from one built from the sender.

The identity fields of ``GetInfo`` (``product``, ``platform``) are attribute
names from docs/protocol.md §6, supplied to ``enrich`` by the test's own
callable; the ten-second window in which port 4321 refuses connections after a
restart (docs/protocol.md:21) is why the refusing daemon still has to come back
as a record.

The search itself runs against a UDP daemon of the suite's own at one loopback
address and a control daemon at another, with the clock and the wait handed in,
so a whole search window passes in virtual time (docs/testing.md rule 7).
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator

import fake_discovery
import pytest
from conftest import _closed_port, spawn_threaded_daemon

from hqptuner.engine.discovery import Daemon, Search, dedupe, discover, enrich, parse_reply

OPAL_REPLY = b'<discover name="Opal" result="OK" version="Signalyst HQPlayer Embedded 6">hqplayer</discover>'
SAPPHIRE_REPLY = (
    b'<discover name="Sapphire" result="OK" version="Signalyst HQPlayer Embedded 6"'
    b' address="10.0.0.99">hqplayer</discover>'
)
EMBEDDED_6 = "Signalyst HQPlayer Embedded 6"
OPAL = Daemon(address="10.0.0.238", name="Opal", version=EMBEDDED_6)


def triple(record: Daemon | None) -> tuple[str, str, str] | None:
    """The three fields a reply carries, or None where nothing was read."""
    if record is None:
        return None
    return (record.address, record.name, record.version)


def five(record: Daemon) -> tuple[str, str, str, str | None, str | None]:
    """Every field of an enriched record, in declaration order."""
    return (record.address, record.name, record.version, record.product, record.platform)


async def answering_daemon(_address: str) -> dict[str, str]:
    """A daemon that answers GetInfo with the attribute set of docs/protocol.md §6."""
    return {
        "engine": "6.0.4",
        "name": "Opal",
        "platform": "Linux",
        "product": "Signalyst HQPlayer Embedded",
        "version": "6",
    }


async def refusing_daemon(_address: str) -> dict[str, str]:
    """A daemon inside the ten-second window where 4321 refuses connections."""
    raise ConnectionRefusedError(111, "Connection refused")


@pytest.mark.parametrize(
    ("payload", "sender", "expected"),
    [
        (OPAL_REPLY, "10.0.0.238", ("10.0.0.238", "Opal", EMBEDDED_6)),
        (SAPPHIRE_REPLY, "10.0.0.7", ("10.0.0.7", "Sapphire", EMBEDDED_6)),
    ],
)
def test_a_reply_reads_as_the_sender_address_beside_the_bodys_name_and_version(
    payload: bytes, sender: str, expected: tuple[str, str, str]
) -> None:
    assert triple(parse_reply(payload, sender)) == expected


@pytest.mark.parametrize(
    ("records", "expected"),
    [
        ([("10.0.0.238", "Opal"), ("10.0.0.238", "Opal")], ["10.0.0.238"]),
        ([("10.0.0.238", "Opal"), ("10.0.0.99", "Opal")], ["10.0.0.238", "10.0.0.99"]),
    ],
)
def test_collapsing_records_keeps_one_per_address_in_first_seen_order(
    records: list[tuple[str, str]], expected: list[str]
) -> None:
    daemons = [Daemon(address=address, name=name, version=EMBEDDED_6) for address, name in records]
    assert [daemon.address for daemon in dedupe(daemons)] == expected


@pytest.mark.parametrize(
    ("get_info", "expected"),
    [
        (
            answering_daemon,
            ("10.0.0.238", "Opal", EMBEDDED_6, "Signalyst HQPlayer Embedded", "Linux"),
        ),
        (refusing_daemon, ("10.0.0.238", "Opal", EMBEDDED_6, None, None)),
    ],
)
async def test_enriching_fills_product_and_platform_and_keeps_a_daemon_that_refuses(
    get_info: Callable[[str], Awaitable[dict[str, str]]],
    expected: tuple[str, str, str, str | None, str | None],
) -> None:
    enriched = await enrich([OPAL], get_info)
    assert [five(record) for record in enriched] == [expected]


#: Two loopback addresses, so the daemon that answers the datagram and the one
#: the container-host alias names are told apart by the address they carry.
SEARCH_HOST = "127.0.0.2"
ALIAS_HOST = "127.0.0.3"

#: The request the wire specifies, byte for byte (docs/protocol.md:26-29), and a
#: reply of the documented shape (docs/protocol.md:35), both written here.
REQUEST = b'<?xml version="1.0" encoding="UTF-8"?><discover>hqplayer</discover>'
SAPPHIRE_DATAGRAM = b'<discover result="OK" name="Sapphire" version="Signalyst HQPlayer Embedded 6">hqplayer</discover>'

#: The search window, spent in virtual seconds: long enough that the search
#: reads many times over before it closes, and costing no wall clock at all.
WAIT = 1.0


def virtual_time() -> tuple[Callable[[], float], Callable[[float], Awaitable[None]]]:
    """A clock the search's own waits advance: a wait adds to the offset the
    clock reads back, so the window closes after passes rather than seconds."""
    offset = 0.0

    def clock() -> float:
        return offset

    async def sleep(seconds: float) -> None:
        nonlocal offset
        offset += seconds
        await asyncio.sleep(0)  # still yield: the replies arrive between passes

    return clock, sleep


@pytest.fixture
def alias_control_port() -> Iterator[int]:
    """A control daemon listening at the address the alias names."""
    served = spawn_threaded_daemon(host=ALIAS_HOST)
    yield next(served)
    next(served, None)


@pytest.fixture
async def answering_port() -> AsyncIterator[int]:
    """A daemon answering the discovery datagram at the other address."""
    async with fake_discovery.responder({REQUEST: SAPPHIRE_DATAGRAM}, host=SEARCH_HOST) as port:
        yield port


@pytest.mark.parametrize(
    ("datagram_answered", "expected"),
    [
        (True, [SEARCH_HOST]),
        (False, [ALIAS_HOST]),
    ],
)
async def test_the_host_alias_is_listed_only_where_no_datagram_was_answered(
    alias_control_port: int,
    answering_port: int,
    *,
    datagram_answered: bool,
    expected: list[str],
) -> None:
    target = f"{SEARCH_HOST}:{answering_port}" if datagram_answered else f"127.0.0.1:{_closed_port()}"
    clock, sleep = virtual_time()
    search = Search(target=target, alias=ALIAS_HOST, control_port=alias_control_port)
    found = await discover(search, wait_seconds=WAIT, clock=clock, sleep=sleep)
    assert [daemon.address for daemon in found] == expected
