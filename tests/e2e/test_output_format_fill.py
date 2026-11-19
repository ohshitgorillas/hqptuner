"""How the Output drawer's Format tab fills the larger plates.

The plate is laid out at the largest format the window holds: Compact 1133x744
(the smallest), Normal 1180x820 and Expanded 1366x1024.
On the Normal and Expanded plates the drawer is wider and taller than on Compact,
and the Format tab is to use that room: the rate dial's glass grows with the
drawer's width, its text and its tap cells grow with it, no empty band opens up
between the form's rows, and what height is left over sits at the bottom of the
panel.

Each test lays the plate out at a larger size, opens the Output drawer on its
Format tab and measures it; most also lay it out at Compact and compare.
Every expected value is a relation between observations, never a pixel count of
the current design.

Policy notes:

- Geometry exists only in a real layout engine, so this is the browser lane.
  Server rendering lays nothing out.
- Controls are found by wire identity: the rail stage (`data-stage`), the drawer
  id, the tab id (`data-tab`), the dial's band (`data-band`) and tier position
  (`data-i`), and the row and dial hooks the rendered suites already address.
- What a row occupies is its ink: the union of the boxes of what it draws, so a
  wrapper stretched past its drawing reads as empty space, the way it looks.
- Waits are bounded condition-polls: fonts loaded, the drawer's wipe and every
  other finite animation settled.
- Not pinned here: that the Compact plate's glass keeps today's size. No doc
  states that size, so the only source of an expected value is the current code.
"""

from dataclasses import dataclass

import pytest
from playwright.sync_api import Page, ViewportSize

from e2e.support import fit
from e2e.support import stack as stack_support

#: The Compact plate, the smallest, laid out at scale 1.
COMPACT = ViewportSize(width=1133, height=744)

#: The two larger plates, by the format id the plate carries (`data-size`).
LARGER = {
    "normal": ViewportSize(width=1180, height=820),
    "expanded": ViewportSize(width=1366, height=1024),
}

#: Rounding allowed on any one measured edge or size, in CSS px.
ROUNDING = 1.0

#: Reads the Format panel's geometry. A row's ink is the union of the boxes of
#: its drawn leaves; rows a backend hides draw nothing and drop out.
MEASURE_JS = """
() => {
  const drawer = document.getElementById("drawer-output");
  const panel = drawer.querySelector('.dpanel[data-tab="format"]');
  const dial = panel.querySelector('.dial[role="group"]');
  const ink = (el) => {
    const leaves = [el, ...el.querySelectorAll("*")].filter((e) => e.children.length === 0);
    const boxes = leaves.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    if (boxes.length === 0) return null;
    return {
      left: Math.min(...boxes.map((r) => r.left)),
      right: Math.max(...boxes.map((r) => r.right)),
      top: Math.min(...boxes.map((r) => r.top)),
      bottom: Math.max(...boxes.map((r) => r.bottom)),
    };
  };
  const items = [...panel.querySelectorAll(".drow, .dial")];
  const outer = items.filter((el) => !items.some((other) => other !== el && other.contains(el)));
  const rows = outer.map(ink).filter((box) => box !== null).sort((a, b) => a.top - b.top);
  const gaps = [];
  let reach = rows[0].bottom;
  for (const box of rows.slice(1)) {
    gaps.push(Math.max(0, box.top - reach));
    reach = Math.max(reach, box.bottom);
  }
  const box = panel.getBoundingClientRect();
  const drawn = rows.reduce((sum, row) => sum + (row.bottom - row.top), 0);
  const glass = ink(dial);
  return {
    drawer: drawer.getBoundingClientRect().width,
    glass: glass === null ? 0 : glass.right - glass.left,
    widest_gap: Math.max(...gaps),
    narrowest_gap: Math.min(...gaps),
    empty: box.height - drawn,
    below: box.bottom - reach,
  };
}
"""


@dataclass(frozen=True)
class Format:
    """The Format panel's geometry on one plate, in CSS px.

    `widest_gap` and `narrowest_gap` are the widest and narrowest empty space
    between two consecutive rows; `empty` is the panel's height less every row's
    ink; `below` is the space between the last row's ink and the panel's foot.
    """

    drawer: float
    glass: float
    widest_gap: float
    narrowest_gap: float
    empty: float
    below: float


def _format(page: Page, stack: stack_support.Stack, size: ViewportSize) -> Format:
    """Lay the plate out for a window of `size`, open the Output drawer's Format tab and measure it."""
    fit.open_format_tab(page, stack, size)
    found = page.evaluate(MEASURE_JS)
    return Format(**{key: float(value) for key, value in found.items()})


@pytest.mark.parametrize("plate", sorted(LARGER))
def test_the_rate_dials_glass_widens_with_the_drawer_on_a_larger_plate(
    page: Page, stack: stack_support.Stack, plate: str
) -> None:
    """The glass widens at least in proportion to the drawer: a wider drawer is a wider glass, not a wider margin."""
    compact = _format(page, stack, COMPACT)
    larger = _format(page, stack, LARGER[plate])
    assert larger.glass / compact.glass >= larger.drawer / compact.drawer - ROUNDING / compact.glass


@pytest.mark.parametrize("plate", sorted(LARGER))
def test_no_empty_band_opens_between_the_format_forms_rows_on_a_larger_plate(
    page: Page, stack: stack_support.Stack, plate: str
) -> None:
    """Under the rate dial's row as anywhere in the form, the space between two rows is the form's ordinary spacing."""
    larger = _format(page, stack, LARGER[plate])
    assert larger.widest_gap <= larger.narrowest_gap + ROUNDING


@pytest.mark.parametrize("plate", sorted(LARGER))
def test_the_larger_plates_spare_height_falls_below_the_format_forms_last_row(
    page: Page, stack: stack_support.Stack, plate: str
) -> None:
    """Every pixel of empty height the larger plate adds to the panel lies under the last row, none above or between."""
    compact = _format(page, stack, COMPACT)
    larger = _format(page, stack, LARGER[plate])
    assert larger.below - compact.below >= larger.empty - compact.empty - ROUNDING
