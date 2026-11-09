"""What the pair check says about a management username and password (docs/testing.md).

The three verdicts are stated at the wire, against the fake 8088 daemon: a default daemon, one that
challenges first (`fake_http._challenge_auth`), one that refuses the digest (`_refuse_auth`), one that is
down (`_down`, the 503 of a restarting daemon) and a port nothing listens on.
"""

from collections.abc import Callable, Iterator
from typing import Any

import fake_http
import fake_network
import httpx
import pytest
from virtual_clock import VirtualClock

from hqptuner.conf.httpauth import PairVerdict, check_pair
from hqptuner.conf.noanswer import PAGE_CEILING

#: A ceiling on a request the fake answers at once, never a duration anything is expected to take.
CEILING = 5.0

Daemon = Callable[..., dict[str, Any]]

#: Virtual seconds between the chunks of a body that never ends. It divides no total here (30 * 7 = 210 s against 30 s).
GAP = 7.0
ENDLESS = 30


async def _verdict(port: int) -> PairVerdict:
    """The pair check against the daemon at ``port`` of the in-process network."""
    transport = fake_network.http_transport("127.0.0.1", port)
    return await check_pair("127.0.0.1", port, "admin", "pw", CEILING, transport=transport)


@pytest.fixture
def daemon() -> Iterator[Daemon]:
    """Serve a fake 8088 daemon with the given state overrides; every one is taken down at teardown."""
    servers: list[Iterator[dict[str, Any]]] = []

    def serve(**overrides: object) -> dict[str, Any]:
        server = fake_http.spawn(fake_http.state(**overrides), in_process=True)
        servers.append(server)
        return next(server)

    yield serve
    for server in servers:
        next(server, None)


@pytest.mark.parametrize("overrides", [{}, {"_challenge_auth": True}], ids=["default", "challenged"])
async def test_a_daemon_that_serves_the_digest_accepts_the_pair(daemon: Daemon, overrides: dict[str, Any]) -> None:
    state = daemon(**overrides)
    assert await _verdict(state["_port"]) is PairVerdict.ACCEPTED


async def test_a_daemon_that_refuses_the_digest_refuses_the_pair(daemon: Daemon) -> None:
    state = daemon(_refuse_auth=True)
    assert await _verdict(state["_port"]) is PairVerdict.REFUSED


async def test_a_daemon_that_is_down_does_not_answer(daemon: Daemon) -> None:
    state = daemon(_down=True)
    assert await _verdict(state["_port"]) is PairVerdict.NOT_ANSWERED


async def test_a_port_nothing_listens_on_does_not_answer(closed_port: int) -> None:
    assert await _verdict(closed_port) is PairVerdict.NOT_ANSWERED


async def test_an_accepted_pair_whose_page_is_over_the_ceiling_does_not_answer() -> None:
    daemon = fake_network.ChallengingDaemon(
        lambda: httpx.Response(200, stream=httpx.ByteStream(b"p" * (PAGE_CEILING + 1)))
    )
    verdict = await check_pair("127.0.0.1", 8088, "admin", "pw", CEILING, transport=daemon.transport)
    assert verdict is PairVerdict.NOT_ANSWERED


async def test_an_accepted_pair_whose_page_drips_past_the_total_deadline_does_not_answer() -> None:
    clock = VirtualClock()
    daemon = fake_network.ChallengingDaemon(
        lambda: httpx.Response(200, stream=fake_network.Drip([b"p"] * ENDLESS, lambda: clock.sleep(GAP)))
    )
    verdict = await check_pair(
        "127.0.0.1",
        8088,
        "admin",
        "pw",
        CEILING,
        transport=daemon.transport,
        deadline=fake_network.TotalDeadline(clock.sleep),
    )
    assert verdict is PairVerdict.NOT_ANSWERED
