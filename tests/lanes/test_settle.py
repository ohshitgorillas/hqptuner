"""A request that restarts the daemon, and the waits on what it did, read off the one phase.

A restart request is stamped as the
daemon accepts it and not before; a wait for the restart to land never releases on
the instance the restart is about to kill, and hands its deadline back as a result;
a write's own readback settles the request in place. The request goes to the fake
8088 daemon. Nothing feeds the phase from 4321 here, so each case feeds the wire
facts from a table at the clock readings the table gives, and every wait runs on a
``VirtualClock``.
"""

import asyncio
import contextlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
from conftest import ManagerFactory
from virtual_clock import VirtualClock

from hqptuner.core.lifecycle import Fact, Outcome
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes import settle

#: The window every case runs under: the production default.
WINDOW = 15.0

#: The instance standing when the request goes out, one a foreign restart brings
#: up while the request is in flight, and the one the own restart brings up.
OLD = "old"
MID = "mid"
NEW = "new"

#: What a wait concluded on when it did not land, and who answers while nothing does.
GAVE_UP = "gave up"
NOBODY = "nobody"

#: A wire fact at a clock reading, beside the instance that put it on the wire.
Row = tuple[float, Fact, str | None]

_ANSWERS = frozenset({Fact.GETINFO_ANSWERED, Fact.FORM_ANSWERED})


@dataclass
class Wire:
    """Which instance last answered on the wire as the table is fed."""

    answering: str = OLD


@dataclass(frozen=True)
class Conclusion:
    """What a wait answered and who was answering on the wire when it did."""

    landed: bool
    answering: str

    @property
    def landed_on(self) -> str:
        """The instance the wait released on, or ``GAVE_UP``."""
        return self.answering if self.landed else GAVE_UP


@dataclass(frozen=True)
class Case:
    """Facts the wire delivers while the request is in flight and after it is accepted."""

    after: list[Row]
    in_flight: list[Row] = field(default_factory=list)
    deadline: float | None = None


async def feed(mgr: ConnectionManager, clock: VirtualClock, wire: Wire, rows: list[Row]) -> None:
    """Report each row's fact at its clock reading, counted from now."""
    start = clock.monotonic()
    for at, fact, instance in rows:
        await clock.advance(start + at - clock.monotonic())
        wire.answering = instance if fact in _ANSWERS and instance is not None else NOBODY
        mgr.phase.report(fact, clock.monotonic())


def stand_on_old(mgr: ConnectionManager, clock: VirtualClock) -> None:
    """Stand Ready on the instance the request goes to."""
    mgr.phase.report(Fact.GETINFO_ANSWERED, clock.monotonic())
    mgr.phase.report(Fact.FORM_ANSWERED, clock.monotonic())


def restore_own_backup(
    mgr: ConnectionManager, clock: VirtualClock, wire: Wire, in_flight: list[Row]
) -> Callable[[], Awaitable[None]]:
    """A ``POST /restore`` of the backup the daemon hands out, after the wire delivers ``in_flight``."""

    async def request() -> None:
        http = mgr.require_http()
        archive = await http.backup()
        await feed(mgr, clock, wire, in_flight)
        await http.restore(archive)

    return request


async def conclude(mgr: ConnectionManager, clock: VirtualClock, case: Case) -> Conclusion:
    """Restart, wait for Ready after the mark while the wire delivers ``case.after``, and say how it ended."""
    wire = Wire()
    stand_on_old(mgr, clock)
    mark = await settle.restart(mgr, restore_own_backup(mgr, clock, wire, case.in_flight))
    done = asyncio.Event()

    async def watch() -> Conclusion:
        try:
            landed = await settle.await_ready(mgr, mark, case.deadline)
            return Conclusion(landed, wire.answering)
        finally:
            done.set()

    waiter = asyncio.create_task(watch())
    await feed(mgr, clock, wire, case.after)
    await clock.wait(done, 10 * WINDOW)
    return await waiter


async def reading_after_departure(mgr: ConnectionManager, clock: VirtualClock) -> Outcome:
    """Send a restart request, let the daemon depart and come back, and read how the phase says it ended."""
    stand_on_old(mgr, clock)
    with contextlib.suppress(httpx.HTTPError):
        await settle.restart(mgr, restore_own_backup(mgr, clock, Wire(), []))
    await feed(mgr, clock, Wire(), DEPARTS_AND_RETURNS)
    return mgr.phase.outcome()


@dataclass
class Readback:
    """A readback probe that confirms from pass ``confirms_on`` on, counting its passes."""

    confirms_on: int
    passes: int = 0

    async def __call__(self) -> bool | None:
        """Read back once."""
        self.passes += 1
        return True if self.passes >= self.confirms_on else None


DEPARTS_AND_RETURNS: list[Row] = [
    (0.3, Fact.SOCKET_LOST, OLD),
    (0.5, Fact.DIAL_REFUSED, None),
    (3.0, Fact.GETINFO_ANSWERED, NEW),
    (5.0, Fact.FORM_ANSWERED, NEW),
]

