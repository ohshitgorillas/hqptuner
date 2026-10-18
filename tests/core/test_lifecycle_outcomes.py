"""A restart's outcome, the waits on it and the alarm, read off the one phase.

``docs/spec/lifecycle.md`` "The one phase" and rules 4, 5 and 11: how a restart
ended falls out of the phase, the generation and the request stamp; a wait
subscribes to the transition it names and hands its deadline back as a result.
Each case feeds wire facts from a table at the clock readings the table gives,
and every wait runs on a ``VirtualClock``.
"""

import asyncio
import contextlib
from collections.abc import Iterable
from dataclasses import dataclass, field

import pytest
from virtual_clock import VirtualClock

from hqptuner.core.lifecycle import Fact, Lifecycle, Outcome, Phase, Standing, outcome, transition

#: The window every case runs under unless it is about the window itself.
WINDOW = 15.0

#: The instance that put a fact on the wire: the one the restart kills, and the
#: one that replaces it. A fact HQPTuner observes alone, its own close or a
#: refused dial, comes from neither.
OLD = "old"
NEW = "new"

#: A wire fact at a clock reading, beside the instance that answered it.
Row = tuple[float, Fact, str | None]

#: Own restarts that come back inside the window, as the wire delivers them
#: after the request was accepted.
RESTARTS = [
    pytest.param(
        [
            (0.0, Fact.SOCKET_TAKEN, None),
            (0.1, Fact.GETINFO_ANSWERED, OLD),
            (0.2, Fact.FORM_ANSWERED, OLD),
            (0.3, Fact.SOCKET_LOST, OLD),
            (0.5, Fact.DIAL_REFUSED, None),
            (3.0, Fact.GETINFO_ANSWERED, NEW),
            (5.0, Fact.FORM_ANSWERED, NEW),
        ],
        id="old-instance-answers-for-a-moment",
    ),
    pytest.param(
        [
            (2.9, Fact.SOCKET_LOST, OLD),
            (3.5, Fact.DIAL_REFUSED, None),
            (6.5, Fact.GETINFO_ANSWERED, NEW),
            (8.0, Fact.FORM_ANSWERED, NEW),
        ],
        id="drops-on-its-own",
    ),
    pytest.param(
        [
            (0.0, Fact.SOCKET_TAKEN, None),
            (0.3, Fact.DIAL_REFUSED, None),
            (5.0, Fact.DIAL_REFUSED, None),
            (9.3, Fact.GETINFO_ANSWERED, NEW),
            (11.0, Fact.FORM_ANSWERED, NEW),
        ],
        id="refused-until-back",
    ),
]

#: An own restart whose new instance answers only at 20 s.
LATE_RESTART: list[Row] = [
    (0.0, Fact.SOCKET_TAKEN, None),
    (0.3, Fact.DIAL_REFUSED, None),
    (20.0, Fact.GETINFO_ANSWERED, NEW),
    (20.5, Fact.FORM_ANSWERED, NEW),
]

#: How many times a caller waits on a restart before giving up on it.
ATTEMPTS = 6


@dataclass
class Daemon:
    """The wire facts played so far, each beside the instance that answered it."""

    heard: list[tuple[Fact, str | None]] = field(default_factory=list)


async def _play(lifecycle: Lifecycle, clock: VirtualClock, rows: Iterable[Row], daemon: Daemon) -> None:
    """Report each row's fact to ``lifecycle`` at the row's clock reading."""
    for at, fact, instance in rows:
        await clock.sleep(at - clock.monotonic())
        lifecycle.report(fact, clock.monotonic())
        daemon.heard.append((fact, instance))


def _standing_on_the_old_instance(window: float) -> Lifecycle:
    """A lifecycle whose control socket and configuration lane both answered at reading zero."""
    lifecycle = Lifecycle(window=window)
    lifecycle.report(Fact.GETINFO_ANSWERED, 0.0)
    lifecycle.report(Fact.FORM_ANSWERED, 0.0)
    return lifecycle


async def _heard_when_the_wait_released(rows: list[Row]) -> list[tuple[Fact, str | None]]:
    """Accept a restart, play ``rows``, and return what the wire had said when the wait for it returned."""
    clock = VirtualClock()
    lifecycle = _standing_on_the_old_instance(WINDOW)
    mark = lifecycle.request_accepted(clock.monotonic())
    daemon = Daemon()
    player = clock.spawn(_play(lifecycle, clock, rows, daemon))
    try:
        await lifecycle.until_ready(after=mark, clock=clock)
        return list(daemon.heard)
    finally:
        player.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await player


