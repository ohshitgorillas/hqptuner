"""What a new control connection lists as dropped, held against LIVE's record of confirmed writes.

After hqplayerd restarts on its own the engine is back on its config file. A recorded
write the new connection finds the engine no longer holds is listed, as the config-form
field, the value written and the engine's own name for it; one it still holds is not
listed and stays recorded, so a later restart can still list it. The list stands until
the user clears it: a connection that drops nothing leaves it as it is, a later restart
adds what it dropped, and a setting dropped again is listed once, at the newer value.

A connection that follows a restart or reload HQPTuner asked for itself lists nothing and
leaves the list standing; a request the daemon never accepted is not one. With a control
connection standing at the request, the connection after it is the first made once the
daemon has gone away; with none standing, it is the first made after the request.

Connections are counted the way the manager counts them: ``connects`` before the new one,
and ``drops`` seen by then.
"""

import contextlib
from collections.abc import Awaitable, Callable
from typing import NamedTuple

import pytest
from live_record import (
    ADAPTIVE_ON,
    DITHER_NS9,
    JUNK_20K,
    JUNK_30K,
    WRITES,
    Write,
    by_field,
    confirmed,
    engine,
    remembering,
)
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.manager import ConnectionManager
from hqptuner.lanes import settle
from hqptuner.lanes.live import dropped, reconnect
from hqptuner.lanes.live.memory import LiveMemory
from hqptuner.lanes.settle import Mark

#: The connection history at the last connect: four connections made, one drop seen.
STOOD = Mark(connects=4, drops=1)

#: The history once the daemon has gone away since ``STOOD`` and the next connection is being made.
AFTER_A_DROP = Mark(connects=STOOD.connects, drops=STOOD.drops + 1)

#: The monotonic instant the daemon accepted HQPTuner's own request.
ASKED_AT = 100.0

#: An entry an earlier restart dropped, standing on the list.
LISTED = DITHER_NS9.entry

Report = tuple[dropped.WrittenSetting, ...]


def _connect(live: LiveMemory, view: dropped.EngineView, history: Mark, report: Report) -> Report:
    """Connect to ``view`` at ``history``, apply the verdict to ``live``, and return the list it leaves."""
    verdict = reconnect.on_connect(live, view, history.connects, history.drops, report)
    if verdict.own_restart:
        live.restarted()
    else:
        live.reconnected(verdict.kept)
    return verdict.report


# --- a restart hqplayerd made on its own --------------------------------------


class Reconnect(NamedTuple):
    """What the engine still holds of a write at the new connection, and whether that write is listed."""

    holds: bool
    listed: bool


#: A restart onto the config file loses every write; a network blip or the daemon's idle close loses none.
RECONNECTS = {"restart": Reconnect(holds=False, listed=True), "blip": Reconnect(holds=True, listed=False)}


@pytest.mark.parametrize("reconnected", RECONNECTS.values(), ids=RECONNECTS.keys())
@pytest.mark.parametrize("write", WRITES, ids=[write.entry.field for write in WRITES])
def test_a_confirmed_write_is_listed_with_the_value_written_and_the_engines_name_only_when_the_engine_lost_it(
    write: Write, reconnected: Reconnect
) -> None:
    live = remembering(write)
    view = engine(write) if reconnected.holds else engine()
    expected = (write.entry,) if reconnected.listed else ()
    assert _connect(live, view, AFTER_A_DROP, ()) == expected


def test_a_write_the_engine_still_held_at_a_reconnect_is_listed_when_a_later_restart_drops_it() -> None:
    live = remembering(JUNK_20K)
    _connect(live, engine(JUNK_20K), AFTER_A_DROP, ())
    assert _connect(live, engine(), AFTER_A_DROP, ()) == (JUNK_20K.entry,)


# --- the list stands until the user clears it ---------------------------------


class Quiet(NamedTuple):
    """What is recorded at a connection, and the engine that connection finds."""

    recorded: tuple[Write, ...]
    view: dropped.EngineView


#: Connections that drop nothing: a blip with a write still held, and a restart with nothing written since the last.
QUIET = {
    "reconnect losing nothing": Quiet((JUNK_20K,), engine(JUNK_20K)),
    "restart losing nothing more": Quiet((), engine()),
}


@pytest.mark.parametrize("quiet", QUIET.values(), ids=QUIET.keys())
def test_a_listed_setting_stays_listed_through_a_connection_that_drops_nothing(quiet: Quiet) -> None:
    live = remembering(*quiet.recorded)
    assert _connect(live, quiet.view, AFTER_A_DROP, (LISTED,)) == (LISTED,)


def test_a_later_restart_that_drops_another_setting_adds_it_to_the_list() -> None:
    live = remembering(ADAPTIVE_ON)
    report = _connect(live, engine(), AFTER_A_DROP, (LISTED,))
    assert by_field(report) == {LISTED.field: LISTED, ADAPTIVE_ON.entry.field: ADAPTIVE_ON.entry}


def test_a_setting_dropped_again_is_listed_once_at_the_newer_value() -> None:
    live = remembering(JUNK_30K)
    assert _connect(live, engine(), AFTER_A_DROP, (JUNK_20K.entry,)) == (JUNK_30K.entry,)


# --- restarts and reloads HQPTuner asked for itself ---------------------------


