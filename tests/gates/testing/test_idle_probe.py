"""What the idle probe charges a test as idle.

``scripts/idle_probe.py`` is a pytest plugin loaded with ``-p idle_probe``. It
reads three clocks at the start and at the end of each test: wall time, the CPU
time of the process plus its reaped children (``cpu_seconds``), and the time
every thread of the process has sat ready to run but waiting for a CPU (the
second field of each thread's schedstat, summed by ``WaitClock``).
``Reading(wall, cpu, cpu_wait)`` holds one such reading in seconds, and
``idle(start, end) -> float`` is the test's idle between two of them: the wall
time that passed, less the CPU time the test ran, less the time its threads
waited for a CPU. On a busy host that wait is the host's delay, not the test's,
so it is never charged as idle.

These cases hand in readings from a table, so nothing reads a real clock. Every
reading is a sum of powers of two, so each expected idle is exact in floating
point whichever order the differences are taken in.
"""

import idle_probe
import pytest

#: The reading at the start of the test. The thread had already waited a second
#: for a CPU before the test began; none of that wait belongs to this test.
START_WALL = 8.0
START_CPU = 2.0
START_CPU_WAIT = 1.0

#: Wall time and CPU time at the end of every case: half a second passed, of
#: which the test ran an eighth of a second on a CPU.
END_WALL = 8.5
END_CPU = 2.125

#: CPU-wait at the end of each case, after a quarter and after an eighth of a
#: second of waiting for a CPU during the test.
WAITED_A_QUARTER = 1.25
WAITED_AN_EIGHTH = 1.125


@pytest.mark.parametrize(
    ("end_cpu_wait", "expected"),
    [(WAITED_A_QUARTER, 0.125), (WAITED_AN_EIGHTH, 0.25)],
    ids=["waited a quarter second", "waited an eighth of a second"],
)
def test_a_test_is_not_charged_as_idle_the_time_it_waited_for_a_cpu(*, end_cpu_wait: float, expected: float) -> None:
    start = idle_probe.Reading(wall=START_WALL, cpu=START_CPU, cpu_wait=START_CPU_WAIT)
    end = idle_probe.Reading(wall=END_WALL, cpu=END_CPU, cpu_wait=end_cpu_wait)
    assert idle_probe.idle(start, end) == expected
