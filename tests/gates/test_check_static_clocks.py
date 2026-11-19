"""The gate that refuses a bare timer or clock read in the frontend.

``scripts/gates/check_static_clocks.py`` reads the files it is handed and
refuses every bare ``setTimeout``, ``setInterval``, ``requestAnimationFrame``,
``performance.now`` or ``Date.now`` under ``hqptuner/static/``, except in
``lib/clock.js`` and ``vendor/``. A call through an injected clock is not bare.

The seam is ``main(argv) -> int``, which takes file paths the way
``git ls-files`` hands them over, prints one line per hit opening
``<path>:<line>:`` and naming what it found, and exits 1 on any hit and 0 on
none. Every fixture file is written here under ``tmp_path``.
"""

from pathlib import Path

import pytest
from gate_scripts import Gate, load_gate, reported_lines, write_lines

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_static_clocks.py"


GATE = load_gate(GATE_PATH, "check_static_clocks_under_test")
RIG = Gate(GATE)

#: The names the gate refuses when called bare, paired with a bare call of each.
BARE_CALLS = {
    "setTimeout": "setTimeout(tick, 16);",
    "setInterval": "setInterval(poll, 1000);",
    "requestAnimationFrame": "requestAnimationFrame(draw);",
    "performance.now": "const started = performance.now();",
    "Date.now": "const stamp = Date.now();",
}

#: Calls through an injected clock, which the gate lets through.
INJECTED_CALLS = ["clock.setTimeout(tick, 16);", "const started = PLATFORM.now();"]

#: A line with no clock in it, used to push a call off line 1.
PLAIN_LINE = "const width = 640;"

#: A file the gate judges, by where it sits.
APP_FILE = "hqptuner/static/store/meter.js"


def reported_paths(output: list[str], paths: list[Path]) -> list[Path]:
    """Which of ``paths`` the gate reports at least one hit for, in given order."""
    return [path for path in paths if reported_lines(output, path)]


def reported_names(output: list[str], path: Path) -> list[str]:
    """For each hit reported against ``path``, the refused names its line carries."""
    prefix = f"{path}:"
    hits = [line[len(prefix) :] for line in output if line.startswith(prefix)]
    return [name for hit in hits for name in BARE_CALLS if name in hit]


@pytest.mark.parametrize("name", list(BARE_CALLS))
def test_a_bare_call_under_static_fails_the_gate(tmp_path: Path, name: str) -> None:
    path = write_lines(tmp_path, APP_FILE, [BARE_CALLS[name]])
    assert RIG.run([path])[0] == 1


@pytest.mark.parametrize("name", list(BARE_CALLS))
def test_a_hit_names_the_refused_call(tmp_path: Path, name: str) -> None:
    path = write_lines(tmp_path, APP_FILE, [PLAIN_LINE, BARE_CALLS[name]])
    assert reported_names(RIG.run([path])[1], path) == [name]


def test_every_bare_call_is_reported_on_its_own_line(tmp_path: Path) -> None:
    lines = [PLAIN_LINE, BARE_CALLS["setTimeout"], PLAIN_LINE, PLAIN_LINE, BARE_CALLS["Date.now"]]
    path = write_lines(tmp_path, APP_FILE, lines)
    assert reported_lines(RIG.run([path])[1], path) == [2, 5]


@pytest.mark.parametrize("injected", INJECTED_CALLS)
def test_a_call_through_an_injected_clock_is_not_reported(tmp_path: Path, injected: str) -> None:
    path = write_lines(tmp_path, APP_FILE, [injected, PLAIN_LINE, BARE_CALLS["setInterval"]])
    assert reported_lines(RIG.run([path])[1], path) == [3]


def test_only_a_file_with_a_bare_call_fails_the_gate(tmp_path: Path) -> None:
    clean = write_lines(tmp_path, "hqptuner/static/store/clean.js", INJECTED_CALLS)
    dirty = write_lines(tmp_path, APP_FILE, [BARE_CALLS["requestAnimationFrame"]])
    assert (RIG.run([clean])[0], RIG.run([dirty])[0]) == (0, 1)


@pytest.mark.parametrize(
    "relative",
    ["hqptuner/static/lib/clock.js", "hqptuner/static/vendor/preact.mjs", "tests/js/store/meter.test.js"],
    ids=["clock-module", "vendor", "outside-static"],
)
def test_a_bare_call_outside_the_judged_files_is_not_reported(tmp_path: Path, relative: str) -> None:
    spared = write_lines(tmp_path, relative, [BARE_CALLS["setTimeout"]])
    judged = write_lines(tmp_path, APP_FILE, [BARE_CALLS["setTimeout"]])
    output = RIG.run([spared, judged])[1]
    assert reported_paths(output, [spared, judged]) == [judged]
