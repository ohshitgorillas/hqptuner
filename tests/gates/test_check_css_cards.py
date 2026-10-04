"""The gate that keeps the card frame out of every stylesheet but its own (``docs/design-system.md``).

``scripts/gates/css/check_css_cards.py`` reads one stylesheet. In a v1 concern
directory it reports a rule repainting the card frame under another name.
Everywhere else there is no card at all: it reports a selector naming a card
or pack class, and a rule painting the plate's fill with a corner radius.

The seam is ``check_file(path) -> list[str]``; the observable contract is the
list of complaint lines it hands back. Every selector below is invented here
except the class names the gate exists to refuse.
"""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest
from narrow import FixtureError

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/css/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "gates" / "css" / "check_css_cards.py"


def _load_gate_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_css_cards_under_test", GATE_PATH)
    if spec is None or spec.loader is None:
        raise FixtureError(reason=f"no importable module at {GATE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = _load_gate_module()


def sheet(tmp_path: Path, directory: str, css: str) -> Path:
    """Write ``css`` to ``region.css`` under ``directory``, relative to the test's root."""
    path = tmp_path / directory / "region.css"
    path.parent.mkdir(parents=True)
    path.write_text(css, encoding="utf-8")
    return path


@pytest.mark.parametrize(
    ("css", "complaints"),
    [
        (".card{padding:0}", 1),
        (".drawer .card-head,.drawer .card-body{padding:0}", 1),
        (".row{display:flex}\n.pack{display:grid}.card{padding:0}", 2),
        (".card-grid{display:grid}.packed{display:flex}.scorecard{padding:0}", 0),
        ("@media (max-width:900px){.pack{display:block}}", 1),
        (".panel{background:var(--plate-2);border:1px solid var(--line);border-radius:6px}", 1),
        (".panel{background-color:var(--plate);border-radius:4px 4px 0 0}", 1),
        (".panel{background:var(--plate-2)}.well{border-radius:6px}", 0),
        (".panel{background:var(--plate-2);border-radius:0}", 0),
        (".well{background:var(--glass);border-radius:4px}", 0),
        (".plate{background:var(--plate-face);border-radius:10px}", 0),
    ],
)
def test_a_faceplate_stylesheet_has_no_card_no_pack_and_one_plate(tmp_path: Path, css: str, complaints: int) -> None:
    """A card or pack selector is one complaint, and so is the plate's fill rounded under another name."""
    assert len(GATE.check_file(sheet(tmp_path, "styles", css))) == complaints


#: The v1 frame under another name, and the v1 class names, as a v1 stylesheet writes them.
V1_FRAME = ".tile {\n  background: var(--surface-card);\n  border-radius: var(--r-lg);\n}\n"
V1_CLASSES = ".card {\n  padding: 0;\n}\n.pack {\n  display: grid;\n}\n"


@pytest.mark.parametrize(
    ("directory", "css", "complaints"),
    [
        ("static/css/features", V1_FRAME, 1),
        ("static/css/features", V1_CLASSES, 0),
        ("styles", V1_CLASSES, 2),
    ],
)
def test_a_v1_concern_directory_keeps_its_card_and_is_refused_only_a_second_frame(
    tmp_path: Path, directory: str, css: str, complaints: int
) -> None:
    """The v1 directories own a card; the same class names anywhere else are complaints."""
    assert len(GATE.check_file(sheet(tmp_path, directory, css))) == complaints
