"""The gate that holds tests to docs/testing.md rules 2, 3 and 10 and the Markers clause.

``scripts/gates/check_test_assertions.py`` reads a test file and reports every
test function without exactly one assertion outside a loop, every assertion
whose shape the policy forbids, every skip the owner has not exempted and every
assert sitting outside a test function. The observable contract is the list
``check_file`` hands back, one ``(category, location, count)`` tuple per
finding, and the exit status ``main`` derives from it.

Every case writes a tiny test file into ``tmp_path`` and pins which of the
sites this file wrote are reported, by category, by the function name or line
number the location carries, and by count; the gate's own wording is never
asserted. Every name and sentence below is invented for this file.
"""

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

#: The checkout this test file sits in.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = REPO_ROOT / "scripts" / "gates" / "check_test_assertions.py"

#: The reason string an exempt table carries; its wording is never asserted.
REASON = "invented reason"


def load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_test_assertions_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(str(GATE_PATH))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = load_gate_module()


def write_test_file(tmp_path: Path, body: list[str]) -> Path:
    """Write ``body`` as ``test_x.py`` under ``tmp_path`` and return its path."""
    path = tmp_path / "test_x.py"
    path.write_text("\n".join(body) + "\n", encoding="utf-8")
    return path


def line_of(body: list[str], text: str) -> int:
    """The 1-based line number of ``text`` in the written file."""
    return body.index(text) + 1


def by_name(findings: list[tuple[str, str, int]]) -> list[tuple[str, str, int]]:
    """Project each finding onto ``(category, function name, count)``, sorted."""
    return sorted((category, location.rsplit(" ", 1)[-1], count) for category, location, count in findings)


def by_line(findings: list[tuple[str, str, int]], path: Path) -> list[tuple[str, int]]:
    """Project each finding onto ``(category, line number)``, sorted."""
    projected = []
    for category, location, _count in findings:
        after_path = location[len(str(path)) + 1 :]
        projected.append((category, int(after_path.split(" ", 1)[0])))
    return sorted(projected)


def test_root_conjunctions_count_their_operands_and_a_nested_or_is_not_walked(
    tmp_path: Path,
) -> None:
    """Four one-assert tests: two root conjunctions, one generator, one buried ``or``."""
    body = [
        "def test_one() -> None:",
        "    assert a and b",
        "",
        "",
        "def test_two() -> None:",
        "    assert a and b and c",
        "",
        "",
        "def test_three() -> None:",
        "    assert not any(v for v in vs)",
        "",
        "",
        "def test_four() -> None:",
        '    assert (d or {})["k"] == 1',
    ]
    findings = GATE.check_file(write_test_file(tmp_path, body))
    assert by_name(findings) == [
        ("count", "test_one", 2),
        ("count", "test_two", 3),
        ("loop", "test_three", 0),
    ]


def test_asserts_in_a_helper_and_a_fixture_are_outside_while_a_nested_def_is_not_scanned(
    tmp_path: Path,
) -> None:
    """The helper and the fixture assert on one line each; the nested ``def`` is skipped."""
    helper = "def helper(value: int) -> None: assert value == 1"
    fixture = "def cfg() -> None: assert LOADED == 1"
    body = [
        "import pytest",
        "",
        "",
        helper,
        "",
        "",
        "@pytest.fixture",
        fixture,
        "",
        "",
        "def test_one() -> None:",
        "    def inner() -> None:",
        "        assert x == 2",
        "",
        "    assert y == 3",
    ]
    path = write_test_file(tmp_path, body)
    findings = GATE.check_file(path)
    assert by_line(findings, path) == [
        ("outside", line_of(body, helper)),
        ("outside", line_of(body, fixture)),
    ]


def test_existence_shapes_are_reported_but_not_is_none_nor_an_exempted_site(
    tmp_path: Path,
) -> None:
    """Five one-assert tests; only the two unexempted existence shapes come back."""
    body = [
        "def test_one() -> None:",
        "    assert x is not None",
        "",
        "",
        "def test_two() -> None:",
        "    assert len(xs) > 0",
        "",
        "",
        "def test_three() -> None:",
        "    assert x == 3",
        "",
        "",
        "def test_four() -> None:",
        "    assert x is None",
        "",
        "",
        "def test_five() -> None:",
        "    assert y is not None",
    ]
    path = write_test_file(tmp_path, body)
    findings = GATE.check_file(path, exempt={f"{path}::test_five": REASON})
    assert by_name(findings) == [
        ("existence", "test_one", 0),
        ("existence", "test_two", 0),
    ]


def test_skip_decorator_and_private_attribute_are_reported_but_not_exempt_xfail_skip_call_or_dunder(
    tmp_path: Path,
) -> None:
    """Five one-assert tests; only the bare skip decorator and the private read come back."""
    body = [
        "import pytest",
        "",
        "",
        '@pytest.mark.skip(reason="invented")',
        "def test_one() -> None:",
        "    assert x == 1",
        "",
        "",
        '@pytest.mark.xfail(reason="invented")',
        "def test_two() -> None:",
        "    assert x == 2",
        "",
        "",
        "def test_three() -> None:",
        '    pytest.skip("invented")',
        "    assert x == 3",
        "",
        "",
        "def test_four() -> None:",
        "    assert obj._hidden == 4",
        "",
        "",
        "def test_five() -> None:",
        "    assert obj.__enter__() == 5",
    ]
    path = write_test_file(tmp_path, body)
    findings = GATE.check_file(path, exempt={f"{path}::test_two": REASON})
    assert by_name(findings) == [
        ("private", "test_four", 0),
        ("skip", "test_one", 0),
    ]


def test_main_refuses_a_plain_path_and_returns_zero_under_report(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """One file with one two-operand conjunction: exit 1 bare, exit 0 behind ``--report``."""
    path = write_test_file(tmp_path, ["def test_one() -> None:", "    assert a and b"])
    monkeypatch.setattr(sys, "argv", ["check_test_assertions.py", str(path)])
    plain = GATE.main()
    monkeypatch.setattr(sys, "argv", ["check_test_assertions.py", "--report", str(path)])
    report = GATE.main()
    capsys.readouterr()
    assert (plain, report) == (1, 0)
