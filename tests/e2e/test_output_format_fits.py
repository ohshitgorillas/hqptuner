"""The Output drawer's Format tab shows every row without scrolling, at every plate format.

With one backend selected, the Format tab of the Output drawer fits: every one
of its rows is in view as the tab opens and the tab does not scroll, at each of
the three plate formats the design system names (Expanded 1366x1024, Normal
1180x820, Compact 1133x744).

Each case lays the plate out for a window exactly the size of one format, so
the window picks that format at a scale of 1, opens the Output drawer on its
Format tab and measures how much of the tab's content lies beyond the box it is
seen through.

Policy notes:

- Geometry exists only in a real layout engine, so this is the browser lane.
- One backend is the HTTP fake's own: its config page selects a single backend,
  never Combo.
- Controls are found by wire identity: the rail stage (`data-stage`), the
  drawer id, the tab id (`data-tab`), and the dial hook the rendered suites
  already address.
- The box the tab is seen through is the tab's own panel, every ancestor that
  clips or scrolls it, and the page. Content beyond any of them is either
  waiting behind a scroll or cut off, and either way a row is not shown whole.
  A browser counts that content whether the box scrolls or clips, so a tab that
  stops scrolling by hiding its overflow still fails.
- Waits are bounded condition-polls: fonts loaded, the drawer's wipe and every
  other finite animation settled.
"""

import pytest
from playwright.sync_api import Page, ViewportSize

from e2e.support import stack as stack_support

#: The three plate formats, tablet landscape in CSS px.
FORMATS = {
    "expanded": ViewportSize(width=1366, height=1024),
    "normal": ViewportSize(width=1180, height=820),
    "compact": ViewportSize(width=1133, height=744),
}

#: The Output drawer's rail stage.
OUTPUT_STAGE = "output"

#: The Format tab's id.
FORMAT_TAB = "format"

#: Content height, in CSS px, a box that shows all of its content holds beyond its own visible height.
NONE_HIDDEN = 0

#: Ceiling on the page settling: fonts loaded, the drawer's wipe done.
SETTLE_TIMEOUT = 10_000

#: True once the real fonts are in and every animation that ends has ended.
SETTLED_JS = """
() => document.fonts.status === "loaded" &&
  document.getAnimations().every(
    (a) => a.effect === null || a.effect.getComputedTiming().iterations === Infinity || a.playState !== "running",
  )
"""

#: The most content height, in CSS px, any box the Format panel is seen through
#: holds beyond its own visible height: the panel, each ancestor that clips or
#: scrolls, and the page.
HIDDEN_JS = """
() => {
  const panel = document.querySelector('#drawer-output .dpanel[data-tab="format"]');
  const boxes = [panel, document.scrollingElement];
  for (let up = panel.parentElement; up !== null; up = up.parentElement) {
    if (getComputedStyle(up).overflowY !== "visible") boxes.push(up);
  }
  return Math.max(...boxes.map((box) => box.scrollHeight - box.clientHeight));
}
"""


def _hidden(page: Page, stack: stack_support.Stack, size: ViewportSize) -> int:
    """Lay the plate out for a window of `size`, open the Output drawer's Format tab, return its hidden height."""
    page.set_viewport_size(size)
    page.goto(f"{stack.base_url}/")
    page.locator(f'button[data-stage="{OUTPUT_STAGE}"]').click()
    drawer = page.locator(f"#drawer-{OUTPUT_STAGE}")
    drawer.locator(f'[role="tab"][data-tab="{FORMAT_TAB}"]').click()
    drawer.locator(f'.dpanel[data-tab="{FORMAT_TAB}"] .dial[role="group"]').wait_for(state="visible")
    page.wait_for_function(SETTLED_JS, timeout=SETTLE_TIMEOUT)
    return int(page.evaluate(HIDDEN_JS))


@pytest.mark.parametrize("plate", sorted(FORMATS))
def test_the_format_tab_shows_every_row_without_scrolling(page: Page, stack: stack_support.Stack, plate: str) -> None:
    """No box the Format tab is seen through holds content beyond its visible height, so nothing scrolls or is cut."""
    assert _hidden(page, stack, FORMATS[plate]) == NONE_HIDDEN
