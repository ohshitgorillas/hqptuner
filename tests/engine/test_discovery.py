"""Discovery: reading a reply datagram, collapsing the replies, and filling in
what each daemon says about itself.

The datagram bodies here are the wire's own (the 6.0.2 reply measured on this
host), written by the test rather than read back from the app. The reply body
carries no address of its own on the wire, so the daemon host is the sender
address of the datagram; the second payload below invents an ``address``
attribute purely so a record built from the body reads differently from one
built from the sender.

The identity fields of ``GetInfo`` (``product``, ``platform``) are attribute
names supplied to ``enrich`` by the test's own callable; the ten-second window
in which port 4321 refuses connections after a restart is why the refusing
daemon still has to come back as a record.

The search itself runs against a UDP daemon of the suite's own at one loopback
address and a control daemon at another, with the clock and the wait handed in,
so a whole search window passes in virtual time.

uvicorn runs the app on uvloop wherever uvloop is installed, so the same search
is also run on a uvloop loop and has to list what the standard loop lists. That
search ends in either a list or an exception; the helper hands back the
exception's name and text in place of the list, so a search that raised fails
the comparison rather than the run.
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Coroutine, Iterator
from contextvars import Context

import fake_discovery
import pytest
from apps import closed_port
from conftest import spawn_threaded_daemon
from virtual_deadline import VirtualDeadline

from hqptuner.engine.discovery import Daemon, NotAReplyError, Search, dedupe, discover, enrich, parse_reply

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
    """A daemon that answers GetInfo."""
    await asyncio.sleep(0)
    return {
        "engine": "6.0.4",
        "name": "Opal",
        "platform": "Linux",
        "product": "Signalyst HQPlayer Embedded",
        "version": "6",
    }


async def refusing_daemon(_address: str) -> dict[str, str]:
    """A daemon inside the ten-second window where 4321 refuses connections."""
    await asyncio.sleep(0)
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
    "payload",
    [b"not xml at all", b'<other name="Opal">hqplayer</other>'],
    ids=["unparseable body", "wrong root tag"],
)
def test_a_non_reply_datagram_raises_notareply(payload: bytes) -> None:
    with pytest.raises(NotAReplyError):
        parse_reply(payload, "10.0.0.238")


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

#: The request the wire specifies, byte for byte, and a reply of the documented
#: shape, both written here.
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
    target = f"{SEARCH_HOST}:{answering_port}" if datagram_answered else f"127.0.0.1:{closed_port()}"
    clock, sleep = virtual_time()
    search = Search(target=target, alias=ALIAS_HOST, control_port=alias_control_port)
    found = await discover(search, wait_seconds=WAIT, clock=clock, sleep=sleep)
    assert [daemon.address for daemon in found] == expected


async def search_addresses(alias_control_port: int, *, datagram_answered: bool) -> list[str]:
    """The addresses one search lists, with the answering daemon served from the
    loop the search itself runs on."""
    async with fake_discovery.responder({REQUEST: SAPPHIRE_DATAGRAM}, host=SEARCH_HOST) as answering:
        target = f"{SEARCH_HOST}:{answering}" if datagram_answered else f"127.0.0.1:{closed_port()}"
        clock, sleep = virtual_time()
        search = Search(target=target, alias=ALIAS_HOST, control_port=alias_control_port)
        found = await discover(search, wait_seconds=WAIT, clock=clock, sleep=sleep)
    return [daemon.address for daemon in found]


async def settled(search: Coroutine[None, None, list[str]]) -> asyncio.Task[list[str]]:
    """The search run to its end, as a task holding its list or its exception."""
    task = asyncio.ensure_future(search)
    await asyncio.wait([task])
    return task


def searched_on_uvloop(alias_control_port: int, *, datagram_answered: bool) -> list[str] | str:
    """The addresses a search run on uvloop lists, or the exception it raised,
    by name and text."""
    uvloop = pytest.importorskip("uvloop", reason="uvloop is not installed in this environment")
    search = search_addresses(alias_control_port, datagram_answered=datagram_answered)
    task = asyncio.run(settled(search), loop_factory=uvloop.new_event_loop)
    failure = task.exception()
    if failure is not None:
        return f"{type(failure).__name__}: {failure}"
    return task.result()


@pytest.mark.parametrize(
    ("datagram_answered", "expected"),
    [
        (True, [SEARCH_HOST]),
        (False, [ALIAS_HOST]),
    ],
)
def test_a_search_on_uvloop_lists_what_the_standard_loop_lists(
    alias_control_port: int,
    *,
    datagram_answered: bool,
    expected: list[str],
) -> None:
    assert searched_on_uvloop(alias_control_port, datagram_answered=datagram_answered) == expected


class TimerLedgerLoop(asyncio.SelectorEventLoop):
    """The standard event loop, keeping the delay of every real-clock timer that
    ran out on it. A timer cancelled before its time is not a wait on the clock
    and is not kept."""

    def __init__(self, ran_out: list[float]) -> None:
        super().__init__()
        self.ran_out = ran_out

    def call_at[*Ts](
        self,
        when: float,
        callback: Callable[[*Ts], object],
        *args: *Ts,
        context: Context | None = None,
    ) -> asyncio.TimerHandle:
        delay = when - self.time()

        def fired(*fired_args: *Ts) -> object:
            if delay > 0:
                self.ran_out.append(delay)
            return callback(*fired_args)

        return super().call_at(when, fired, *args, context=context)


@pytest.fixture
def silent_control_port() -> Iterator[int]:
    """A control daemon at the address the datagram comes from, which takes the
    connection and never answers GetInfo."""
    served = spawn_threaded_daemon(overrides={"_stall": "GetInfo"}, host=SEARCH_HOST)
    yield next(served)
    next(served, None)


async def silent_search(control_port: int) -> list[str]:
    """The addresses one search lists when its datagram is answered from
    SEARCH_HOST and HQPlayer has fallen silent on the deadline the search is
    handed, paced on a clock of the test's own."""
    deadline = VirtualDeadline()
    deadline.fall_silent()
    async with fake_discovery.responder({REQUEST: SAPPHIRE_DATAGRAM}, host=SEARCH_HOST) as answering:
        clock, sleep = virtual_time()
        search = Search(target=f"{SEARCH_HOST}:{answering}", alias=ALIAS_HOST, control_port=control_port)
        found = await discover(search, wait_seconds=WAIT, clock=clock, sleep=sleep, deadline=deadline)
    return [daemon.address for daemon in found]


def listed_without_real_time(control_port: int) -> list[str] | str:
    """The addresses a silent search lists; in their place, the exception it
    raised by name and text, or the delay of every real-clock timer that ran
    out while it ran."""
    ran_out: list[float] = []
    task = asyncio.run(settled(silent_search(control_port)), loop_factory=lambda: TimerLedgerLoop(ran_out))
    failure = task.exception()
    if failure is not None:
        return f"{type(failure).__name__}: {failure}"
    if ran_out:
        return f"real-clock timers ran out: {ran_out}"
    return task.result()


def test_a_search_whose_found_hqplayer_falls_silent_ends_on_the_handed_deadline_without_real_time(
    silent_control_port: int,
) -> None:
    assert listed_without_real_time(silent_control_port) == [SEARCH_HOST]