async def _waits_until_landed(rows: list[Row], *, deadline: float | None, window: float) -> int | None:
    """Accept a restart, play ``rows``, and wait on it again each time a wait gives up.

    Returns the number of the wait that saw it land, or ``None`` when none did.
    """
    clock = VirtualClock()
    lifecycle = _standing_on_the_old_instance(window)
    mark = lifecycle.request_accepted(clock.monotonic())
    player = clock.spawn(_play(lifecycle, clock, rows, Daemon()))
    try:
        for attempt in range(1, ATTEMPTS + 1):
            if await lifecycle.until_ready(after=mark, clock=clock, deadline=deadline):
                return attempt
        return None
    finally:
        player.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await player


def _answering(heard: list[tuple[Fact, str | None]]) -> str | None:
    """The instance whose ``GetInfo`` answered last."""
    answered = [instance for fact, instance in heard if fact is Fact.GETINFO_ANSWERED]
    return answered[-1] if answered else None


@pytest.mark.parametrize("rows", RESTARTS)
async def test_a_wait_for_a_restart_never_releases_on_the_instance_the_restart_kills(rows: list[Row]) -> None:
    heard = await _heard_when_the_wait_released(rows)
    assert _answering(heard) == NEW


@pytest.mark.parametrize("rows", RESTARTS)
async def test_a_wait_for_a_restart_never_releases_before_the_configuration_lane_answers_the_new_instance(
    rows: list[Row],
) -> None:
    heard = await _heard_when_the_wait_released(rows)
    assert (Fact.FORM_ANSWERED, NEW) in heard


async def test_a_deadline_passed_is_returned_so_the_caller_can_wait_again() -> None:
    attempt = await _waits_until_landed(LATE_RESTART, deadline=8.0, window=30.0)
    assert attempt == 3


async def test_a_wait_with_no_deadline_of_its_own_gives_up_at_the_window() -> None:
    attempt = await _waits_until_landed(LATE_RESTART, deadline=None, window=8.0)
    assert attempt == 3


async def test_a_request_stamped_wakes_whoever_waits_on_the_transitions() -> None:
    clock = VirtualClock()
    lifecycle = Lifecycle(window=WINDOW)

    async def stamp_later() -> None:
        await clock.sleep(5.0)
        lifecycle.request_accepted(clock.monotonic())

    clock.spawn(stamp_later())
    woke = await clock.wait(lifecycle.changed, 60.0)
    assert woke is True


#: A standing the daemon held before any row: Ready, after some departures.
STANDING = Standing(phase=Phase.READY, generation=3)


def _after(rows: Iterable[tuple[float, Fact]]) -> Standing:
    """The standing once every row's fact has been fed at its clock reading."""
    standing = STANDING
    for at, fact in rows:
        standing = transition(standing, fact, at, window=WINDOW)
    return standing


#: Departures HQPTuner did not ask for, as the wire delivers them.
FOREIGN = [
    pytest.param(
        [(156.0, Fact.SOCKET_LOST), (156.5, Fact.GETINFO_ANSWERED), (157.0, Fact.FORM_ANSWERED)],
        id="idle-close",
    ),
    pytest.param(
        [
            (0.0, Fact.SOCKET_LOST),
            (0.5, Fact.DIAL_REFUSED),
            (5.0, Fact.DIAL_REFUSED),
            (9.3, Fact.GETINFO_ANSWERED),
            (10.0, Fact.FORM_ANSWERED),
        ],
        id="systemctl-restart",
    ),
    pytest.param(
        [(0.0, Fact.REQUEST_ACCEPTED), (1.0, Fact.READBACK_CONFIRMED), (40.0, Fact.SOCKET_LOST)],
        id="after-an-own-restart-settled-by-readback",
    ),
    pytest.param(
        [(0.0, Fact.REQUEST_ACCEPTED), (15.0, Fact.WINDOW_RAN), (30.0, Fact.SOCKET_LOST)],
        id="after-an-own-restart-settled-by-deadline",
    ),
]


@pytest.mark.parametrize("rows", FOREIGN)
def test_a_foreign_departure_is_never_read_as_own(rows: list[tuple[float, Fact]]) -> None:
    assert outcome(_after(rows)) is Outcome.FOREIGN_DEPARTURE


