"""Two staged applies at once take turns: the second waits behind the first and then answers as it always does.

A staged apply's first ``POST /restore`` is held on an event in the fake 8088 daemon while a second apply is sent.
What reached the daemon while the first was held says whether the second waited its turn.
"""

import asyncio
from collections.abc import Iterator
from dataclasses import dataclass

import pytest
from fixtures_clients import Wire

from overlap import Held, held_app, lull


@pytest.fixture
def held(wire: Wire) -> Iterator[Held]:
    with held_app(wire) as app:
        yield app


@dataclass(frozen=True)
class Overlap:
    """What two applies sent one after the other, the first held at the daemon, left behind."""

    pushes_while_held: int
    statuses: list[int]


async def _two_applies(held: Held) -> Overlap:
    async with held.session() as session:
        first = asyncio.create_task(session.post("/api/config/apply"))
        await held.hold.entered.wait()
        second = asyncio.create_task(session.post("/api/config/apply"))
        await lull()
        pushes = held.hold.posts.count("/restore")
        held.hold.release.set()
        answers = await asyncio.gather(first, second)
    return Overlap(pushes, [answer.status_code for answer in answers])


@pytest.fixture
def overlap(held: Held) -> Overlap:
    held.client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    return held.run(_two_applies)


def test_a_second_apply_pushes_nothing_while_the_first_is_held_at_the_daemon(overlap: Overlap) -> None:
    assert overlap.pushes_while_held == 1


def test_a_second_apply_that_waited_answers_success(overlap: Overlap) -> None:
    assert overlap.statuses == [200, 200]
