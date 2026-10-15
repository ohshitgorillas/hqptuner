"""Under Auto, the plate fills the height the page really has, even when the browser reports less to scripts.

On an iPad launched from the home-screen icon the browser can report a window
height to scripts that is shorter than the box the page lays out in. Under the
Auto Display choice the plate still fills the real space, so no strip of page
color shows below it.

Each case pins Auto in the browser's storage before the app loads, lays the
page out in one window, makes every height the window reports to scripts
(`innerHeight`, `outerHeight`, `visualViewport.height`) read short of that
window, and measures the gap between the plate's bottom edge and the page's own
box.

Policy notes:

- Geometry exists only in a real layout engine, so this is the browser lane.
- The short report is the wire: it is the browser's own API that misreports,
  so the init script overrides those getters and nothing of the app.
- The real space is the page's own box (`document.documentElement`'s client
  height), the box the page lays out in, which the override does not touch.
- Waits are bounded condition-polls: the plate shown, fonts loaded and every
  finite animation settled.
"""

from typing import NamedTuple

import pytest
from playwright.sync_api import Page, ViewportSize

from e2e.support import fit
from e2e.support import stack as stack_support

#: The plate element.
PLATE = ".plate"


class Case(NamedTuple):
    """A window the page lays out in, and how many CSS px short of its height the browser reports it."""

    window: ViewportSize
    shortfall: int


#: The owner's iPad Air 13" in landscape, at Expanded's size, reporting a status bar's height short;
#: and a window between the formats reporting a smaller shortfall.
CASES = {
    "ipad-air-13-landscape": Case(ViewportSize(width=1366, height=1024), 24),
    "between-the-formats": Case(ViewportSize(width=1250, height=900), 12),
}

#: Makes every window height scripts can read report `shortfall` px less than the page's real box.
SHORT_REPORT_JS = """
(() => {
  const SHORTFALL = %d;
  const short = (real) => () => real() - SHORTFALL;
  const inner = Object.getOwnPropertyDescriptor(window, "innerHeight").get.bind(window);
  const outer = Object.getOwnPropertyDescriptor(window, "outerHeight").get.bind(window);
  Object.defineProperty(window, "innerHeight", { get: short(inner), configurable: true });
  Object.defineProperty(window, "outerHeight", { get: short(outer), configurable: true });
  if (window.visualViewport) {
    const proto = Object.getPrototypeOf(window.visualViewport);
    const vv = Object.getOwnPropertyDescriptor(proto, "height").get;
    Object.defineProperty(proto, "height", { get() { return vv.call(this) - SHORTFALL; }, configurable: true });
  }
})();
"""

#: Shows the plate, settles, then returns the page-colored gap below the plate, in CSS px.
GAP_BELOW_JS = "async ({ plate, ceiling }) => {" + fit.PRELUDE_JS + """
  await until(() => {
    const el = document.querySelector(plate);
    return el !== null && el.getClientRects().length > 0;
  }, ceiling, "the plate to show");
  await settle(ceiling);
  window.scrollTo(0, 0);
  await frame();
  return document.documentElement.clientHeight - document.querySelector(plate).getBoundingClientRect().bottom;
}
"""


def gap_below_plate(page: Page, stack: stack_support.Stack, case: Case) -> float:
    """Pin Auto, lay the page out in `case`'s window with the short report, and measure the gap below the plate."""
    page.set_viewport_size(case.window)
    page.add_init_script(SHORT_REPORT_JS % case.shortfall)
    page.add_init_script(f'try {{ window.localStorage.setItem("{fit.DISPLAY_KEY}", "{fit.AUTO}"); }} catch (e) {{}}')
    page.goto(f"{stack.base_url}/")
    gap: float = page.evaluate(GAP_BELOW_JS, {"plate": PLATE, "ceiling": fit.SETTLE_TIMEOUT})
    return gap


@pytest.mark.parametrize("case", sorted(CASES))
def test_under_auto_the_plate_reaches_the_bottom_of_the_real_window_when_scripts_are_told_less(
    page: Page, stack: stack_support.Stack, case: str
) -> None:
    """The plate's bottom edge meets the page's, leaving no strip of page color below it."""
    assert abs(gap_below_plate(page, stack, CASES[case])) <= fit.ROUNDING
