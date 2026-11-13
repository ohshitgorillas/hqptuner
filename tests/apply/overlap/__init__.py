"""An app whose first ``POST /restore`` is held at the fake 8088 daemon, for the cases that overlap two operations.

The hold is an ``asyncio.Event`` the transport awaits, so the app's loop keeps serving every other request while the
push waits, which the inline in-process fake cannot do. The overlap is forced by that seam and never by a wait
(docs/testing.md rule 7).
"""

import asyncio
import contextlib
from collections.abc import Awaitable, Callable, Iterator
from dataclasses import dataclass

import httpx
from apps import log_in, wait_for_api
from fake_network import NETWORK
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fixtures_clients import Wire
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.core.network import Network

#: Event-loop turns a case lets every other task run, ahead of reading what reached the daemon.
LULL_TURNS = 400


class RestoreHold:
    """The first ``POST /restore`` of an app, held after it reaches the daemon until ``release`` is set.

    ``entered`` is set when that push arrives, and ``posts`` is the path of every ``POST`` that reached the daemon, in
    arrival order, held or not.
    """

    def __init__(self) -> None:
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        self.posts: list[str] = []
        self._held = False

    def network(self, base: Network) -> Network:
        """``base`` with its 8088 transports answering through the hold."""

        def transport_for(host: str, port: int) -> httpx.AsyncBaseTransport:
            inner = base.http_transport(host, port)
            if inner is None:
                raise TypeError(host)

            async def answer_through(request: httpx.Request) -> httpx.Response:
                if request.method == "POST":
                    self.posts.append(request.url.path)
                if request.method == "POST" and request.url.path == "/restore" and not self._held:
                    self._held = True
                    self.entered.set()
                    await self.release.wait()
                return await inner.handle_async_request(request)

            return httpx.MockTransport(answer_through)

        return Network(open_stream=base.open_stream, http_transport=transport_for, open_datagram=base.open_datagram)


async def lull() -> None:
    """Let every task that is not waiting on an event run until it waits on something else."""
    for _ in range(LULL_TURNS):
        await asyncio.sleep(0)


@dataclass(frozen=True)
class Held:
    """A ready, logged-in app on a held restore, and the way to send it requests from inside its own loop."""

    client: TestClient
    app: FastAPI
    hold: RestoreHold

    def session(self) -> httpx.AsyncClient:
        """A logged-in client whose requests run on the loop the caller is on."""
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app), base_url="http://testserver", cookies=self.client.cookies
        )

    def run[T](self, scenario: Callable[["Held"], Awaitable[T]]) -> T:
        """Run ``scenario`` on the app's own event loop and return what it returns."""
        portal = self.client.portal
        if portal is None:
            raise RuntimeError
        outcome: T = portal.call(scenario, self)
        return outcome


@contextlib.contextmanager
def held_app(wire: Wire) -> Iterator[Held]:
    """The REST surface on ``wire``'s two fakes with the first ``POST /restore`` held, ready and logged in."""
    hold = RestoreHold()
    cfg = wire.config(
        alarm_threshold=1.0,
        hqp_home="/x/home",
        favorites_file=wire.tmp_path / "favorites.json",
        narrowing_file=wire.tmp_path / "narrowing.json",
        description_file=wire.tmp_path / "descriptions.json",
        matrix_mode_file=wire.tmp_path / "matrixmodes.json",
    )
    app = create_app(cfg, VirtualClock(), hold.network(NETWORK))
    with TestClient(app) as client:
        wait_for_api(client, lambda c: bool(c.get("/api/health").json()["ready"]))
        log_in(client)
        yield Held(client, app, hold)
