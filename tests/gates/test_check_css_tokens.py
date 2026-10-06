"""The gate that holds a stylesheet to its tokens (``docs/design-system.md``).

``scripts/gates/css/check_css_tokens.py`` reads one stylesheet and reports
every declaration off the faceplate rules.

The seam is ``check_file(path) -> list[str]``; the observable contract is the
list of complaint lines it hands back, each opening ``<path>:<line>:``. Every
selector, property value and token name below is invented here.
"""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/css/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "css" / "check_css_tokens.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_css_tokens_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()


#: The directory a stylesheet under test is written to.
FACEPLATE_DIR = "styles"


def sheet(tmp_path: Path, directory: str, css: str) -> Path:
    """Write ``css`` to ``region.css`` under ``directory``, relative to the test's root."""
    path = tmp_path / directory / "region.css"
    path.parent.mkdir(parents=True)
    path.write_text(css, encoding="utf-8")
    return path


@pytest.mark.parametrize(
    ("css", "complaints"),
    [
        (".a{color:var(--ink);border:1px solid var(--shade)}", 0),
        (".a{color:#fff;border:1px solid #000}", 2),
        (".a{color:var(--ink)}\n.b{fill:#1d2025}.c{stroke:rgb(1, 2, 3)}", 2),
        ("@media (max-width:1300px){.a{color:#123456}}", 1),
        ("/* once #fff */\n.a{color:var(--ink)}", 0),
        (".a{--local:#0a0c0f}", 1),
        ("button:focus-visible,\ninput:hover{outline:2px solid var(--acc)}", 0),
        (".a{line-height:var(--lh-text)}.b{line-height:1.1}", 0),
        (".a{line-height:normal}", 1),
        (".a{font-family:var(--f-mono)}.b{font-family:inherit}", 0),
        (".a{font-family:Arial,sans-serif}", 1),
        (".a{transition:none}.b{transition:opacity var(--fade)}", 0),
        (".a{transition:opacity .12s ease-out}", 1),
        (".a{animation:alarm var(--blink)}", 0),
        (".a{animation:alarm 1s step-end infinite}.b{animation-duration:250ms}", 2),
        (".a {\n  font-size: 13px;\n  padding: 4px 10px;\n  border-radius: 3px;\n}\n", 0),
    ],
)
def test_a_faceplate_stylesheet_is_held_to_colour_line_height_family_and_motion_tokens(
    tmp_path: Path, css: str, complaints: int
) -> None:
    """Each declaration off a faceplate rule is one complaint, wherever it sits on its line."""
    assert len(GATE.check_file(sheet(tmp_path, FACEPLATE_DIR, css))) == complaints


@pytest.mark.parametrize(
    ("css", "line"),
    [
        (".a{color:#fff}", 1),
        (".a{color:var(--ink)}\n\n.b{\n  color:var(--ink);fill:#fff}", 4),
    ],
)
def test_a_complaint_opens_with_the_line_its_declaration_starts_on(tmp_path: Path, css: str, line: int) -> None:
    """The reported line is the declaration's own, not its rule's."""
    path = sheet(tmp_path, FACEPLATE_DIR, css)
    assert [problem.startswith(f"{path}:{line}:") for problem in GATE.check_file(path)] == [True]
