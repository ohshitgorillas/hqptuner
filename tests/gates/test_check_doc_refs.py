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

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "check_doc_refs.py"


class FixtureError(Exception):
    """A test's own scaffolding is wrong — not a failure of the behavior under test."""

    def __init__(self, *, reason: str) -> None:
        super().__init__(reason)


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
    lines = GATE.check(ghost, {})
    assert (lines != [], [line for line in lines if ghost.name not in line]) == (True, [])
