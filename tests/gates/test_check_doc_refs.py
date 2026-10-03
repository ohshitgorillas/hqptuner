"""The gate that verifies a design-doc citation resolves (``docs/testing.md``).

``scripts/gates/check_doc_refs.py`` reports every quoted or positional
citation problem in a file, and a file it cannot read is itself one problem
naming the path.

The seam is ``check(path, docs) -> list[str]``; the observable contract is the
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
    assert [ghost.name in line for line in GATE.check(ghost, {})] == [True]


#: The numbered doc the section-number tests cite into.
SECTION_DOCS = {"architecture": ["2. engine interfaces", "2.1 control api lane", "2.4 credentials"]}


@pytest.mark.parametrize(
    ("line", "problems"),
    [
        # The section sign is escaped so this file does not cite the docs it names.
        ("# lanes restart the daemon (docs/architecture.md \u00a72)", 0),
        ("# the unauthenticated lane (architecture \u00a72.1)", 0),
        ("# credentials follow `docs/architecture.md` \u00a72.4", 0),
        ("# credentials follow `docs/architecture.md` \u00a72.2", 1),
        ("# see architecture \u00a798 for the graying rules", 1),
        ("# the stock pair (architecture \u00a72.4, architecture \u00a73)", 1),
        ("# the modulator floor (manual \u00a77.2)", 0),
    ],
)
def test_a_section_number_counts_as_a_problem_only_when_the_doc_has_no_such_section(
    tmp_path: Path, line: str, problems: int
) -> None:
    """A ``§N`` citation of a numbered doc must name a heading there; vendor manual numbers are never checked."""
    source = tmp_path / "source.py"
    source.write_text(line + "\n", encoding="utf-8")
    assert len(GATE.check(source, SECTION_DOCS)) == problems


#: A numbered doc under a name no real doc carries, so the gate skips these lines here.
QUOTED_DOCS = {"fixture-doc.md": ["8.1 api errors", "8.2 lane reports"]}


@pytest.mark.parametrize(
    ("line", "problems"),
    [
        ('# the refusal body (docs/fixture-doc.md "API errors")', 0),
        ('# the refusal body (docs/fixture-doc.md "8.1 API errors")', 0),
        ('# the refusal body (docs/fixture-doc.md "Error envelope")', 1),
    ],
)
def test_a_quoted_heading_resolves_with_or_without_its_section_number(tmp_path: Path, line: str, problems: int) -> None:
    """A numbered heading is cited by its text alone as well as with its number."""
    source = tmp_path / "source.py"
    source.write_text(line + "\n", encoding="utf-8")
    assert len(GATE.check(source, QUOTED_DOCS)) == problems