LANDINGS = [
    pytest.param(
        Case(
            after=[
                (0.1, Fact.GETINFO_ANSWERED, OLD),
                (0.2, Fact.FORM_ANSWERED, OLD),
                (0.3, Fact.SOCKET_LOST, OLD),
                (0.5, Fact.DIAL_REFUSED, None),
                (3.0, Fact.GETINFO_ANSWERED, NEW),
                (5.0, Fact.FORM_ANSWERED, NEW),
            ]
        ),
        id="old-instance-answers-for-a-moment",
    ),
    pytest.param(
        Case(
            in_flight=[
                (0.0, Fact.SOCKET_LOST, OLD),
                (0.3, Fact.DIAL_REFUSED, None),
                (2.0, Fact.GETINFO_ANSWERED, MID),
                (2.5, Fact.FORM_ANSWERED, MID),
            ],
            after=[
                (0.5, Fact.GETINFO_ANSWERED, MID),
                (1.0, Fact.FORM_ANSWERED, MID),
                (2.9, Fact.SOCKET_LOST, MID),
                (3.5, Fact.DIAL_REFUSED, None),
                (6.5, Fact.GETINFO_ANSWERED, NEW),
                (8.0, Fact.FORM_ANSWERED, NEW),
            ],
        ),
        id="foreign-restart-while-the-request-is-in-flight",
    ),
    pytest.param(
        Case(
            after=[
                (0.3, Fact.DIAL_REFUSED, None),
                (9.3, Fact.GETINFO_ANSWERED, NEW),
                (11.0, Fact.FORM_ANSWERED, NEW),
            ]
        ),
        id="old-instance-never-answers",
    ),
    pytest.param(
        Case(
            after=[
                (0.3, Fact.DIAL_REFUSED, None),
                (20.0, Fact.GETINFO_ANSWERED, NEW),
                (22.0, Fact.FORM_ANSWERED, NEW),
            ],
            deadline=2 * WINDOW,
        ),
        id="back-past-the-window-inside-the-callers-deadline",
    ),
]


@pytest.mark.parametrize("case", LANDINGS)
async def test_a_wait_for_a_restart_releases_on_the_instance_it_brought_up(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any], clock: VirtualClock, case: Case
) -> None:
    mgr = http_manager_factory(http_daemon, alarm_threshold=WINDOW)
    assert (await conclude(mgr, clock, case)).landed_on == NEW


async def test_a_wait_whose_window_runs_inside_the_outage_concludes_there_rather_than_on_either_instance(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any], clock: VirtualClock
) -> None:
    mgr = http_manager_factory(http_daemon, alarm_threshold=WINDOW)
    case = Case(
        after=[
            (0.1, Fact.GETINFO_ANSWERED, OLD),
            (0.2, Fact.FORM_ANSWERED, OLD),
            (0.3, Fact.SOCKET_LOST, OLD),
            (0.5, Fact.DIAL_REFUSED, None),
            (20.0, Fact.GETINFO_ANSWERED, NEW),
            (22.0, Fact.FORM_ANSWERED, NEW),
        ]
    )
    assert (await conclude(mgr, clock, case)).answering == NOBODY


async def test_a_departure_after_a_request_the_daemon_refused_does_not_read_as_after_one_it_accepted(
    http_manager_factory: ManagerFactory,
    http_daemon: dict[str, Any],
    restore_refusing_http_daemon: dict[str, Any],
    clock: VirtualClock,
) -> None:
    refused = await reading_after_departure(
        http_manager_factory(restore_refusing_http_daemon, alarm_threshold=WINDOW), clock
    )
    accepted = await reading_after_departure(http_manager_factory(http_daemon, alarm_threshold=WINDOW), clock)
    assert refused is not accepted


async def test_a_readback_that_confirms_on_the_instance_that_reloaded_in_place_settles_the_request_in_place(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any], clock: VirtualClock
) -> None:
    mgr = http_manager_factory(http_daemon, alarm_threshold=WINDOW)
    wire = Wire()
    stand_on_old(mgr, clock)
    await settle.restart(mgr, restore_own_backup(mgr, clock, wire, []))
    await feed(mgr, clock, wire, [(0.1, Fact.GETINFO_ANSWERED, OLD), (0.2, Fact.FORM_ANSWERED, OLD)])
    await settle.poll_until(mgr, Readback(confirms_on=3), interval=1.0)
    assert mgr.phase.outcome() is Outcome.SETTLED_IN_PLACE


async def test_a_readback_that_never_confirms_is_read_once_per_interval_through_the_window_and_once_at_its_end(
    http_manager_factory: ManagerFactory, http_daemon: dict[str, Any]
) -> None:
    mgr = http_manager_factory(http_daemon, alarm_threshold=WINDOW)
    readback = Readback(confirms_on=40)
    await settle.poll_until(mgr, readback, interval=1.0)
    assert readback.passes == 16
