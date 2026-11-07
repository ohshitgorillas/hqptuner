"""The idle probe charges no thread's CPU-wait as idle, the test's own or a fake daemon's.

A test's CPU-wait is summed over every thread of the process, read from a
directory laid out like ``/proc/self/task``: one subdirectory per thread id,
each holding that thread's ``schedstat``, whose second field is the
nanoseconds the thread has sat ready to run but waiting for a CPU.
``idle_probe.WaitClock(tasks)`` reads such a directory and ``.seconds()`` is
the CPU-wait it has seen so far; ``idle_probe.idle(start, end)`` charges a test
the wall time between two readings, less its CPU time, less that CPU-wait.

A fake daemon thread is started by a fixture and joined at teardown, so it is
born after the test's first reading and its directory is gone by the last one.
Its wait is seen only by a reading taken while it lives, here the one between
the call and teardown, and it still belongs to the test.

These cases write each ``schedstat`` under ``tmp_path`` and take wall and CPU
time from a table, so nothing reads a real clock. Every reading is a sum of
powers of two, so each expected idle is exact in floating point.
"""

import threading
from pathlib import Path

import idle_probe
import pytest

#: Wall time and CPU time at the start and at the end of every case: half a
#: second passed, of which the test ran an eighth of a second on a CPU.
START_WALL = 8.0
START_CPU = 2.0
END_WALL = 8.5
END_CPU = 2.125

#: Nanoseconds the thread running the test had waited for a CPU before the test
#: began, and by its end: a sixteenth of a second of it during the test.
TEST_THREAD_WAIT_BEFORE_NS = 1_000_000_000
TEST_THREAD_WAIT_AFTER_NS = 1_062_500_000

#: The nanoseconds a schedstat reports in its first field, time spent on a CPU.
#: Not CPU-wait; the same in every reading.
ON_CPU_NS = 4_000_000_000

#: Time slices a schedstat reports in its third field.
SLICES = 64

#: Nanoseconds the fake daemon thread sat in the run queue during each case.
DAEMON_WAITED_A_QUARTER_NS = 250_000_000
DAEMON_WAITED_AN_EIGHTH_NS = 125_000_000


def write_schedstat(tasks: Path, tid: int, wait_ns: int) -> None:
    """Lay out thread ``tid`` under ``tasks`` as having waited ``wait_ns`` for a CPU."""
    thread_dir = tasks / str(tid)
    thread_dir.mkdir(exist_ok=True)
    (thread_dir / "schedstat").write_text(f"{ON_CPU_NS} {wait_ns} {SLICES}\n", encoding="utf-8")


def end_thread(tasks: Path, tid: int) -> None:
    """Remove thread ``tid`` from ``tasks``, as the kernel does once a joined thread has exited."""
    thread_dir = tasks / str(tid)
    (thread_dir / "schedstat").unlink()
    thread_dir.rmdir()


@pytest.mark.parametrize(
    ("daemon_wait_ns", "expected"),
    [(DAEMON_WAITED_A_QUARTER_NS, 0.0625), (DAEMON_WAITED_AN_EIGHTH_NS, 0.1875)],
    ids=["daemon waited a quarter second", "daemon waited an eighth of a second"],
)
def test_a_test_is_not_charged_as_idle_the_time_its_fake_daemon_thread_sat_in_the_run_queue(
    tmp_path: Path, *, daemon_wait_ns: int, expected: float
) -> None:
    test_thread = threading.get_native_id()
    daemon_thread = test_thread + 1
    write_schedstat(tmp_path, test_thread, TEST_THREAD_WAIT_BEFORE_NS)
    clock = idle_probe.WaitClock(tmp_path)
    start = idle_probe.Reading(wall=START_WALL, cpu=START_CPU, cpu_wait=clock.seconds())

    # Setup starts the daemon thread and the call runs while it waits for a CPU;
    # the probe samples once between the call and teardown, while it still lives.
    write_schedstat(tmp_path, daemon_thread, daemon_wait_ns)
    clock.seconds()

    # Teardown joins the daemon thread, so the last reading cannot see it.
    end_thread(tmp_path, daemon_thread)
    write_schedstat(tmp_path, test_thread, TEST_THREAD_WAIT_AFTER_NS)
    end = idle_probe.Reading(wall=END_WALL, cpu=END_CPU, cpu_wait=clock.seconds())

    assert idle_probe.idle(start, end) == expected