#: Own restarts, as the wire delivers them, beside how each ended.
OWN = [
    pytest.param(
        [
            (0.0, Fact.REQUEST_ACCEPTED),
            (0.0, Fact.SOCKET_TAKEN),
            (0.1, Fact.GETINFO_ANSWERED),
            (0.2, Fact.FORM_ANSWERED),
            (0.3, Fact.SOCKET_LOST),
            (0.5, Fact.DIAL_REFUSED),
            (3.0, Fact.GETINFO_ANSWERED),
            (5.0, Fact.FORM_ANSWERED),
        ],
        Outcome.LANDED,
        id="landed-after-the-old-instance-answered",
    ),
    pytest.param(
        [
            (0.0, Fact.REQUEST_ACCEPTED),
            (2.9, Fact.SOCKET_LOST),
            (3.5, Fact.DIAL_REFUSED),
            (6.5, Fact.GETINFO_ANSWERED),
            (8.0, Fact.FORM_ANSWERED),
        ],
        Outcome.LANDED,
        id="landed-after-dropping-on-its-own",
    ),
    pytest.param(
        [(0.0, Fact.REQUEST_ACCEPTED), (1.0, Fact.READBACK_CONFIRMED)],
        Outcome.SETTLED_IN_PLACE,
        id="readback-on-the-standing-connection",
    ),
    pytest.param(
        [
            (0.0, Fact.REQUEST_ACCEPTED),
            (0.0, Fact.SOCKET_TAKEN),
            (0.1, Fact.GETINFO_ANSWERED),
            (0.2, Fact.FORM_ANSWERED),
            (1.0, Fact.READBACK_CONFIRMED),
        ],
        Outcome.SETTLED_IN_PLACE,
        id="readback-after-reconnecting-before-any-refusal",
    ),
    pytest.param(
        [(0.0, Fact.REQUEST_ACCEPTED), (5.0, Fact.WINDOW_RAN), (6.0, Fact.READBACK_CONFIRMED)],
        Outcome.SETTLED_IN_PLACE,
        id="readback-after-a-window-check-that-came-early",
    ),
    pytest.param(
        [(0.0, Fact.REQUEST_ACCEPTED), (15.0, Fact.WINDOW_RAN)],
        Outcome.SETTLED_BY_DEADLINE,
        id="window-run-with-the-generation-unmoved",
    ),
    pytest.param(
        [
            (0.0, Fact.REQUEST_ACCEPTED),
            (0.0, Fact.SOCKET_TAKEN),
            (0.1, Fact.GETINFO_ANSWERED),
            (0.2, Fact.FORM_ANSWERED),
        ],
        Outcome.NONE,
        id="ready-again-on-the-old-instance",
    ),
    pytest.param(
        [(0.0, Fact.REQUEST_ACCEPTED), (1.0, Fact.SOCKET_LOST), (15.0, Fact.WINDOW_RAN)],
        Outcome.NONE,
        id="departed-and-not-back-when-the-window-ran",
    ),
    pytest.param(
        [
            (0.0, Fact.REQUEST_ACCEPTED),
            (1.0, Fact.SOCKET_LOST),
            (1.5, Fact.DIAL_REFUSED),
            (4.0, Fact.GETINFO_ANSWERED),
            (4.5, Fact.READBACK_CONFIRMED),
        ],
        Outcome.NONE,
        id="readback-after-the-generation-moved",
    ),
]


@pytest.mark.parametrize(("rows", "ended"), OWN)
def test_an_own_restart_reads_as_the_outcome_its_wire_facts_prove(
    rows: list[tuple[float, Fact]], ended: Outcome
) -> None:
    assert outcome(_after(rows)) is ended


@pytest.mark.parametrize("entered", [0.0, 100.0])
def test_down_turns_alarm_only_once_the_window_has_run_since_down_was_entered(entered: float) -> None:
    down = transition(STANDING, Fact.SOCKET_LOST, entered, window=WINDOW)
    early = transition(down, Fact.WINDOW_RAN, entered + WINDOW / 2, window=WINDOW)
    late = transition(down, Fact.WINDOW_RAN, entered + WINDOW, window=WINDOW)
    assert [early.phase, late.phase] == [Phase.DOWN, Phase.ALARM]
