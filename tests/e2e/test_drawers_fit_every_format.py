"""Every drawer the rail opens fits on every one of its tabs, at every plate format.

No drawer develops a scroll bar and none cuts content off past its box, on any
of its tabs, at each of the three plate formats the design system names
(Expanded 1366x1024, Normal 1180x820, Compact 1133x744). Two boxes are the
user's own and may scroll: a matrix profile's description and the engine log
tail.

Each case lays the plate out for a window exactly the size of one format, so
the window picks that format at a scale of 1, then walks the rail: it opens
each stage's drawer in turn, shows each of that drawer's tabs, and measures
how much content lies beyond the box it is seen through (`e2e.support.fit`).

Policy notes:

- Geometry exists only in a real layout engine, so this is the browser lane.
- The rail is the enumeration authority for which drawers exist and each
  drawer's tab strip for which tabs it has, the way the running engine is for
  names: the walk opens what the plate offers rather than a list written here.
  A failure names every drawer and tab that hides content at that format, as
  `<data-stage>/<data-tab>`, with the box and the hidden length.
- Controls are found by machine identity: the rail stage (`data-stage`), the
  open drawer (the one `aside.drawer` not carrying `data-closed`), its close
  key (`data-testid`), its tabs (`role` and `data-tab`), and the two exempt
  boxes (`data-testid`).
- The surface measured is the open drawer.
- Waits are bounded condition-polls: fonts loaded, the drawer opened or closed,
  its wipe and every other finite animation settled.
"""

import pytest
from playwright.sync_api import Page, ViewportSize

from e2e.support import fit
from e2e.support import stack as stack_support

#: The stage of every rail button the plate shows, in rail order.
STAGES_JS = """
() => [...document.querySelectorAll("button[data-stage]")]
  .filter((b) => b.getClientRects().length > 0)
  .map((b) => b.dataset.stage)
"""

#: The open drawer.
OPEN = 'const OPEN = "aside.drawer:not([data-closed])";'

#: Closes any open drawer, opens `stage`'s, settles it, and returns the `data-tab`
#: of each tab its strip shows (an empty list for a drawer with one part).
OPEN_JS = "async ({ stage, ceiling }) => {" + fit.PRELUDE_JS + OPEN + """
  const open = document.querySelector(OPEN);
  if (open !== null) {
    open.querySelector('[data-testid="drawer-close"]').click();
    await until(() => document.querySelector(OPEN) === null, ceiling, "the open drawer to close");
  }
  document.querySelector(`button[data-stage="${stage}"]`).click();
  await until(() => document.querySelector(OPEN) !== null, ceiling, `the ${stage} drawer to open`);
  await settle(ceiling);
  const drawer = document.querySelector(OPEN);
  return [...drawer.querySelectorAll('[role="tab"]')]
    .filter((t) => t.getClientRects().length > 0)
    .map((t, i) => t.dataset.tab ?? String(i));
}
"""

#: Shows `tab` on the open drawer (none for a drawer with one part), settles,
#: and returns each box the drawer's content runs more than `rounding` px past,
#: worst first, as "<box> <axis> <px>".
MEASURE_JS = "async ({ tab, skip, rounding, ceiling }) => {" + fit.PRELUDE_JS + OPEN + """
  const drawer = document.querySelector(OPEN);
  if (tab !== null) {
    const tabs = [...drawer.querySelectorAll('[role="tab"]')].filter((t) => t.getClientRects().length > 0);
    const pick = tabs.find((t, i) => (t.dataset.tab ?? String(i)) === tab);
    pick.click();
    await settle(ceiling);
  }
  return hiddenPast(drawer, skip, "the drawer", rounding);
}
"""


class _NothingWalkedError(RuntimeError):
    """The rail offered no stage to open, so the walk measured no drawer."""

    def __init__(self) -> None:
        super().__init__("the rail showed no stage button, so no drawer was measured")


def _hidden_by_tab(page: Page, stack: stack_support.Stack, size: ViewportSize) -> dict[str, list[str]]:
    """Lay the plate out for a window of `size`, walk every drawer tab, return each that hides content and what."""
    fit.load_plate(page, stack, size)
    stages = [str(stage) for stage in page.evaluate(STAGES_JS)]
    if not stages:
        raise _NothingWalkedError
    found: dict[str, list[str]] = {}
    for stage in stages:
        tabs = page.evaluate(OPEN_JS, {"stage": stage, "ceiling": fit.SETTLE_TIMEOUT})
        for tab in tabs or [None]:
            args = {
                "tab": tab,
                "skip": fit.EXEMPT,
                "rounding": fit.ROUNDING,
                "ceiling": fit.SETTLE_TIMEOUT,
            }
            lines = [str(line) for line in page.evaluate(MEASURE_JS, args)]
            if lines:
                found[f"{stage}/{tab or '-'}"] = lines
    return found


@pytest.mark.parametrize("plate", sorted(fit.FORMATS))
def test_no_drawer_tab_scrolls_or_cuts_off_content(page: Page, stack: stack_support.Stack, plate: str) -> None:
    """At this format, no tab of any drawer the rail opens hides content."""
    assert _hidden_by_tab(page, stack, fit.FORMATS[plate]) == {}
