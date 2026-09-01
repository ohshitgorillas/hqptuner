"""The gate that keeps owner copy out of test assertions (docs/testing.md rule 9).

``scripts/gates/check_no_copy_assertions.py`` reads a test file and reports every
prose literal (two or more alphabetic words) that sits inside an ``assert``
expression, unless the literal is input the test itself handed over or is
covered by a seed the suite's own support code wrote. The observable contract is
the list ``check_file`` hands back, one ``(category, location)`` tuple per
reported literal, and the exit status ``main`` derives from it.

Every case builds a tiny suite in ``tmp_path`` laid out as ``tests/unit/`` plus
``tests/support/``, because the coverage pool is found by walking up from the
checked file to the nearest directory named ``tests``. Assertions pin counts and
the line numbers of sites this file wrote; the gate's own wording is never
asserted. Every sentence below is invented for this file.
"""

import importlib.util
from pathlib import Path
from types import ModuleType

#: The checkout this test file sits in.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = REPO_ROOT / "scripts" / "gates" / "check_no_copy_assertions.py"

#: Comment lines padding the checked file so every site of interest lands past
#: line 20, keeping its line number distinct from any column the gate may print.
PADDING = ["# padding"] * 20

#: A seed the support module spells out as a plain string.
PY_SEED = "quiet harbor"

#: A seed that lives in a non-Python fixture file under ``support/fixtures/``.
FIXTURE_SEED = "amber lantern"

#: A literal a support f-string skeleton produces with its hole filled in.
SKELETON_INSTANCE = "log line 60"

#: A sentence that contains ``PY_SEED`` but carries a word no seed supplies.
UNCOVERED = f"{PY_SEED} drifts"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_no_copy_assertions_under_test", GATE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()


def write_checked_file(tmp_path: Path, body: list[str]) -> Path:
    """Write ``body`` under ``tests/unit/`` of a throwaway suite and return its path."""
    unit_dir = tmp_path / "tests" / "unit"
    unit_dir.mkdir(parents=True)
    path = unit_dir / "test_x.py"
    path.write_text("\n".join(PADDING + body) + "\n", encoding="utf-8")
    return path


def seed_support(tmp_path: Path) -> None:
    """Populate ``tests/support/`` with the seeds the coverage cases rely on."""
    support = tmp_path / "tests" / "support"
    fixtures = support / "fixtures"
    fixtures.mkdir(parents=True)
    (support / "fake.py").write_text(
        "\n".join(
            [
                f'BANNER = "{PY_SEED}"',
                "",
                "",
                "def log(i: int) -> str:",
                '    return f"log line {i}"',
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (fixtures / "page.html").write_text(f"<p>\n{FIXTURE_SEED}\n</p>\n", encoding="utf-8")


def line_of(index: int) -> int:
    """The 1-based line number of the body line at ``index`` in the written file."""
    return len(PADDING) + index + 1


def sits_at(finding: tuple[str, str], path: Path, lineno: int) -> bool:
    """Whether a finding's location names ``lineno`` once the file path is stripped out."""
    _category, location = finding
    return str(lineno) in location.replace(str(path), "")


def test_a_literal_handed_to_a_plain_call_is_input_while_a_method_call_argument_is_reported(
    tmp_path: Path,
) -> None:
    """Same words, two shapes: only the method-call site on a value under test is a finding."""
    body = [
        "def test_it() -> None:",
        '    assert WORDS("alpha beta gamma") == 3',
        '    assert body.count("delta epsilon zeta") == 1',
    ]
    path = write_checked_file(tmp_path, body)
    findings = GATE.check_file(path)
    assert len(findings) == 1 and sits_at(findings[0], path, line_of(2))


def test_support_seeds_cover_verbatim_composed_and_skeleton_literals_but_not_an_extra_word(
    tmp_path: Path,
) -> None:
    """Of five asserted literals only the one carrying a word outside the seeds is reported."""
    seed_support(tmp_path)
    body = [
        "def test_it() -> None:",
        f'    assert body == "{PY_SEED}"',
        f'    assert body == "{FIXTURE_SEED}"',
        f'    assert body == "{PY_SEED}, {FIXTURE_SEED}"',
        f'    assert body == "{SKELETON_INSTANCE}"',
        f'    assert body == "{UNCOVERED}"',
    ]
    path = write_checked_file(tmp_path, body)
    findings = GATE.check_file(path)
    assert len(findings) == 1 and sits_at(findings[0], path, line_of(5))
