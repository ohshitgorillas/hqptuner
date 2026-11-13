"""A converged apply releases from the filter park only the uploads it carried, never one parked while it ran.

A staged apply's first ``POST /restore`` is held on an event in the fake 8088 daemon while a filter is uploaded. The
hold is an ``asyncio.Event`` the transport awaits, so the app keeps serving the upload while the push waits
(docs/testing.md rule 7).
"""

import asyncio
from collections.abc import Iterator

import httpx
import pytest
from apps import log_in, wait_for_api
from conftest import minimal_wave
from fake_network import NETWORK
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fixtures_clients import Wire
from virtual_clock import VirtualClock

from hqptuner.api.factory import create_app
from hqptuner.core.network import Network


class Hold:
    """The first ``POST /restore`` of an app, held after it reaches the daemon until ``release`` is set."""

    def __init__(self) -> None:
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        self._held = False

    def network(self, base: Network) -> Network:
        """``base`` with its 8088 transports answering through the hold."""

        def transport_for(host: str, port: int) -> httpx.AsyncBaseTransport:
            inner = base.http_transport(host, port)
            if inner is None:
                raise TypeError(host)

            async def answer_through(request: httpx.Request) -> httpx.Response:
                if request.method == "POST" and request.url.path == "/restore" and not self._held:
                    self._held = True
                    self.entered.set()
                    await self.release.wait()
                return await inner.handle_async_request(request)

            return httpx.MockTransport(answer_through)

        return Network(open_stream=base.open_stream, http_transport=transport_for, open_datagram=base.open_datagram)


@pytest.fixture
def app(wire: Wire) -> Iterator[tuple[TestClient, FastAPI, Hold]]:
    hold = Hold()
    cfg = wire.config(
        alarm_threshold=1.0,
        hqp_home="/x/home",
        favorites_file=wire.tmp_path / "favorites.json",
        narrowing_file=wire.tmp_path / "narrowing.json",
        description_file=wire.tmp_path / "descriptions.json",
        matrix_mode_file=wire.tmp_path / "matrixmodes.json",
    )
    served = create_app(cfg, VirtualClock(), hold.network(NETWORK))
    with TestClient(served) as client:
        wait_for_api(client, lambda c: bool(c.get("/api/health").json()["ready"]))
        log_in(client)
        yield client, served, hold


async def _upload_while_applying(served: FastAPI, client: TestClient, hold: Hold) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=served), base_url="http://testserver", cookies=client.cookies
    ) as session:
        applying = asyncio.create_task(session.post("/api/config/apply"))
        await hold.entered.wait()
        await session.post("/api/matrix/filter", files={"file": ("late.wav", minimal_wave(), "audio/wav")})
        hold.release.set()
        await applying


def test_a_filter_uploaded_during_the_apply_is_still_parked_after_it(app: tuple[TestClient, FastAPI, Hold]) -> None:
    client, served, hold = app
    client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    portal = client.portal
    if portal is None:
        raise RuntimeError
    portal.call(_upload_while_applying, served, client, hold)
    assert list(served.state.manager.presetops.parked_filter_members()) == ["data/late.wav"]
