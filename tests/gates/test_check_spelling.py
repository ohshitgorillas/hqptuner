"""The gate that holds the repository to American spelling.

``scripts/gates/check_spelling.py`` reads the files it is handed and reports
every whole word found on its fixed British-to-American list, naming where it
sits and the American form to use. Third-party files and third-party API names
that carry a British spelling are exempt.

The seams are ``check_file(path) -> list[str]``, one problem line per British
word, each opening ``<path>:<line>:`` and naming the American form, and
``main(argv) -> int``, which takes file paths the way ``git ls-files`` hands
them over and exits nonzero when any of them carries a British spelling. Every
sentence below is invented here.
"""

import importlib.util
import re
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_spelling.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_spelling_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()

#: A line carrying one British spelling, used wherever a test needs the gate to
#: have something to report.
BRITISH_LINE = "the needle takes its colour from the theme"

#: The same line in American spelling.
AMERICAN_LINE = "the needle takes its color from the theme"


def tracked(tmp_path: Path, relative: str, lines: list[str]) -> Path:
    """Write ``lines`` to ``relative`` under the test's root and return the path."""
    path = tmp_path / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def reported_lines(path: Path) -> list[int]:
    """The line numbers the gate reports for ``path``, in report order."""
    prefix = re.compile(rf"^{re.escape(str(path))}:(\d+):")
    return [int(match.group(1)) for match in map(prefix.match, GATE.check_file(path)) if match]


@pytest.mark.parametrize(
    ("lines", "line"),
    [
        ([BRITISH_LINE], 1),
        ([AMERICAN_LINE, "", "# notes", BRITISH_LINE, AMERICAN_LINE], 4),
    ],
    ids=["first-line", "fourth-line"],
)
def test_a_british_spelling_is_reported_at_its_file_and_line(tmp_path: Path, lines: list[str], line: int) -> None:
    """Each British word is one problem that opens with the file and the line it sits on."""
    path = tracked(tmp_path, "notes/readme.md", lines)
    assert [problem.startswith(f"{path}:{line}:") for problem in GATE.check_file(path)] == [True]


@pytest.mark.parametrize(
    ("british", "american"),
    [("colour", "color"), ("behaviour", "behavior")],
)
def test_a_report_names_the_american_form_to_use(tmp_path: Path, british: str, american: str) -> None:
    """The problem line carries the American spelling as a whole word."""
    path = tracked(tmp_path, "notes/readme.md", [f"the {british} of the needle"])
    assert [re.search(rf"\b{american}\b", problem) is not None for problem in GATE.check_file(path)] == [True]


@pytest.mark.parametrize(
    "american",
    [AMERICAN_LINE, "the meter keeps its behavior when the window shrinks"],
    ids=["color", "behavior"],
)
def test_american_spelling_is_not_reported(tmp_path: Path, american: str) -> None:
    """Of an American line and a British one, only the British one is reported."""
    path = tracked(tmp_path, "notes/readme.md", [american, BRITISH_LINE])
    assert reported_lines(path) == [2]


@pytest.mark.parametrize(
    "innocent",
    [
        "the reading is precise to a tenth of a decibel",
        "the noise floor sits below the signal",
        "the promise resolves once the engine answers",
    ],
    ids=["precise", "noise", "promise"],
)
def test_a_word_that_only_ends_like_a_british_spelling_is_not_reported(tmp_path: Path, innocent: str) -> None:
    """Only whole words on the list trip the gate, never a shared ending."""
    path = tracked(tmp_path, "notes/readme.md", [innocent, BRITISH_LINE])
    assert reported_lines(path) == [2]


@pytest.mark.parametrize(
    "api_use",
    [
        "    if task.cancelled():",
        "    except asyncio.CancelledError:",
        '<section aria-labelledby="meter-title">',
    ],
    ids=["task-cancelled", "cancelled-error", "aria-labelledby"],
)
def test_a_third_party_api_name_is_not_reported(tmp_path: Path, api_use: str) -> None:
    """A British spelling that is part of a third-party API name is exempt."""
    path = tracked(tmp_path, "notes/source.txt", [api_use, BRITISH_LINE])
    assert reported_lines(path) == [2]


@pytest.mark.parametrize(
    "own_use",
    [
        "# the refresh is cancelled when the drawer closes",
        "# every knob is labelled by its engine name",
    ],
    ids=["cancelled", "labelled"],
)
def test_our_own_cancelled_and_labelled_are_reported(tmp_path: Path, own_use: str) -> None:
    """Outside a third-party API name, "cancelled" and "labelled" are British spellings like any other."""
    path = tracked(tmp_path, "notes/source.txt", [own_use, AMERICAN_LINE])
    assert reported_lines(path) == [1]


@pytest.mark.parametrize(
    ("directory", "code"),
    [
        ("hqptuner/static/vendor", 0),
        ("docs/official", 0),
        ("hqptuner/static", 1),
        ("docs", 1),
    ],
)
def test_a_british_spelling_fails_the_gate_only_outside_third_party_files(
    tmp_path: Path, directory: str, code: int
) -> None:
    """Vendored code and HQPlayer's own docs are exempt; their parent directories are not."""
    path = tracked(tmp_path, f"{directory}/third.txt", [BRITISH_LINE])
    assert GATE.main([str(path)]) == code


@pytest.mark.parametrize(("line", "code"), [(BRITISH_LINE, 1), (AMERICAN_LINE, 0)], ids=["british", "american"])
def test_a_file_fails_the_gate_exactly_when_it_carries_a_british_spelling(tmp_path: Path, line: str, code: int) -> None:
    """The gate's exit status follows the spelling of the files it is handed."""
    path = tracked(tmp_path, "notes/readme.md", [line])
    assert GATE.main([str(path)]) == code
