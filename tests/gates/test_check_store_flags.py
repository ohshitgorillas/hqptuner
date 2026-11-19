"""The gate that refuses a per-field flag naming a store to prefer in the frontend.

``scripts/gates/check_store_flags.py`` scans the text of the files it is handed
and refuses ``fileTruth`` and ``appliesLive`` under ``hqptuner/static/``: the
server says which store answers a field, and the client keeps no copy of that
rule.

The seam is ``main(argv) -> int``: file paths in, one ``<path>:<line>:`` line
per hit out, exit 1 on any hit and 0 on none. Every fixture source sits in
``tests/support/fixtures/store_flags/`` as text, with ``@NAME@`` standing for
the flag a case is about, and is laid down under ``tmp_path`` at the path the
case judges.
"""

from pathlib import Path

import pytest
from gate_scripts import FixtureGate, load_gate, reported_paths

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_store_flags.py"

#: The fixture sources this file lays down.
FIXTURES = Path(__file__).resolve().parents[1] / "support" / "fixtures" / "store_flags"


GATE = load_gate(GATE_PATH, "check_store_flags_under_test")

#: The per-field flags the gate refuses by name.
FLAGS = ["fileTruth", "appliesLive"]

#: Each fixture shape carrying one flag, and the line the flag sits on.
SHAPES = {"lookup.txt": 6, "table.txt": 3}

#: A file the gate judges, by where it sits.
STATIC_FILE = "hqptuner/static/store/settings.js"


RIG = FixtureGate(GATE, FIXTURES)


@pytest.mark.parametrize("name", FLAGS)
@pytest.mark.parametrize("shape", list(SHAPES))
def test_a_store_flag_under_static_is_refused_at_its_path_and_line(tmp_path: Path, shape: str, name: str) -> None:
    assert RIG.lines_reported(tmp_path, shape, STATIC_FILE, name=name) == [SHAPES[shape]]


def test_only_a_file_with_a_store_flag_fails_the_gate(tmp_path: Path) -> None:
    clean = RIG.lay(tmp_path, "clean.txt", "hqptuner/static/store/clean.js")
    dirty = RIG.lay(tmp_path, "lookup.txt", STATIC_FILE, "appliesLive")
    assert (RIG.run([clean])[0], RIG.run([dirty])[0]) == (0, 1)


@pytest.mark.parametrize("relative", ["tests/js/store/settings.test.js", "hqptuner/api/settings.py"])
def test_a_store_flag_outside_static_is_not_reported(tmp_path: Path, relative: str) -> None:
    spared = RIG.lay(tmp_path, "lookup.txt", relative, "fileTruth")
    judged = RIG.lay(tmp_path, "lookup.txt", STATIC_FILE, "fileTruth")
    output = RIG.run([spared, judged])[1]
    assert reported_paths(output, {"spared": spared, "judged": judged}) == ["judged"]
