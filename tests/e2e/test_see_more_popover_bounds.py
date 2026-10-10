"""The `… see more` note popover on a drawer row stays inside the drawer.

A drawer row whose description holds part of its paragraph back ends that
description with a `see more` trigger, and the trigger opens the rest in a note
popover (docs/faceplate-spec.md, Output drawer; the DAC bits rows carry one).
What is pinned here is where that popover lands: wholly inside the open
drawer's box, on every edge.

The plates are the spec's design size, 1080x810 (10.2"), and the iPad Mini at
full screen in landscape, 1133x744 points, the smallest screen the README and
changelog promise to fit.

Policy notes (docs/testing.md):

- One assertion per test, one case per plate. The helper returns each drawer
  edge the popover runs past and by how much, or None when there is no popover
  to measure, and the test judges that.
- Layout geometry only exists in a real browser, so this is the browser lane.
- Controls are found by machine identity: the rail stage's `data-stage`, the
  tab's `data-tab`, the trigger's `data-testid`, the popover's `role`. The drawer
  is the one `aside` not carrying `data-closed`.
- No fixed sleep. Locators wait for what they act on, and the measurement waits
  on the drawer's own finite animations finishing, a condition, not a duration.
"""

import pytest
from playwright.sync_api import Page

from e2e.support import stack as stack_support

#: The rail stage whose drawer holds the DAC bits rows.
OUTPUT_STAGE = "output"

#: The Output drawer tab the DAC bits rows sit on.
FORMAT_TAB = "format"

#: Layout snaps edges to device pixels, so a box can read up to half a pixel
#: past an edge it actually sits on. The defect this file guards is whole pixels.
SUBPIXEL = 0.5

#: Viewport sizes, CSS pixels in landscape, keyed by the plate they lay out.
PLATES = {
    "ipad_10_2": (1080, 810),
    "ipad_mini": (1133, 744),
}

#: Ceiling on the open drawer and popover settling. A ceiling on a condition,
#: never a duration anything is expected to take.
SETTLE_TIMEOUT = 10_000

#: Waits out every finite animation and transition on the open drawer and
#: everything inside it, then answers each drawer edge the open popover crosses
#: with how far past it the popover runs, in CSS pixels, or null when there is no
#: open drawer or no single visible popover in it.
CROSSED_JS = """
async ({ slack }) => {
  const drawer = document.querySelector("aside:not([data-closed])");
  if (!drawer) return null;
  const finite = (a) => a.effect && a.effect.getTiming().iterations !== Infinity;
  await Promise.all(drawer.getAnimations({ subtree: true }).filter(finite).map((a) => a.finished));
  const pops = [...drawer.querySelectorAll('[role="dialog"]')].filter((el) => el.getClientRects().length > 0);
  if (pops.length !== 1) return null;
  const d = drawer.getBoundingClientRect();
  const p = pops[0].getBoundingClientRect();
  const past = { left: d.left - p.left, right: p.right - d.right, top: d.top - p.top, bottom: p.bottom - d.bottom };
  return Object.fromEntries(Object.entries(past).filter(([, px]) => px > slack));
}
"""


def _crossed_edges(page: Page, base_url: str, viewport: tuple[int, int]) -> dict[str, float] | None:
    """Open the Output drawer's see-more popover at `viewport`; return each drawer edge it runs past, and by how far."""
    width, height = viewport
    page.set_viewport_size({"width": width, "height": height})
    page.goto(base_url)
    page.locator(f'button[data-stage="{OUTPUT_STAGE}"]').click(timeout=SETTLE_TIMEOUT)
    drawer = page.locator("aside:not([data-closed])")
    drawer.locator(f'[role="tab"][data-tab="{FORMAT_TAB}"]').click(timeout=SETTLE_TIMEOUT)
    drawer.locator('[data-testid="see-more"]:visible').first.click(timeout=SETTLE_TIMEOUT)
    drawer.locator('[role="dialog"]:visible').first.wait_for(timeout=SETTLE_TIMEOUT)
    result = page.evaluate(CROSSED_JS, {"slack": SUBPIXEL})
    return None if result is None else {str(edge): float(px) for edge, px in result.items()}


@pytest.mark.parametrize("plate", sorted(PLATES))
def test_the_see_more_popover_stays_inside_the_drawer(page: Page, stack: stack_support.Stack, plate: str) -> None:
    """The note popover a row's see-more opens runs past no edge of the open drawer."""
    assert _crossed_edges(page, stack.base_url, PLATES[plate]) == {}
