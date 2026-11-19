"""The gate that keeps the card frame off the faceplate.

``scripts/gates/css/check_css_cards.py`` reads one stylesheet and reports a
selector naming a card or pack class, and a rule painting the plate's fill with
a corner radius.

The seam is ``check_file(path) -> list[str]``; the observable contract is the
list of complaint lines it hands back. Every selector below is invented here
except the class names the gate exists to refuse.
"""

from pathlib import Path

import pytest
from gate_scripts import load_gate, write_sheet

#: The gate script under test, found relative to this file rather than through
#: an import: it lives in ``scripts/gates/css/``, outside any package.
GATE_PATH = Path(__file__).resolve().parents[3] / "scripts" / "gates" / "css" / "check_css_cards.py"


GATE = load_gate(GATE_PATH, "check_css_cards_under_test")


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
    assert len(GATE.check_file(write_sheet(tmp_path, "styles", css))) == complaints


#: The refused class names, one declaration to a line.
SPREAD_CLASSES = ".card {\n  padding: 0;\n}\n.pack {\n  display: grid;\n}\n"


def test_refused_class_names_spread_over_lines_are_each_a_complaint(tmp_path: Path) -> None:
    """A rule laid out over several lines is read the same as one written on one line."""
    assert len(GATE.check_file(write_sheet(tmp_path, "styles", SPREAD_CLASSES))) == 2
