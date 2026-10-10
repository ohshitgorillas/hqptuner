"""How the Output drawer's Format tab fills the larger plates.

The plate is laid out at the largest iPad size the window holds: 1080x810 (10.2",
the design size), 1180x820 (11") and 1366x1024 (13"), `docs/faceplate-spec.md`.
On the 11" and 13" plates the drawer is wider and taller than at the design size,
and the Format tab is to use that room: the rate dial's glass grows with the
drawer's width, its text and its tap cells grow with it, no empty band opens up
between the form's rows, and what height is left over sits at the bottom of the
panel.

Each test lays the plate out at a larger size, opens the Output drawer on its
Format tab and measures it; most also lay it out at the design size and compare.
Every expected value is a relation between observations, never a pixel count of
the current design.

Policy notes (docs/testing.md):

- Geometry exists only in a real layout engine, so this is the browser lane.
  Server rendering lays nothing out.
- One assertion per test; the helper returns measurements and the test judges.
- Controls are found by wire identity: the rail stage (`data-stage`), the drawer
  id, the tab id (`data-tab`), the dial's band (`data-band`) and tier position
  (`data-i`), and the row and dial hooks the rendered suites already address.
- What a row occupies is its ink: the union of the boxes of what it draws, so a
  wrapper stretched past its drawing reads as empty space, the way it looks.
- Waits are bounded condition-polls: fonts loaded, the drawer's wipe and every
  other finite animation settled. Nothing sleeps.
- Not pinned here: that the iPad Mini plate's glass keeps today's size. No doc
  states that size, so the only source of an expected value is the current code.
"""

from dataclasses import dataclass

import pytest
from playwright.sync_api import Page, ViewportSize

from e2e.support import stack as stack_support

#: The design size, the iPad Mini plate (10.2").
DESIGN = ViewportSize(width=1080, height=810)

#: The two larger plates, by the size id the plate carries.
LARGER = {
    "11": ViewportSize(width=1180, height=820),
    "13": ViewportSize(width=1366, height=1024),
}

#: The Output drawer's rail stage.
OUTPUT_STAGE = "output"

#: The Format tab's id.
FORMAT_TAB = "format"

#: The dial's PCM band and its first tier, present on every device.
BAND = "pcm"
FIRST_TIER = "0"

#: Rounding allowed on any one measured edge or size, in CSS px.
ROUNDING = 1.0

#: Ceiling on the page settling: fonts loaded, the drawer's wipe done.
SETTLE_TIMEOUT = 10_000

#: True once the real fonts are in and every animation that ends has ended.
SETTLED_JS = """
() => document.fonts.status === "loaded" &&
  document.getAnimations().every(
    (a) => a.effect === null || a.effect.getComputedTiming().iterations === Infinity || a.playState !== "running",
  )
"""

#: Reads the Format panel's geometry. A row's ink is the union of the boxes of
#: its drawn leaves; rows a backend hides draw nothing and drop out.
MEASURE_JS = """
({ band, tier }) => {
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
  const text = dial.querySelector("text");
  const cell = dial.querySelector(`g[data-band="${band}"] g[data-i="${tier}"]`);
  return {
    drawer: drawer.getBoundingClientRect().width,
    glass: glass === null ? 0 : glass.right - glass.left,
    text: text === null ? 0 : text.getBoundingClientRect().height,
    cell: cell === null ? 0 : cell.getBoundingClientRect().width,
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
    text: float
    cell: float
    widest_gap: float
    narrowest_gap: float
    empty: float
    below: float


def _format(page: Page, stack: stack_support.Stack, size: ViewportSize) -> Format:
    """Lay the plate out for a window of `size`, open the Output drawer's Format tab and measure it."""
    page.set_viewport_size(size)
    page.goto(f"{stack.base_url}/")
    page.locator(f'button[data-stage="{OUTPUT_STAGE}"]').click()
    drawer = page.locator(f"#drawer-{OUTPUT_STAGE}")
    drawer.locator(f'[role="tab"][data-tab="{FORMAT_TAB}"]').click()
    drawer.locator(f'.dpanel[data-tab="{FORMAT_TAB}"] .dial[role="group"]').wait_for(state="visible")
    page.wait_for_function(SETTLED_JS, timeout=SETTLE_TIMEOUT)
    found = page.evaluate(MEASURE_JS, {"band": BAND, "tier": FIRST_TIER})
    return Format(**{key: float(value) for key, value in found.items()})


@pytest.mark.parametrize("plate", sorted(LARGER))
def test_the_rate_dials_glass_widens_with_the_drawer_on_a_larger_plate(
    page: Page, stack: stack_support.Stack, plate: str
) -> None:
    """The glass widens at least in proportion to the drawer: a wider drawer is a wider glass, not a wider margin."""
    design = _format(page, stack, DESIGN)
    larger = _format(page, stack, LARGER[plate])
    assert larger.glass / design.glass >= larger.drawer / design.drawer - ROUNDING / design.glass


@pytest.mark.parametrize("plate", sorted(LARGER))
def test_the_rate_dials_text_grows_with_the_drawer_on_a_larger_plate(
    page: Page, stack: stack_support.Stack, plate: str
) -> None:
    """The dial's lettering grows at least in proportion to the drawer, as the glass it is drawn on does."""
    design = _format(page, stack, DESIGN)
    larger = _format(page, stack, LARGER[plate])
    assert larger.text / design.text >= larger.drawer / design.drawer - ROUNDING / design.text


@pytest.mark.parametrize("plate", sorted(LARGER))
def test_the_rate_dials_tap_cells_grow_with_the_drawer_on_a_larger_plate(
    page: Page, stack: stack_support.Stack, plate: str
) -> None:
    """A tier's tap cell widens at least in proportion to the drawer, as the glass it sits on does."""
    design = _format(page, stack, DESIGN)
    larger = _format(page, stack, LARGER[plate])
    assert larger.cell / design.cell >= larger.drawer / design.drawer - ROUNDING / design.cell


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
    design = _format(page, stack, DESIGN)
    larger = _format(page, stack, LARGER[plate])
    assert larger.below - design.below >= larger.empty - design.empty - ROUNDING
