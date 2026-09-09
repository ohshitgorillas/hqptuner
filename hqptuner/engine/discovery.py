"""Finding hqplayerd on the network, so nobody has to type its address.

The daemon answers a multicast datagram with its friendly name and its product string, and the datagram's own
sender address is the daemon's host (protocol.md §2). That is enough to list what is out there and nothing
more: the product string names the major but never the operating system, so each address found is asked
``GetInfo`` over the control port for the rest.
"""

import asyncio
import logging
import socket
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, replace
from xml.etree import ElementTree

from hqptuner.engine.control import ControlClient, ControlError

log = logging.getLogger(__name__)

#: Documented IPv4 discovery group and port (protocol.md §2). The IPv6 group
#: ff08::c7 is documented beside it and is not sent on here; a daemon answering
#: only there is absent from the list rather than an error.
GROUP = "239.192.0.199"
PORT = 4321

#: The request datagram, byte for byte as protocol.md §2 gives it.
REQUEST = b'<?xml version="1.0" encoding="UTF-8"?><discover>hqplayer</discover>'

#: The address a container reaches its own host on, where the deployment provides
#: it. Settable through ``Config.container_host_alias`` because the name resolves
#: inside a container only, so nothing outside one can be pointed at it.
ALIAS = "host.docker.internal"


@dataclass(frozen=True)
class Daemon:
    """One hqplayerd that answered discovery: where it is, what it calls itself, what it says it is."""

    address: str
    name: str
    version: str
    product: str | None = None
    platform: str | None = None


def parse_reply(payload: bytes, address: str) -> Daemon | None:
    """Read one reply datagram into a record, or None where it is not a discovery reply.

    The address is the one the datagram arrived from, never one read out of the body: the body is not
    documented to carry an address at all, and a daemon behind any kind of forwarding would name the wrong one.
    """
    try:
        root = ElementTree.fromstring(payload)  # noqa: S314 - LAN datagram, attributes only, no entities read
    except ElementTree.ParseError:
        return None
    if root.tag != "discover":
        return None
    return Daemon(address=address, name=root.get("name", ""), version=root.get("version", ""))


def dedupe(daemons: Iterable[Daemon]) -> list[Daemon]:
    """Keep one record per address, in first-seen order, since a multi-homed daemon answers more than once.

    By address rather than by name: two daemons shipped with the same friendly name are two hosts, and
    collapsing them would drop one off the list entirely.
    """
    seen: set[str] = set()
    kept: list[Daemon] = []
    for daemon in daemons:
        if daemon.address in seen:
            continue
        seen.add(daemon.address)
        kept.append(daemon)
    return kept


async def enrich(
    daemons: Iterable[Daemon],
    get_info: Callable[[str], Awaitable[dict[str, str]]],
) -> list[Daemon]:
    """Fill product and platform from each daemon's own report, leaving them unset where that exchange fails.

    A failure here does not unanswer discovery: port 4321 refuses connections for about ten seconds after a
    daemon restart (protocol.md §1), so a daemon can answer the datagram and refuse the socket in the same
    breath. The record stays, with the two fields it could not learn left empty.
    """
    filled: list[Daemon] = []
    for daemon in daemons:
        try:
            info = await get_info(daemon.address)
        except (OSError, ControlError):
            log.info("discovery: %s answered but did not describe itself", daemon.address)
            filled.append(daemon)
            continue
        filled.append(replace(daemon, product=info.get("product"), platform=info.get("platform")))
    return filled


async def _describe(address: str, port: int, request_timeout: float) -> dict[str, str]:
    """Ask one daemon what it is, over its own control port, and hang up."""
    client = ControlClient(address, port, request_timeout)
    await client.connect()
    try:
        return await client.get_info()
    finally:
        await client.close()


async def probe(address: str, control_port: int, request_timeout: float) -> Daemon | None:
    """Answer the record for one address, or None where nothing answers there.

    The one path that names an address instead of waiting for a datagram, so an address that does not resolve
    or refuses is a non-event rather than an error: it is the same "nothing there" a silent sweep reports.
    """
    try:
        info = await _describe(address, control_port, request_timeout)
    except (OSError, ControlError):
        return None
    return Daemon(
        address=address,
        name=info.get("name", ""),
        version=info.get("version", ""),
        product=info.get("product"),
        platform=info.get("platform"),
    )


def _endpoint(target: str) -> tuple[str, int]:
    """Read the configured target as an address, with an optional ``:port`` overriding the documented 4321."""
    host, _, port = target.rpartition(":")
    return (host, int(port)) if host else (target, PORT)


async def _collect(sock: socket.socket, deadline: float) -> list[tuple[bytes, str]]:
    """Read datagrams off one socket until the deadline, each with the address it came from.

    There is no count to wait for: a daemon that is not there sends nothing, so the deadline is the only thing
    that ends the read.
    """
    loop = asyncio.get_running_loop()
    replies: list[tuple[bytes, str]] = []
    while (remaining := deadline - loop.time()) > 0:
        try:
            data, addr = await asyncio.wait_for(loop.sock_recvfrom(sock, 65535), remaining)
        except TimeoutError:
            break
        replies.append((data, addr[0]))
    return replies


async def discover(
    wait_seconds: float = 3.0,
    control_port: int = PORT,
    target: str = GROUP,
    alias: str = ALIAS,
) -> list[Daemon]:
    """Send one discovery datagram to the target, collect replies until the wait is up, return the records.

    The target is an address rather than a constant because multicast is the part of this least certain to
    work: a multi-homed host sends on whichever interface its routing table picks. Naming a host instead is
    the escape, and it is the same path, so nothing about the answer changes.

    A sweep that nothing answers asks the container-host alias directly, which is the case of a bridged
    container: the bridge carries no multicast, so the datagram reaches nobody while the daemon on the
    container's own host is one connection away. Only that case, because a daemon answering both would be
    listed twice, once by the address its datagram came from and once by the alias.
    """
    loop = asyncio.get_running_loop()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(0)  # non-blocking, so the loop owns the waiting
    try:
        await loop.sock_sendto(sock, REQUEST, _endpoint(target))
        replies = await _collect(sock, loop.time() + wait_seconds)
    finally:
        sock.close()
    found = [record for payload, address in replies if (record := parse_reply(payload, address))]
    if not found:
        answered = await probe(alias, control_port, wait_seconds)
        return [answered] if answered is not None else []

    async def describe(address: str) -> dict[str, str]:
        return await _describe(address, control_port, wait_seconds)

    return await enrich(dedupe(found), describe)
