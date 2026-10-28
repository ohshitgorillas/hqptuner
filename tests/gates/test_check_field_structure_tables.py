"""The structure gate's refusal of a table keyed by field names outside the register's home.

``scripts/gates/check_field_structure.py`` refuses a module-level mapping or set
whose keys are field names, the names of the register's rows, anywhere outside
``hqptuner/fields/``. Inside that package the same table is allowed.

The seam is ``main(argv) -> int``: file paths in, one ``<path>:<line>:`` line
per hit out, exit 1 on any hit and 0 on none. Every fixture source sits in
``tests/support/fixtures/field_structure/`` as text, with ``@A@`` and ``@B@``
standing for the two field names a case keys its table by, and is laid down
under ``tmp_path`` at the path the case judges.
"""

import importlib.util
import re
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

#: The gate script under test, found by path: ``scripts/gates/`` is no package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_field_structure.py"

#: The fixture sources this file lays down.
FIXTURES = Path(__file__).resolve().parents[1] / "support" / "fixtures" / "field_structure"


def _load_gate() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_field_structure_tables_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate()

#: Two pairs of register rows, each pair from different parts of the register,
#: so no one spelling settles a case.
FIELD_PAIRS = [("mode", "dither"), ("alsa_dop", "post_bauer_level")]

#: Each fixture shape of a module-level table keyed by ``@A@`` and ``@B@``,
#: and the line the table's statement opens on.
TABLE_SHAPES = {
    "table_dict_display.txt": 7,
    "table_set_display.txt": 3,
    "table_frozenset_call.txt": 6,
    "table_annotated_dict.txt": 3,
    "table_dict_call.txt": 7,
    "table_multiline_dict.txt": 7,
}

#: Each fixture holding one refused table on ``NEAR_MISS_HIT_LINE`` beside a
#: table the rule does not reach: keyed by other words, holding field names as
#: values, or built inside a function.
NEAR_MISSES = ["table_beside_other_keys.txt", "table_beside_values.txt", "table_beside_local.txt"]

#: The line of every near-miss fixture that opens its refused table.
NEAR_MISS_HIT_LINE = 3

#: The lines ``table_two_tables.txt`` opens its two tables on.
TWO_TABLE_LINES = [3, 5]

#: A module outside the register's home.
JUDGED_FILE = "hqptuner/lanes/live/routes.py"


def lay(root: Path, fixture: str, relative: str, names: tuple[str, str] = FIELD_PAIRS[0]) -> Path:
    """Write ``fixture`` to ``relative`` under ``root``, ``names`` standing in for ``@A@`` and ``@B@``."""
    text = (FIXTURES / fixture).read_text(encoding="utf-8")
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.replace("@A@", names[0]).replace("@B@", names[1]), encoding="utf-8")
    return path


def gate_output(capsys: pytest.CaptureFixture[str], paths: list[Path]) -> tuple[int, list[str]]:
    """The gate's exit code on ``paths`` and every line it printed to either stream."""
    code = GATE.main([str(path) for path in paths])
    captured = capsys.readouterr()
    return code, (captured.out + captured.err).splitlines()


def hit_lines(output: list[str], path: Path) -> list[int]:
    """The line numbers ``output`` reports for ``path``, sorted."""
    opening = re.compile(rf"^{re.escape(str(path))}:(\d+):")
    return sorted(int(found.group(1)) for found in map(opening.match, output) if found)


def reported_keys(output: list[str], paths: dict[str, Path]) -> list[str]:
    """The keys of ``paths`` that ``output`` reports at least one hit for, in given order."""
    return [key for key, path in paths.items() if hit_lines(output, path)]


def openings(output: list[str]) -> list[str]:
    """Each printed line cut to its ``<path>:<line>:`` opening, or whole where it has none."""
    opening = re.compile(r"^(.+?:\d+:)")
    return sorted(found.group(1) if (found := opening.match(line)) else line for line in output)


@pytest.mark.parametrize("names", FIELD_PAIRS, ids=["-".join(pair) for pair in FIELD_PAIRS])
@pytest.mark.parametrize("shape", list(TABLE_SHAPES))
def test_a_module_level_table_keyed_by_field_names_is_refused_at_its_line(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], shape: str, names: tuple[str, str]
) -> None:
    path = lay(tmp_path, shape, JUDGED_FILE, names)
    assert hit_lines(gate_output(capsys, [path])[1], path) == [TABLE_SHAPES[shape]]


@pytest.mark.parametrize("fixture", NEAR_MISSES)
def test_only_the_module_level_table_keyed_by_field_names_is_a_hit(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], fixture: str
) -> None:
    path = lay(tmp_path, fixture, JUDGED_FILE)
    assert hit_lines(gate_output(capsys, [path])[1], path) == [NEAR_MISS_HIT_LINE]


def test_every_printed_line_is_one_hit_opening_with_its_path_and_line(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = lay(tmp_path, "table_two_tables.txt", JUDGED_FILE, FIELD_PAIRS[1])
    assert openings(gate_output(capsys, [path])[1]) == [f"{path}:{line}:" for line in TWO_TABLE_LINES]


def test_only_a_file_with_a_table_keyed_by_field_names_fails_the_gate(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    clean = lay(tmp_path, "table_clean.txt", "hqptuner/lanes/live/colors.py")
    dirty = lay(tmp_path, "table_dict_display.txt", JUDGED_FILE)
    assert (gate_output(capsys, [clean])[0], gate_output(capsys, [dirty])[0]) == (0, 1)


@pytest.mark.parametrize(
    ("relative", "reported"),
    [
        ("hqptuner/fields/register.py", ["judged"]),
        ("hqptuner/fields/sets.py", ["judged"]),
        ("hqptuner/presets/fields/rows.py", ["candidate", "judged"]),
        ("hqptuner/lanes/fields.py", ["candidate", "judged"]),
    ],
    ids=["register", "fields-package", "fields-directory-elsewhere", "fields-module-elsewhere"],
)
def test_only_modules_inside_the_fields_package_may_keep_a_table_keyed_by_field_names(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], relative: str, reported: list[str]
) -> None:
    candidate = lay(tmp_path, "table_dict_display.txt", relative)
    judged = lay(tmp_path, "table_dict_display.txt", JUDGED_FILE)
    output = gate_output(capsys, [candidate, judged])[1]
    assert reported_keys(output, {"candidate": candidate, "judged": judged}) == reported
