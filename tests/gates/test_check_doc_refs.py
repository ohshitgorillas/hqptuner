"""The gate that keeps design-doc paths real and code off the design docs.

``scripts/gates/check_doc_refs.py`` reports a backticked repository path in a
``docs/spec/`` file that names no file, and any reference from code to a
design doc, a ``.md`` file under ``docs/spec/``; a file it cannot read is itself
one problem naming the path.

The seam is ``check(path) -> list[str]``; the observable contract is the
list of problem lines it hands back.
"""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_doc_refs.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_doc_refs_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()


def test_an_unreadable_path_is_the_only_thing_reported(tmp_path: Path) -> None:
    """A path that cannot be read is one problem line naming it, not silence."""
    ghost = tmp_path / "ghost.py"
    assert [ghost.name in line for line in GATE.check(ghost)] == [True]


#: A cited path no file in the tree carries, under the ``scripts/`` root.
MISSING_SCRIPT = "scripts/no_such_probe.sh"


def _design_doc(tmp_path: Path, line: str) -> Path:
    """Write ``line`` as the whole body of a design doc under a ``docs/spec/`` directory."""
    spec_dir = tmp_path / "docs" / "spec"
    spec_dir.mkdir(parents=True)
    doc = spec_dir / "fixture-design.md"
    doc.write_text(line + "\n", encoding="utf-8")
    return doc


@pytest.mark.parametrize(
    "missing",
    [
        "hqptuner/no_such_module.py",
        MISSING_SCRIPT,
        "docs/spec/no_such_section.md",
        "tests/no_such_suite.py",
    ],
)
def test_a_design_doc_citing_a_path_that_names_no_file_is_a_problem(tmp_path: Path, missing: str) -> None:
    """A backticked path under any of the four checked roots must name a file in the tree."""
    doc = _design_doc(tmp_path, f"The behavior lives in `{missing}`.")
    assert len(GATE.check(doc)) == 1


@pytest.mark.parametrize(
    "existing",
    ["hqptuner/config.py", "scripts/gate.sh", "docs/spec/testing.md", "tests/gates/test_check_doc_refs.py"],
)
def test_a_cited_path_that_names_a_file_is_not_a_problem(tmp_path: Path, existing: str) -> None:
    """Beside one missing path, an existing one adds no problem of its own."""
    doc = _design_doc(tmp_path, f"The knobs live in `{existing}` and the probe in `{MISSING_SCRIPT}`.")
    assert len(GATE.check(doc)) == 1


@pytest.mark.parametrize(
    "token",
    [
        "hqplayerd.xml",
        "HQPTUNER_HQP_USERNAME",
        "make check",
        "https://example.invalid/docs/spec/gone.md",
        "hqptuner.core.no_such_symbol",
    ],
)
def test_a_backticked_token_that_is_not_a_path_under_a_checked_root_is_not_checked(tmp_path: Path, token: str) -> None:
    """Beside one missing path, a filename, env var, command, URL or symbol adds no problem of its own."""
    doc = _design_doc(tmp_path, f"Set `{token}` before the probe in `{MISSING_SCRIPT}`.")
    assert len(GATE.check(doc)) == 1


#: A design doc named by its repository path.
SPEC_PATH_REF = "docs/spec/protocol.md"

#: Design docs named by their bare file names.
SPEC_BARE_REFS = ["protocol.md", "timing.md"]


def _code_file(tmp_path: Path, relative: str, body: str) -> Path:
    """Write ``body`` at ``relative`` under ``tmp_path``, creating its directories."""
    source = tmp_path / relative
    source.parent.mkdir(parents=True)
    source.write_text(body, encoding="utf-8")
    return source


