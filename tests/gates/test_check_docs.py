"""The gate that keeps the docs tree short-lined and indexed.

``scripts/gates/check_docs.py`` refuses three things: a logical line longer
than its limit in a Markdown file under ``docs/spec/`` or ``docs/parked/``; a
``.md`` file anywhere under ``docs/`` that the index ``docs/README.md`` does
not name; and an index entry that names a doc but gives no subject for it. It
has no pragma or comment escape, and a tree that breaks none of these passes.

These cases build a throwaway repository root and hand it to the gate. The
seam is ``main([root]) -> int`` and the module's ``LIMIT``; the observable
contract is the exit status and which files land on stdout.
"""

import importlib.util
from collections.abc import Callable
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_docs.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_docs_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()

#: The longest logical line a design doc may carry, as the gate itself states it.
LIMIT: int = GATE.LIMIT

#: Docs the clean tree carries, relative to ``docs/``, each named by the index.
CLEAN_DOCS = [
    "spec/alpha.md",
    "parked/beta.md",
    "parked/wizard/epsilon.md",
    "research/gamma.md",
    "research/deep/delta.md",
    "internal/zeta.md",
]

#: A file under ``docs/spec/`` that is not Markdown, and that the index never names.
NON_MARKDOWN = "spec/openapi.json"


def _write(path: Path, body: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    return path


def _index_entry(relative: str) -> str:
    """An index line naming ``relative`` and giving it a subject."""
    return f"- [{Path(relative).stem}]({relative}): what {Path(relative).stem} covers.\n"


def _bare_entry(relative: str, tail: str = "") -> str:
    """An index line naming ``relative`` with no subject, ``tail`` appended after the link."""
    return f"- [{Path(relative).stem}]({relative}){tail}\n"


def clean_tree(root: Path) -> Path:
    """A repository root the gate passes: short lines, every doc indexed with a subject.

    The index does not name itself.
    """
    for relative in CLEAN_DOCS:
        _write(root / "docs" / relative, f"# {Path(relative).stem}\n\nA short paragraph.\n")
    _write(root / "docs" / NON_MARKDOWN, "{}\n")
    _write(root / "docs" / "README.md", "# Docs\n\n" + "".join(_index_entry(r) for r in CLEAN_DOCS))
    return root


def add_doc(root: Path, relative: str, body: str, *, entry: str | None = None, indexed: bool = True) -> Path:
    """Write ``body`` at ``docs/<relative>``, indexed by ``entry`` (a subjected one by default) unless told not to."""
    if indexed:
        with (root / "docs" / "README.md").open("a", encoding="utf-8") as index:
            index.write(_index_entry(relative) if entry is None else entry)
    return _write(root / "docs" / relative, body)


def run_gate(capsys: pytest.CaptureFixture[str], root: Path) -> tuple[int, str]:
    """Run the gate over ``root``; return its exit status and stdout."""
    code = GATE.main([str(root)])
    return code, capsys.readouterr().out


def named(out: str, names: list[str]) -> list[str]:
    """The ``names`` that some line of ``out`` mentions, sorted."""
    return sorted(name for name in names if any(name in line for line in out.splitlines()))


def break_by_long_line(root: Path) -> None:
    add_doc(root, "spec/long.md", "x" * (LIMIT + 1) + "\n")


def break_by_unindexed_doc(root: Path) -> None:
    add_doc(root, "spec/orphan.md", "# orphan\n", indexed=False)


def break_by_subjectless_entry(root: Path) -> None:
    add_doc(root, "spec/bare.md", "# bare\n", entry=_bare_entry("spec/bare.md"))


# --- a clean tree -----------------------------------------------------------


@pytest.mark.parametrize("breach", [break_by_long_line, break_by_unindexed_doc, break_by_subjectless_entry])
def test_a_clean_tree_passes_where_the_same_tree_with_one_breach_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], breach: Callable[[Path], None]
) -> None:
    """The clean tree exits 0 and a copy of it carrying one breach does not."""
    clean_code = run_gate(capsys, clean_tree(tmp_path / "clean"))[0]
    broken = clean_tree(tmp_path / "broken")
    breach(broken)
    broken_code = run_gate(capsys, broken)[0]
    assert [code == 0 for code in (clean_code, broken_code)] == [True, False]


# --- line length ------------------------------------------------------------


@pytest.mark.parametrize("relative", ["spec/long.md", "parked/long.md", "parked/wizard/long.md"])
def test_a_line_over_the_limit_in_a_design_doc_fails_the_gate(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], relative: str
) -> None:
    """One character past the limit, under ``docs/spec/`` or ``docs/parked/`` at any depth, fails."""
    root = clean_tree(tmp_path)
    add_doc(root, relative, "x" * (LIMIT + 1) + "\n")
    assert run_gate(capsys, root)[0] != 0


@pytest.mark.parametrize(
    "edge",
    [
        pytest.param("x" * LIMIT, id="one-byte"),
        # Two bytes per character in UTF-8: the limit counts characters, not bytes.
        pytest.param("é" * LIMIT, id="two-byte"),
    ],
)
def test_a_line_of_exactly_the_limit_passes(tmp_path: Path, capsys: pytest.CaptureFixture[str], edge: str) -> None:
    """Beside one line past the limit, a line of exactly the limit adds no problem of its own."""
    root = clean_tree(tmp_path)
    add_doc(root, "spec/edge.md", edge + "\n")
    break_by_long_line(root)
    assert named(run_gate(capsys, root)[1], ["edge.md", "long.md"]) == ["long.md"]