def _asked(live: LiveMemory, mark: Mark | None) -> None:
    """HQPTuner's own restart request, accepted with ``mark`` taken before it."""
    live.restart_sent(mark, ASKED_AT)


def _restart_by_itself(live: LiveMemory) -> Report:
    """hqplayerd restarts on its own; the list the connection after it leaves."""
    return _connect(live, engine(), AFTER_A_DROP, (LISTED,))


def _own_restart(live: LiveMemory) -> Report:
    """HQPTuner's own restart, with a connection standing at the request."""
    _asked(live, STOOD)
    return _connect(live, engine(), AFTER_A_DROP, (LISTED,))


def _own_restart_with_no_connection(live: LiveMemory) -> Report:
    """HQPTuner's own restart, asked for with the control connection already down."""
    _asked(live, None)
    return _connect(live, engine(), STOOD, (LISTED,))


def _write_while_restarting(live: LiveMemory) -> Report:
    """HQPTuner's own restart, with a further write confirmed after the request and before it lands."""
    _asked(live, STOOD)
    confirmed(live, ADAPTIVE_ON, before=engine(JUNK_20K))
    return _connect(live, engine(), AFTER_A_DROP, (LISTED,))


def _answered_before_restarting(live: LiveMemory) -> Report:
    """HQPTuner's own restart, where the daemon answers a connection made before it goes away, a
    write is confirmed on that connection, and the restart then lands."""
    _asked(live, STOOD)
    report = _connect(live, engine(JUNK_20K), STOOD, (LISTED,))
    confirmed(live, ADAPTIVE_ON, before=engine(JUNK_20K))
    later = Mark(connects=STOOD.connects + 1, drops=STOOD.drops + 1)
    return _connect(live, engine(), later, report)


def _answered_with_no_connection(live: LiveMemory) -> Report:
    """HQPTuner's own restart asked for with the control connection down, the daemon answering the
    connection made after the request before it restarts."""
    _asked(live, None)
    report = _connect(live, engine(JUNK_20K), STOOD, (LISTED,))
    later = Mark(connects=STOOD.connects + 1, drops=STOOD.drops + 1)
    return _connect(live, engine(), later, report)


def _write_after_own_restart(live: LiveMemory) -> Report:
    """HQPTuner's own restart, a write confirmed on the connection after it, then hqplayerd restarting on its own."""
    report = _own_restart(live)
    confirmed(live, ADAPTIVE_ON)
    later = Mark(connects=AFTER_A_DROP.connects + 1, drops=AFTER_A_DROP.drops + 1)
    return _connect(live, engine(), later, report)


class Restart(NamedTuple):
    """How the engine came to restart, and the list once the app has reconnected to it."""

    happen: Callable[[LiveMemory], Report]
    listed: dict[str, dropped.WrittenSetting]


#: Each starts with ``JUNK_20K`` confirmed and ``LISTED`` on the list.
RESTARTS = {
    "hqplayerd on its own": Restart(_restart_by_itself, {LISTED.field: LISTED, JUNK_20K.entry.field: JUNK_20K.entry}),
    "own, connection standing": Restart(_own_restart, {LISTED.field: LISTED}),
    "own, no connection": Restart(_own_restart_with_no_connection, {LISTED.field: LISTED}),
    "own, write while restarting": Restart(_write_while_restarting, {LISTED.field: LISTED}),
    "own, connection answered before restarting": Restart(_answered_before_restarting, {LISTED.field: LISTED}),
    "own, no connection, answered before restarting": Restart(_answered_with_no_connection, {LISTED.field: LISTED}),
    "own, then a write, then on its own": Restart(
        _write_after_own_restart, {LISTED.field: LISTED, ADAPTIVE_ON.entry.field: ADAPTIVE_ON.entry}
    ),
}


@pytest.mark.parametrize("restart", RESTARTS.values(), ids=RESTARTS.keys())
def test_a_restart_lists_what_it_dropped_only_when_hqptuner_did_not_ask_for_it(restart: Restart) -> None:
    live = remembering(JUNK_20K)
    assert by_field(restart.happen(live)) == restart.listed


class RefusedError(Exception):
    """The daemon refused the request, or it never reached it."""


async def _accepted() -> None:
    """A request the daemon accepts."""


def _refused() -> Awaitable[None]:
    """A request that fails before the daemon accepts it: it raises as it is sent, before there is anything to await."""
    raise RefusedError


#: A request, and the list once hqplayerd has restarted after it.
REQUESTS = {
    "accepted": (_accepted, {LISTED.field: LISTED}),
    "refused": (_refused, {LISTED.field: LISTED, JUNK_20K.entry.field: JUNK_20K.entry}),
}


@pytest.mark.parametrize(("request_", "listed"), REQUESTS.values(), ids=REQUESTS.keys())
async def test_an_own_restart_request_counts_only_once_the_daemon_accepted_it(
    request_: Callable[[], Awaitable[None]], listed: dict[str, dropped.WrittenSetting]
) -> None:
    manager = ConnectionManager(Config(), clock=VirtualClock())
    live = manager.readings.live
    confirmed(live, JUNK_20K)
    with contextlib.suppress(RefusedError):
        await settle.own_restart(manager, request_, STOOD)
    assert by_field(_connect(live, engine(), AFTER_A_DROP, (LISTED,))) == listed
