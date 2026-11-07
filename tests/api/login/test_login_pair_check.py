"""What the pair check says about a management username and password (docs/testing.md).

The three verdicts are stated at the wire, against the fake 8088 daemon: a default daemon, one that
challenges first (`fake_http._challenge_auth`), one that refuses the digest (`_refuse_auth`), one that is
down (`_down`, the 503 of a restarting daemon) and a port nothing listens on.
"""

from collections.abc import Callable, Iterator
from typing import Any

import fake_http
import pytest

from hqptuner.conf.httpauth import PairVerdict, check_pair

#: A ceiling on a request the fake answers at once, never a duration anything is expected to take.
CEILING = 5.0

Daemon = Callable[..., dict[str, Any]]


@pytest.fixture
def daemon() -> Iterator[Daemon]:
    """Serve a fake 8088 daemon with the given state overrides; every one is taken down at teardown."""
    servers: list[Iterator[dict[str, Any]]] = []

    def serve(**overrides: object) -> dict[str, Any]:
        server = fake_http.spawn(fake_http.state(**overrides))
        servers.append(server)
        return next(server)

    yield serve
    for server in servers:
        next(server, None)


@pytest.mark.parametrize("overrides", [{}, {"_challenge_auth": True}], ids=["default", "challenged"])
async def test_a_daemon_that_serves_the_digest_accepts_the_pair(daemon: Daemon, overrides: dict[str, Any]) -> None:
    state = daemon(**overrides)
    assert await check_pair("127.0.0.1", state["_port"], "admin", "pw", CEILING) is PairVerdict.ACCEPTED


async def test_a_daemon_that_refuses_the_digest_refuses_the_pair(daemon: Daemon) -> None:
    state = daemon(_refuse_auth=True)
    assert await check_pair("127.0.0.1", state["_port"], "admin", "pw", CEILING) is PairVerdict.REFUSED


async def test_a_daemon_that_is_down_does_not_answer(daemon: Daemon) -> None:
    state = daemon(_down=True)
    assert await check_pair("127.0.0.1", state["_port"], "admin", "pw", CEILING) is PairVerdict.NOT_ANSWERED


async def test_a_port_nothing_listens_on_does_not_answer(closed_port: int) -> None:
    assert await check_pair("127.0.0.1", closed_port, "admin", "pw", CEILING) is PairVerdict.NOT_ANSWERED
