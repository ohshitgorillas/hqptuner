"""The gate that holds tests to the forbidden shapes.

``scripts/gates/testing/check_test_assertions.py`` reads a test file and reports
every test with no assertion, every root conjunction inside an assert, every
assertion swept by a loop or ``all()``/``any()``, every assert sitting outside a
test function and every skip the owner has not exempted. The observable
contract is the list ``check_file`` hands back, one ``(category, location)``
pair per finding, and the exit status ``main`` derives from it.

Every case writes a tiny test file into ``tmp_path`` and pins which of the
sites this file wrote are reported, by category and by the function name or
line number the location carries; the gate's own wording is never asserted.
Every name and sentence below is invented for this file.
"""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

#: The checkout this test file sits in.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = REPO_ROOT / "scripts" / "gates" / "testing" / "check_test_assertions.py"

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


def by_name(findings: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Project each finding onto ``(category, function name)``, sorted."""
    return sorted((finding[0], finding[1].rsplit(" ", 1)[-1]) for finding in findings)


def by_line(findings: list[tuple[str, str]], path: Path) -> list[tuple[str, int]]:
    """Project each finding onto ``(category, line number)``, sorted."""
    projected = []
    for finding in findings:
        after_path = finding[1][len(str(path)) + 1 :]
        projected.append((finding[0], int(after_path.split(" ", 1)[0])))
    return sorted(projected)


def test_a_test_with_no_assertion_is_zero_but_a_raises_block_or_a_plain_assert_is_not(
    tmp_path: Path,
) -> None:
    """Three tests: one asserts only inside a nested ``def``, one raises, one asserts."""
    body = [
        "import pytest",
        "",
        "",
        "def test_one() -> None:",
        "    def inner() -> None:",
        "        assert x == 1",
        "",
        "    inner()",
        "",
        "",
        "def test_two() -> None:",
        "    with pytest.raises(KeyError):",
        '        d["k"]',
        "",
        "",
        "def test_three() -> None:",
        "    assert x == 3",
    ]
    findings = GATE.check_file(write_test_file(tmp_path, body))
    assert by_name(findings) == [("zero", "test_one")]


def test_a_root_conjunction_is_reported_through_a_leading_not_but_a_nested_or_is_not(
    tmp_path: Path,
) -> None:
    """Three one-assert tests: a root ``and``, a negated root ``or``, a buried ``or``."""
    body = [
        "def test_one() -> None:",
        "    assert a and b",
        "",
        "",
        "def test_two() -> None:",
        "    assert not (a or b)",
        "",
        "",
        "def test_three() -> None:",
        '    assert (d or {})["k"] == 1',
    ]
    findings = GATE.check_file(write_test_file(tmp_path, body))
    assert by_name(findings) == [("conjunction", "test_one"), ("conjunction", "test_two")]


def test_an_assert_under_for_while_or_an_all_any_sweep_is_loop_but_a_plain_assert_is_not(
    tmp_path: Path,
) -> None:
    """Four one-assert tests: under ``for``, under ``while``, an ``any()`` sweep, a plain claim."""
    body = [
        "def test_one() -> None:",
        "    for v in vs:",
        "        assert v == 1",
        "",
        "",
        "def test_two() -> None:",
        "    while vs:",
        "        assert vs.pop() == 2",
        "",
        "",
        "def test_three() -> None:",
        "    assert not any(v for v in vs)",
        "",
        "",
        "def test_four() -> None:",
        "    assert [v for v in vs] == [4]",
    ]
    findings = GATE.check_file(write_test_file(tmp_path, body))
    assert by_name(findings) == [("loop", "test_one"), ("loop", "test_three"), ("loop", "test_two")]


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


def test_skip_decorators_and_calls_are_reported_unless_exempt(tmp_path: Path) -> None:
    """Four one-assert tests: a skip mark, an exempt xfail mark, a skip call, none."""
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
        '    pytest.xfail("invented")',
        "    assert x == 3",
        "",
        "",
        "def test_four() -> None:",
        "    assert x == 4",
    ]
    path = write_test_file(tmp_path, body)
    findings = GATE.check_file(path, exempt={f"{path}::test_two": REASON})
    assert by_name(findings) == [("skip", "test_one"), ("skip", "test_three")]


GUARDED = ["def test_one() -> None:", "    x = lookup()", "    assert x is not None"]


@pytest.mark.parametrize(
    ("body", "findings"),
    [
        ([*GUARDED, '    assert x["k"] == 1'], []),
        ([*GUARDED, "    for v in x:", "        assert v == 1"], [("loop", "test_one")]),
    ],
    ids=["one claim", "swept claim"],
)
def test_a_guard_followed_by_one_claim_is_not_reported_but_the_claim_in_a_loop_is(
    tmp_path: Path, body: list[str], findings: list[tuple[str, str]]
) -> None:
    """A guard assert then one claim is clean; the same claim swept by a loop is ``loop``."""
    assert by_name(GATE.check_file(write_test_file(tmp_path, body))) == findings


@pytest.mark.parametrize(("flags", "expected"), [([], 1), (["--report"], 0)], ids=["bare", "report"])
def test_main_refuses_a_plain_path_and_returns_zero_under_report(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], flags: list[str], expected: int
) -> None:
    """One file with one root conjunction: exit 1 bare, exit 0 behind ``--report``."""
    path = write_test_file(tmp_path, ["def test_one() -> None:", "    assert a and b"])
    code = GATE.main([*flags, str(path)])
    capsys.readouterr()
    assert code == expected
