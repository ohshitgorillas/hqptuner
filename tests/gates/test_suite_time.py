"""The gate that refuses a test suite slower than its bar.

``scripts/gates/testing/check_suite_time.py`` reads the junit XML report pytest wrote
(``--junitxml``) and a JSON baseline file holding the bar, a wall
time in seconds, and answers with an exit code. A green run within
``ESCALATE`` seconds of the baseline passes, and becomes the new baseline only
when it is faster, so a passing run never raises it; one further over needs
the owner's ``accept``, and an accepted run becomes the new baseline; one at or
past ``REJECT`` over is refused with or without it. A red report is not judged and not recorded, and a
missing baseline is seeded from the first green report.

The run's time is its wall time less ``wait``, the seconds the suite's main
thread sat ready to run but waiting for a CPU, so a busy host does not move the
bar. That time is what is judged and what is recorded, on every path that
records: a faster run, an accepted run and the first green run.

These cases hand-build the report XML and the baseline JSON under ``tmp_path``
and call the script's checking function with those paths, the pattern of
``test_coverage_floor.py``. Observable contract is the int exit code, over one
call or a sequence of calls sharing a baseline path. Nothing here runs pytest,
and nothing here reads the gate's internals or the baseline file it writes.

A branch with no baseline of its own is judged against ``parent``, the
baseline of the recorded branch nearest it in history. A refused run leaves it
with none; once a run passes, the branch has its own, and the bar it passed
against is still not raised by it.

The seams are ``check(report, baseline, *, accept=False, wait=0.0, parent=None)
-> int``; ``nearest(divergences) -> str | None``, which picks that branch from
each candidate's pair of commit counts as ``git rev-list --left-right --count
HEAD...<branch>`` gives them; ``recorded_bars(main) -> dict[str, Path]``, the
bar files beside the main checkout by branch, a ``/`` in a branch name written
``--`` in the file name; and ``prune(bars, live) -> list[str]``, which deletes
the bar of every branch not alive and names those branches, sorted.
"""

import importlib.util
import json
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "testing" / "check_suite_time.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_suite_time_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
CHECK = GATE.check

#: The wall time of the last green run every baseline-carrying case starts from.
BASELINE_SECONDS = 50.0

#: 3.0 s over ``BASELINE_SECONDS``: inside the escalate band, so it passes
#: against that bar and would raise it if a passing run were recorded as it ran.
WITHIN_SECONDS = 53.0

#: 7.5 s over ``BASELINE_SECONDS``: past the escalate band, short of the reject
#: band, so it fails without accept against that bar.
ESCALATED_SECONDS = 57.5

#: Where a branch with no bar of its own would keep one, beside its parent's.
OWN_BASELINE_NAME = "own-suite-time.json"


def write_report(tmp_path: Path, seconds: float, *, failures: int = 0, errors: int = 0) -> Path:
    """Write a junit report shaped the way pytest's ``--junitxml`` writes one.

    ``time`` on the ``testsuite`` element is the session's elapsed wall time,
    three decimals; ``failures`` and ``errors`` are the counts a red run carries.
    """
    body = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<testsuites name="pytest tests">'
        f'<testsuite name="pytest" errors="{errors}" failures="{failures}" skipped="0" tests="3" '
        f'time="{seconds:.3f}" timestamp="2026-09-06T12:00:00.000000+00:00" hostname="probe">'
        '<testcase classname="tests.test_probe" name="test_one" time="0.001" />'
        "</testsuite></testsuites>"
    )
    path = tmp_path / "junit.xml"
    path.write_text(body, encoding="utf-8")
    return path


def write_baseline(tmp_path: Path, seconds: float) -> Path:
    """Write the baseline file: JSON ``{"seconds": <float>}``."""
    path = tmp_path / "suite-time.json"
    path.write_text(json.dumps({"seconds": seconds}), encoding="utf-8")
    return path


# --- 1. one green run against a 50.0 s baseline, over the escalate and reject bands


@pytest.mark.parametrize(
    ("seconds", "accept", "expected"),
    [
        (53.0, False, 0),
        (55.0, False, 0),
        (57.5, False, 1),
        (57.5, True, 0),
        (59.9, True, 0),
        (60.0, True, 1),
        (61.0, False, 1),
    ],
)
def test_a_green_run_is_judged_by_seconds_over_the_baseline_with_accept_clearing_only_the_escalate_band(
    tmp_path: Path, *, seconds: float, accept: bool, expected: int
) -> None:
    report = write_report(tmp_path, seconds)
    baseline = write_baseline(tmp_path, BASELINE_SECONDS)
    assert CHECK(report, baseline, accept=accept) == expected


