"""The gate that refuses comments narrating the code's past.

``scripts/gates/check_archaeology.py`` reads ``.py``, ``.js`` and ``.css``
files, pulls the comments out of them, and complains about any line whose
prose tells the reader where the code came from rather than what constrains it
now. A comment carrying ``history-ok:`` and a stated reason is excused; the
pragma with nothing after it is itself a complaint, because an excuse with no
reason excuses nothing.

Each case writes one small file into ``tmp_path`` and asks the gate about it.
The observable contract is the list ``check_file`` hands back: empty means the
file is clean, non-empty means at least one line is refused. Cases assert on
whether a complaint was produced rather than on its wording, the one exception
being the pragma-with-no-reason case, where the wording is the behavior.

Every phrase this suite feeds the gate lives in a Python string literal, never
in a comment or docstring here, so this file is itself clean by the rule it
pins.

The seam is ``check_file(path) -> list[str]``.
"""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

GATE_PATH = REPO_ROOT / "scripts" / "gates" / "check_archaeology.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_archaeology_under_test", GATE_PATH)
    assert spec is not None and spec.loader is not None, f"no importable module at {GATE_PATH}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()
CHECK_FILE = GATE.check_file


def complaints_for(tmp_path: Path, name: str, source: str) -> list[str]:
    """Write ``source`` at ``name`` under ``tmp_path`` and return what the gate says about it."""
    path = tmp_path / name
    path.write_text(source, encoding="utf-8")
    return list(CHECK_FILE(path))


def refuses(tmp_path: Path, name: str, source: str) -> bool:
    """True when the gate complains about at least one line of ``source``."""
    return bool(complaints_for(tmp_path, name, source))


def py_comment(text: str) -> str:
    return f"value = 1  # {text}\n"


def py_docstring(text: str) -> str:
    return f'"""{text}"""\n\nvalue = 1\n'


def js_line_comment(text: str) -> str:
    return f"const value = 1; // {text}\n"


def js_block_comment(text: str) -> str:
    return f"/* {text} */\nconst value = 1;\n"


def css_comment(text: str) -> str:
    return f"/* {text} */\n.panel {{ margin: 0; }}\n"


# Phrases that carry no history in them at all.
CLEAN_PY = '"""Read the staged config and hand back the panel model."""\n\nvalue = 1  # keep in sync with the schema\n'
CLEAN_JS = "// the poll interval the API contract fixes at two seconds\nconst value = 1;\n"
CLEAN_CSS = "/* the shared text-input rule is 28rem */\n.panel { margin: 0; }\n"

A_REASON = "history-ok: the wire format pins this and the daemon rejects anything else"

REFACTOR_PHRASES = [
    "split out of app.css",
    "extracted from app.css",
    "moved out of app.css",
    "lifted out of app.css",
    "pulled out of app.css",
    "carved out of app.css",
]

REPLACEMENT_PHRASES = [
    "the rule this replaced set the same margin",
    "the shorthand which replaced it set the same margin",
    "the shorthand that replaced it set the same margin",
]

MEASUREMENT_PHRASES = [
    "the bar was 45.5px before",
    "put 48px between two packs",
]


# --- existing behavior: dates, narration verbs, commit citations ---------------


def test_an_iso_date_in_a_python_comment_is_refused(tmp_path: Path) -> None:
    assert refuses(tmp_path, "sample.py", py_comment("added 2025-11-04 for the resampler panel"))


def test_a_past_tense_narration_verb_in_a_javascript_comment_is_refused(tmp_path: Path) -> None:
    assert refuses(tmp_path, "sample.js", js_line_comment("this used to read the signal directly"))


def test_a_conventional_commit_citation_in_a_css_comment_is_refused(tmp_path: Path) -> None:
    assert refuses(tmp_path, "sample.css", css_comment("fix(live): the panel lost its margin"))


def test_a_python_docstring_narrating_the_past_is_refused(tmp_path: Path) -> None:
    assert refuses(tmp_path, "sample.py", py_docstring("This used to live beside the lane module."))


def test_a_javascript_block_comment_narrating_the_past_is_refused(tmp_path: Path) -> None:
    assert refuses(tmp_path, "sample.js", js_block_comment("the store used to poll on its own timer"))


# --- existing behavior: the pragma --------------------------------------------


def test_a_refused_phrase_carrying_a_history_ok_reason_is_allowed(tmp_path: Path) -> None:
    assert not refuses(tmp_path, "sample.py", py_comment(f"added 2025-11-04 for the resampler panel  {A_REASON}"))


def test_a_bare_history_ok_pragma_with_no_reason_is_refused(tmp_path: Path) -> None:
    assert refuses(tmp_path, "sample.py", py_comment("added 2025-11-04 for the resampler panel  history-ok:"))


def test_a_bare_history_ok_pragma_is_told_it_owes_a_reason(tmp_path: Path) -> None:
    found = complaints_for(tmp_path, "sample.py", py_comment("this used to poll  history-ok:"))
    assert "reason" in " ".join(found).lower()


# --- existing behavior: clean files and code that is not a comment ------------


