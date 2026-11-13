"""Two staged applies at once take turns: the second waits behind the first and then answers as it always does.

A staged apply's first ``POST /restore`` is held on an event in the fake 8088 daemon while a second apply is sent.
What reached the daemon while the first was held says whether the second waited its turn.
"""

import asyncio
from collections.abc import Callable, Coroutine, Iterator
from dataclasses import dataclass
from typing import Any

import httpx
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


# --- every other lane that restores or reloads the engine takes its turn too ---


@dataclass(frozen=True)
class Lane:
    """One write lane, as the request a client sends it."""

    send: Callable[[httpx.AsyncClient], Coroutine[Any, Any, httpx.Response]]


def _post(path: str, sent: dict[str, object]) -> Lane:
    async def send(session: httpx.AsyncClient) -> httpx.Response:
        return await session.post(path, json=sent)

    return Lane(send)


async def _upload(session: httpx.AsyncClient) -> httpx.Response:
    archive = (await session.get("/api/backup")).content
    return await session.post("/api/restore", files={"cfgfile": ("settings.zip", archive, "application/zip")})


LANES = {
    "preset load": _post("/api/profile/load", {"name": "Kept"}),
    "preset save": _post("/api/profile/save", {"name": "Saved"}),
    "engine apply": _post("/api/engine", {"overrides": {"cuda": "0"}}),
    "uploaded restore": Lane(_upload),
    "speaker apply": _post("/api/speakers", {"enabled": True, "channels": {}}),
}


@dataclass(frozen=True)
class LaneOverlap:
    """What a lane sent while a staged apply was held at the daemon, and how both answered."""

    posts_when_held: list[str]
    posts_after_a_lull: list[str]
    statuses: list[int]


async def _apply_then_lane(held: Held, lane: Lane) -> LaneOverlap:
    async with held.session() as session:
        first = asyncio.create_task(session.post("/api/config/apply"))
        await held.hold.entered.wait()
        held_at = list(held.hold.posts)
        second = asyncio.create_task(lane.send(session))
        await lull()
        lulled = list(held.hold.posts)
        held.hold.release.set()
        answers = await asyncio.gather(first, second)
    return LaneOverlap(held_at, lulled, [answer.status_code for answer in answers])


@pytest.fixture(params=LANES, ids=list(LANES))
def lane_overlap(held: Held, request: pytest.FixtureRequest) -> LaneOverlap:
    held.hold.armed = False
    held.client.post("/api/profile/save", json={"name": "Kept"})
    held.hold.armed = True
    held.client.post("/api/config/stage", json={"http": {"title": "Renamed"}})
    return held.run(lambda app: _apply_then_lane(app, LANES[request.param]))


def test_a_lane_sends_nothing_to_the_daemon_while_an_apply_is_held(lane_overlap: LaneOverlap) -> None:
    assert lane_overlap.posts_after_a_lull == lane_overlap.posts_when_held


def test_a_lane_that_waited_answers_success(lane_overlap: LaneOverlap) -> None:
    assert lane_overlap.statuses == [200, 200]
