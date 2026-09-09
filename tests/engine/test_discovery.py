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

The route case drives the real socket: a UDP responder bound to 127.0.0.1 on an
ephemeral port is the discovery target, and the control port is a hole, so the
two identity fields come back unfilled and the entry carries what the responder
itself said. Nothing here sends to the multicast group.
"""

import asyncio
import contextlib
import socket
import threading
from collections.abc import Awaitable, Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from hqptuner.api.factory import create_app
from hqptuner.config import Config
from hqptuner.engine.discovery import Daemon, dedupe, enrich, parse_reply

OPAL_REPLY = b'<discover name="Opal" result="OK" version="Signalyst HQPlayer Embedded 6">hqplayer</discover>'
SAPPHIRE_REPLY = (
    b'<discover name="Sapphire" result="OK" version="Signalyst HQPlayer Embedded 6"'
    b' address="10.0.0.99">hqplayer</discover>'
)
SAPPHIRE_5_REPLY = b'<discover name="Sapphire" result="OK" version="Signalyst HQPlayer Embedded 5">hqplayer</discover>'
EMBEDDED_6 = "Signalyst HQPlayer Embedded 6"
EMBEDDED_5 = "Signalyst HQPlayer Embedded 5"
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


async def _answer_discovery(sock: socket.socket, reply: bytes) -> None:
    """A daemon on the discovery wire: for the datagram that arrives, answer the
    one reply the case wrote. Table, not logic (docs/testing.md rule 13)."""
    loop = asyncio.get_running_loop()
    _datagram, sender = await loop.sock_recvfrom(sock, 4096)
    await loop.sock_sendto(sock, reply, sender)


@contextlib.contextmanager
def discovery_responder(reply: bytes) -> Iterator[str]:
    """Run the responder on 127.0.0.1 at an ephemeral port for the block, and
    hand back the target a caller sends its discovery datagram to."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 0))
    sock.settimeout(0)  # non-blocking, so the loop drives the reads
    host, port = sock.getsockname()[:2]
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    answering = asyncio.run_coroutine_threadsafe(_answer_discovery(sock, reply), loop)
    try:
        yield f"{host}:{port}"
    finally:
        answering.cancel()
        loop.call_soon_threadsafe(loop.stop)
        thread.join()
        loop.close()
        sock.close()


def entry(record: dict[str, Any]) -> tuple[Any, Any, Any, Any, Any]:
    """The five fields one answered entry states, in declaration order."""
    return (
        record["address"],
        record["name"],
        record["version"],
        record["product"],
        record["platform"],
    )


@pytest.mark.parametrize(
    ("reply", "expected"),
    [
        (OPAL_REPLY, ("127.0.0.1", "Opal", EMBEDDED_6, None, None)),
        (SAPPHIRE_5_REPLY, ("127.0.0.1", "Sapphire", EMBEDDED_5, None, None)),
    ],
)
def test_the_route_answers_one_five_field_entry_per_daemon_that_replied(
    reply: bytes, expected: tuple[str, str, str, None, None], closed_port: int
) -> None:
    with discovery_responder(reply) as target:
        cfg = Config(
            hqp_host="127.0.0.1",
            hqp_control_port=closed_port,
            discovery_target=target,
            discovery_timeout=0.05,
        )
        with TestClient(create_app(cfg)) as client:
            answered = client.get("/api/discover").json()
    assert [entry(record) for record in answered] == [expected]
