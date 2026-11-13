"""A converged apply clears from the staged buffer only what it applied, never what was staged while it ran.

A staged apply's first ``POST /restore`` is held on an event in the fake 8088 daemon while a second stage request is
sent; the buffer is read once the apply has converged.
"""

import asyncio
from collections.abc import Iterator

import pytest
from fixtures_clients import Wire

from overlap import Held, held_app


@pytest.fixture
def held(wire: Wire) -> Iterator[Held]:
    with held_app(wire) as app:
        yield app


async def _stage_while_applying(held: Held, during: dict[str, object]) -> dict[str, dict[str, object]]:
    async with held.session() as session:
        applying = asyncio.create_task(session.post("/api/config/apply"))
        await held.hold.entered.wait()
        await session.post("/api/config/stage", json=during)
        held.hold.release.set()
        await applying
        pending: dict[str, dict[str, object]] = (await session.get("/api/config/pending")).json()
    return pending


def _pending_after(held: Held, staged: dict[str, object], during: dict[str, object]) -> dict[str, dict[str, object]]:
    held.client.post("/api/config/stage", json=staged)
    return held.run(lambda app: _stage_while_applying(app, during))


def test_a_field_staged_during_the_apply_is_still_staged_after_it(held: Held) -> None:
    pending = _pending_after(held, {"http": {"title": "Renamed"}}, {"http": {"mode": "auto"}})
    assert pending["http"] == {"mode": "auto"}


def test_a_field_re_staged_during_the_apply_holds_its_new_value_after_it(held: Held) -> None:
    pending = _pending_after(held, {"http": {"title": "Renamed"}}, {"http": {"title": "Again"}})
    assert pending["http"] == {"title": "Again"}


def test_a_live_key_staged_during_the_apply_is_still_staged_after_it(held: Held) -> None:
    pending = _pending_after(held, {"http": {"title": "Renamed"}}, {"live": {"shaper": {"value": "5"}}})
    assert pending["live"] == {"shaper": {"value": "5"}}