def test_a_table_row_over_the_limit_fails_the_gate(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """A table row is a line like any other."""
    row = "| " + "x" * (LIMIT + 1 - len("|  |")) + " |"
    root = clean_tree(tmp_path)
    add_doc(root, "spec/table.md", "| a |\n| --- |\n" + row + "\n")
    assert run_gate(capsys, root)[0] != 0


@pytest.mark.parametrize("relative", ["research/wide.md", "internal/wide.md", "wide.md"])
def test_a_long_line_outside_the_design_docs_is_not_a_problem(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], relative: str
) -> None:
    """Beside one long design-doc line, a long line elsewhere under ``docs/`` adds no problem of its own."""
    root = clean_tree(tmp_path)
    add_doc(root, relative, "x" * (LIMIT + 1) + "\n")
    break_by_long_line(root)
    assert named(run_gate(capsys, root)[1], ["long.md", "wide.md"]) == ["long.md"]


# --- every doc indexed ------------------------------------------------------


@pytest.mark.parametrize(
    "relative",
    [
        "spec/orphan.md",
        "parked/orphan.md",
        "parked/wizard/orphan.md",
        "research/orphan.md",
        "research/deep/nested/orphan.md",
        "internal/orphan.md",
        "orphan.md",
    ],
)
def test_a_doc_the_index_does_not_name_fails_the_gate(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], relative: str
) -> None:
    """An unindexed ``.md`` anywhere under ``docs/``, at any depth, fails."""
    root = clean_tree(tmp_path)
    add_doc(root, relative, "# orphan\n", indexed=False)
    assert run_gate(capsys, root)[0] != 0


def test_an_indexed_doc_is_not_a_problem(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """Beside one unindexed doc, an indexed doc adds no problem of its own."""
    root = clean_tree(tmp_path)
    add_doc(root, "research/deep/indexed.md", "# indexed\n")
    add_doc(root, "research/deep/orphan.md", "# orphan\n", indexed=False)
    assert named(run_gate(capsys, root)[1], ["indexed.md", "orphan.md"]) == ["orphan.md"]


def test_an_unindexed_non_markdown_file_is_not_a_problem(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """Beside one unindexed doc, an unindexed file that is not ``.md`` adds no problem of its own."""
    root = clean_tree(tmp_path)
    break_by_unindexed_doc(root)
    assert named(run_gate(capsys, root)[1], [Path(NON_MARKDOWN).name, "orphan.md"]) == ["orphan.md"]


# --- every index entry has a subject ----------------------------------------


@pytest.mark.parametrize("relative", ["spec/bare.md", "research/deep/bare.md", "internal/bare.md"])
def test_an_index_entry_with_no_subject_fails_the_gate(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], relative: str
) -> None:
    """An entry that links its doc and says nothing about it fails, wherever the doc lives."""
    root = clean_tree(tmp_path)
    add_doc(root, relative, "# bare\n", entry=_bare_entry(relative))
    assert run_gate(capsys, root)[0] != 0


def test_an_index_entry_with_a_subject_is_not_a_problem(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    """Beside one subjectless entry, an entry that gives its doc a subject adds no problem of its own."""
    root = clean_tree(tmp_path)
    add_doc(root, "spec/told.md", "# told\n")
    break_by_subjectless_entry(root)
    assert named(run_gate(capsys, root)[1], ["bare.md", "told.md"]) == ["bare.md"]


# --- no escape --------------------------------------------------------------

#: Pragma shapes the repository uses elsewhere, spelled for this gate.
PRAGMAS = [
    "<!-- check-docs-exempt -->",
    "<!-- docs-exempt: owner approved -->",
    "<!-- line-length-exempt: owner approved -->",
    "<!-- noqa -->",
]


@pytest.mark.parametrize("pragma", PRAGMAS)
def test_a_pragma_does_not_excuse_a_long_line(tmp_path: Path, capsys: pytest.CaptureFixture[str], pragma: str) -> None:
    """A long line carrying a pragma still fails."""
    root = clean_tree(tmp_path)
    add_doc(root, "spec/long.md", "x" * (LIMIT + 1) + " " + pragma + "\n")
    assert run_gate(capsys, root)[0] != 0


@pytest.mark.parametrize("pragma", PRAGMAS)
def test_a_pragma_does_not_excuse_an_unindexed_doc(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], pragma: str
) -> None:
    """An unindexed doc carrying a pragma still fails."""
    root = clean_tree(tmp_path)
    add_doc(root, "spec/orphan.md", f"# orphan\n\n{pragma}\n", indexed=False)
    assert run_gate(capsys, root)[0] != 0


@pytest.mark.parametrize("pragma", PRAGMAS)
def test_a_pragma_does_not_stand_in_for_a_subject(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], pragma: str
) -> None:
    """An entry whose only text after the link is a pragma comment still has no subject, and fails."""
    root = clean_tree(tmp_path)
    add_doc(root, "spec/bare.md", "# bare\n", entry=_bare_entry("spec/bare.md", " " + pragma))
    assert run_gate(capsys, root)[0] != 0