# --- 2. a refused run does not move the baseline --------------------------------


def test_a_refused_run_is_not_recorded_so_the_next_run_is_still_judged_against_the_old_baseline(
    tmp_path: Path,
) -> None:
    baseline = write_baseline(tmp_path, BASELINE_SECONDS)
    CHECK(write_report(tmp_path, 57.5), baseline)
    second = CHECK(write_report(tmp_path, 62.0), baseline)
    assert second == 1


# --- 3. a red run is neither judged nor recorded --------------------------------


def test_a_red_run_fails_without_being_judged_even_when_faster_than_the_baseline(
    tmp_path: Path,
) -> None:
    baseline = write_baseline(tmp_path, BASELINE_SECONDS)
    red = CHECK(write_report(tmp_path, 20.0, failures=1), baseline)
    assert red == 1


# --- 4. a branch with no bar of its own is judged against its parent's bar -------


def test_a_run_refused_against_the_parent_bar_leaves_the_branch_without_a_bar_so_the_next_run_meets_it_again(
    tmp_path: Path,
) -> None:
    parent = write_baseline(tmp_path, BASELINE_SECONDS)
    own = tmp_path / OWN_BASELINE_NAME
    CHECK(write_report(tmp_path, ESCALATED_SECONDS), own, parent=parent)
    assert CHECK(write_report(tmp_path, ESCALATED_SECONDS), own, parent=parent) == 1


def test_a_run_passed_against_the_parent_bar_leaves_the_branch_that_bar_rather_than_its_own_slower_time(
    tmp_path: Path,
) -> None:
    parent = write_baseline(tmp_path, BASELINE_SECONDS)
    own = tmp_path / OWN_BASELINE_NAME
    CHECK(write_report(tmp_path, WITHIN_SECONDS), own, parent=parent)
    assert CHECK(write_report(tmp_path, ESCALATED_SECONDS), own, parent=parent) == 1


# --- 5. the nearest recorded branch, as git counts commits ------------------------


@pytest.mark.parametrize(
    ("divergences", "expected"),
    [
        ({"release": (1, 9), "trunk": (2, 0)}, "release"),
        ({"release": (3, 0), "trunk": (2, 9)}, "trunk"),
    ],
)
def test_the_nearest_branch_is_the_one_with_fewest_commits_on_head_not_on_it(
    *, divergences: dict[str, tuple[int, int]], expected: str
) -> None:
    assert GATE.nearest(divergences) == expected


@pytest.mark.parametrize(
    ("divergences", "expected"),
    [
        ({"release": (2, 4), "trunk": (2, 1)}, "trunk"),
        ({"release": (2, 0), "trunk": (2, 3)}, "release"),
    ],
)
def test_between_branches_tied_on_commits_on_head_the_nearest_has_fewest_commits_not_on_head(
    *, divergences: dict[str, tuple[int, int]], expected: str
) -> None:
    assert GATE.nearest(divergences) == expected


# --- 6. the bars recorded beside the main checkout, and pruning the dead ones -----


@pytest.mark.parametrize(
    ("branch", "file_name"),
    [("dev", ".suite-time.dev.json"), ("stream/hw-gate", ".suite-time.stream--hw-gate.json")],
)
def test_a_bar_file_beside_the_main_checkout_is_recorded_under_the_branch_it_names(
    tmp_path: Path, *, branch: str, file_name: str
) -> None:
    (tmp_path / file_name).write_text(json.dumps({"seconds": BASELINE_SECONDS}), encoding="utf-8")
    assert GATE.recorded_bars(tmp_path).get(branch) == tmp_path / file_name


def test_pruning_names_the_branches_not_alive_whose_bars_it_deleted_in_sorted_order(tmp_path: Path) -> None:
    bars = {branch: tmp_path / f".suite-time.{branch}.json" for branch in ("zeta", "alive", "alpha")}
    for path in bars.values():
        path.write_text(json.dumps({"seconds": BASELINE_SECONDS}), encoding="utf-8")
    assert GATE.prune(bars, {"alive"}) == ["alpha", "zeta"]