@pytest.mark.parametrize(
    ("name", "source"),
    [("sample.py", CLEAN_PY), ("sample.js", CLEAN_JS), ("sample.css", CLEAN_CSS)],
)
def test_a_file_whose_comments_narrate_nothing_produces_no_complaints(tmp_path: Path, name: str, source: str) -> None:
    assert not refuses(tmp_path, name, source)


def test_a_refused_phrase_inside_a_python_string_literal_is_not_refused(tmp_path: Path) -> None:
    assert not refuses(tmp_path, "sample.py", 'label = "this used to be 2025-11-04"\n')


def test_a_refused_phrase_appearing_as_a_css_property_value_is_not_refused(tmp_path: Path) -> None:
    assert not refuses(tmp_path, "sample.css", '.panel::after { content: "this used to be 2025-11-04"; }\n')


# --- added behavior: refactor archaeology in either preposition ---------------


@pytest.mark.parametrize("phrase", REFACTOR_PHRASES)
def test_refactor_archaeology_is_refused_in_a_css_comment(tmp_path: Path, phrase: str) -> None:
    assert refuses(tmp_path, "sample.css", css_comment(f"The panel rule, {phrase}."))


@pytest.mark.parametrize("phrase", REFACTOR_PHRASES)
def test_refactor_archaeology_is_refused_in_a_python_comment(tmp_path: Path, phrase: str) -> None:
    assert refuses(tmp_path, "sample.py", py_comment(f"the helper below, {phrase}"))


def test_refactor_archaeology_capitalized_at_the_start_of_a_comment_is_refused(tmp_path: Path) -> None:
    assert refuses(tmp_path, "sample.css", css_comment("Split out of app.css"))


# --- added behavior: replacement narration ------------------------------------


@pytest.mark.parametrize("phrase", REPLACEMENT_PHRASES)
def test_replacement_narration_is_refused_in_a_css_comment(tmp_path: Path, phrase: str) -> None:
    assert refuses(tmp_path, "sample.css", css_comment(phrase))


@pytest.mark.parametrize("phrase", REPLACEMENT_PHRASES)
def test_replacement_narration_is_refused_in_a_javascript_comment(tmp_path: Path, phrase: str) -> None:
    assert refuses(tmp_path, "sample.js", js_line_comment(phrase))


# --- added behavior: measurement archaeology ----------------------------------


@pytest.mark.parametrize("phrase", MEASUREMENT_PHRASES)
def test_a_past_tense_verb_beside_a_css_length_is_refused(tmp_path: Path, phrase: str) -> None:
    assert refuses(tmp_path, "sample.css", css_comment(phrase))


@pytest.mark.parametrize("phrase", MEASUREMENT_PHRASES)
def test_a_past_tense_verb_beside_a_css_length_is_refused_in_a_javascript_comment(tmp_path: Path, phrase: str) -> None:
    assert refuses(tmp_path, "sample.js", js_line_comment(phrase))


def test_a_live_measurement_with_no_past_tense_verb_is_allowed(tmp_path: Path) -> None:
    assert not refuses(tmp_path, "sample.css", css_comment("the shared text-input rule is 28rem"))


def test_a_live_measurement_with_no_past_tense_verb_is_allowed_in_a_python_comment(tmp_path: Path) -> None:
    assert not refuses(tmp_path, "sample.py", py_comment("the shared text-input rule is 28rem"))


# --- added behavior: settled-state narration ----------------------------------


def test_as_it_always_was_is_refused_in_a_python_comment(tmp_path: Path) -> None:
    assert refuses(tmp_path, "sample.py", py_comment("the lane returns the staged model, as it always was"))


def test_as_it_always_was_is_refused_in_a_css_comment(tmp_path: Path) -> None:
    assert refuses(tmp_path, "sample.css", css_comment("the panel keeps its margin, as it always was"))


# --- added behavior: every new refusal is exemptible --------------------------


@pytest.mark.parametrize("phrase", REFACTOR_PHRASES)
def test_refactor_archaeology_carrying_a_history_ok_reason_is_allowed(tmp_path: Path, phrase: str) -> None:
    assert not refuses(tmp_path, "sample.css", css_comment(f"The panel rule, {phrase}. {A_REASON}"))


@pytest.mark.parametrize("phrase", REPLACEMENT_PHRASES)
def test_replacement_narration_carrying_a_history_ok_reason_is_allowed(tmp_path: Path, phrase: str) -> None:
    assert not refuses(tmp_path, "sample.css", css_comment(f"{phrase}. {A_REASON}"))


@pytest.mark.parametrize("phrase", MEASUREMENT_PHRASES)
def test_measurement_archaeology_carrying_a_history_ok_reason_is_allowed(tmp_path: Path, phrase: str) -> None:
    assert not refuses(tmp_path, "sample.css", css_comment(f"{phrase}. {A_REASON}"))


def test_as_it_always_was_carrying_a_history_ok_reason_is_allowed(tmp_path: Path) -> None:
    comment = py_comment(f"the lane returns the staged model, as it always was  {A_REASON}")
    assert not refuses(tmp_path, "sample.py", comment)
