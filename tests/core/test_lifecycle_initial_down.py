"""The Down an install starts in, before the daemon has ever been reachable.

The owner's ruling on a cold start: the phase is built Down, and that Down counts as entered
at the manager's clock reading when the phase is built. Down turns Alarm once
the window has run on the manager's clock since Down was entered, so a daemon
that refuses every dial from the start turns Alarm a window after the start, and
a refused dial from that Down leaves the instant it was entered where it was.
Each case builds a manager on a virtual clock moved to a stated start reading,
takes the phase it built, feeds wire facts at readings counted from the start,
and reads the standing that comes back.
"""

from pathlib import Path

import pytest
from virtual_clock import VirtualClock

from hqptuner.config import Config
from hqptuner.core.lifecycle import Fact, Phase, Standing, transition
from hqptuner.core.manager import ConnectionManager

#: The window every case runs under.
WINDOW = 15.0

#: Two manager's clock readings a manager may be built at, both later than the
#: clock's zero, so a Down counted from zero and one counted from the start
#: turn Alarm at different readings.
START_READINGS = [40.0, 1000.0]

#: How long after the start a window check comes early: half the window.
EARLY = WINDOW / 2

#: How long after the start a window check comes once the window has run.
LATE = WINDOW + WINDOW / 3

#: How long after the start the daemon refuses a dial: late enough that a Down
#: counted from the refusal has not run its window at ``LATE``.
REFUSED_AFTER = 2 * WINDOW / 3


async def _built_at(start: float, tmp_path: Path) -> Standing:
    """The standing of the phase a manager builds once its clock reads ``start``."""
    clock = VirtualClock()
    await clock.advance(start)
    cfg = Config(
        alarm_threshold=WINDOW,
        backup_dir=tmp_path / "backups",
        preset_dir=tmp_path / "presets",
    )
    manager = ConnectionManager(cfg, clock=clock)
    try:
        return manager.phase.standing
    finally:
        await manager.aclose()


@pytest.mark.parametrize("start", START_READINGS)
async def test_a_daemon_never_reachable_turns_alarm_only_once_the_window_has_run_since_the_start(
    start: float, tmp_path: Path
) -> None:
    built = await _built_at(start, tmp_path)
    early = transition(built, Fact.WINDOW_RAN, start + EARLY, window=WINDOW)
    late = transition(built, Fact.WINDOW_RAN, start + LATE, window=WINDOW)
    assert [early.phase, late.phase] == [Phase.DOWN, Phase.ALARM]


@pytest.mark.parametrize("start", START_READINGS)
async def test_a_refused_dial_from_the_initial_down_leaves_the_instant_down_was_entered(
    start: float, tmp_path: Path
) -> None:
    built = await _built_at(start, tmp_path)
    refused = transition(built, Fact.DIAL_REFUSED, start + REFUSED_AFTER, window=WINDOW)
    late = transition(refused, Fact.WINDOW_RAN, start + LATE, window=WINDOW)
    assert late.phase is Phase.ALARM