@pytest.mark.parametrize(
    ("relative", "body"),
    [
        ("hqptuner/lanes/source.py", f"# the frame layout is in {SPEC_PATH_REF}\n"),
        ("tests/test_source.py", f"# the frame layout is in {SPEC_PATH_REF}\n"),
        ("scripts/probe.sh", f"# the frame layout is in {SPEC_PATH_REF}\n"),
        ("hqptuner/static/source.js", f"// the frame layout is in {SPEC_PATH_REF}\n"),
        ("hqptuner/data/labels.json", f'{{"hint": "see {SPEC_PATH_REF}"}}\n'),
    ],
)
def test_code_naming_a_design_doc_by_path_is_a_problem(tmp_path: Path, relative: str, body: str) -> None:
    """A file under any code root that names a ``docs/spec/`` path is one problem."""
    source = _code_file(tmp_path, relative, body)
    assert len(GATE.check(source)) == 1


@pytest.mark.parametrize("bare", SPEC_BARE_REFS)
def test_code_naming_a_design_doc_by_bare_file_name_is_a_problem(tmp_path: Path, bare: str) -> None:
    """A design doc's bare file name in code is a reference to it all the same."""
    source = _code_file(tmp_path, "hqptuner/lanes/source.py", f"# pacing follows {bare}\n")
    assert len(GATE.check(source)) == 1


#: A file under ``docs/spec/`` that is not a design doc.
SPEC_NON_DOC_REF = "docs/spec/openapi.json"


def test_code_naming_a_non_markdown_file_under_docs_spec_is_not_a_problem(tmp_path: Path) -> None:
    """Beside one design-doc reference, a path to a non-``.md`` file under ``docs/spec/`` adds no problem of its own."""
    body = f"# the snapshot is {SPEC_NON_DOC_REF}\n# the frame layout is in {SPEC_PATH_REF}\n"
    source = _code_file(tmp_path, "hqptuner/api/source.py", body)
    assert len(GATE.check(source)) == 1


def test_a_design_doc_reference_in_code_names_the_file(tmp_path: Path) -> None:
    """The problem line says which file carries the reference."""
    source = _code_file(tmp_path, "hqptuner/lanes/source.py", f"# see {SPEC_PATH_REF}\n")
    assert [source.name in line for line in GATE.check(source)] == [True]


def test_a_design_doc_reference_in_code_names_the_reference(tmp_path: Path) -> None:
    """The problem line quotes the reference it found."""
    source = _code_file(tmp_path, "hqptuner/lanes/source.py", f"# see {SPEC_PATH_REF}\n")
    assert [SPEC_PATH_REF in line for line in GATE.check(source)] == [True]


#: The same referencing line, reached after a different count of plain lines.
EARLY_LINE = 2
LATE_LINE = 5


def test_a_design_doc_reference_in_code_names_its_line(tmp_path: Path) -> None:
    """The same reference in the same file reads differently on a different line."""
    source = _code_file(tmp_path, "hqptuner/lanes/source.py", "")
    reference = f"# see {SPEC_PATH_REF}\n"
    source.write_text("x = 1\n" * (EARLY_LINE - 1) + reference, encoding="utf-8")
    early = GATE.check(source)
    source.write_text("x = 1\n" * (LATE_LINE - 1) + reference, encoding="utf-8")
    assert GATE.check(source) != early


@pytest.mark.parametrize(
    "line",
    [
        # The section sign is escaped so this file does not carry the form it names.
        "The lanes follow architecture \u00a798.",
        'The framing follows protocol.md "No such heading".',
        'The refusal body follows docs/fixture-doc.md "Error envelope".',
    ],
)
def test_a_retired_citation_form_in_a_design_doc_is_not_a_problem(tmp_path: Path, line: str) -> None:
    """Beside one missing path, a section-number or quoted-heading citation adds no problem of its own."""
    doc = _design_doc(tmp_path, f"{line} The probe lives in `{MISSING_SCRIPT}`.")
    assert len(GATE.check(doc)) == 1


def test_a_doc_ref_exempt_pragma_does_not_excuse_a_missing_path(tmp_path: Path) -> None:
    """The retired pragma no longer exempts a backticked path that names no file."""
    doc = _design_doc(tmp_path, f"The probe lives in `{MISSING_SCRIPT}`. <!-- doc-ref-exempt: planned -->")
    assert len(GATE.check(doc)) == 1
