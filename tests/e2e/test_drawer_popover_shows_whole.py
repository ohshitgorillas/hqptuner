"""A note popover opened inside a drawer shows whole: the drawer never cuts it off.

A drawer row whose paragraph waits behind `see more` opens the rest in a note
popover. That popover shows whole while it is open: every corner of it is
visible, cut off by no edge of the drawer. It may lie over part of the Setting
Switcher, the bar along the foot of the plate; it must not be cut off there.

The case driven is the PCM gain compensation row on the Volume drawer's Gain
tab, the last row of that tab and so the one nearest the foot of the plate, on
the Compact plate, where its paragraph waits behind `see more`.

Policy notes:

- One claim. The helper returns what each corner shows, or None when there is
  nothing to measure; the test narrows the None and makes its one claim.
- Layout geometry only exists in a real browser, so this is the browser lane.
- Controls are found by machine identity: the rail stage's `data-stage`, the
  tab's `data-tab`, the row's `data-k` (the engine's own config field name), the
  trigger's `data-testid`, the popover's `role`. The drawer is the one `aside`
  not carrying `data-closed`.
- "Shows whole" is read the way an eye reads it: each corner of the popover's
  box, stepped in from the edge, hit-tests to the popover itself. A popover cut
  by an ancestor's clip, or painted under something else, loses that corner to
  whatever is drawn there.
- Locators wait for what they act on, and the measurement waits on the drawer's
  own finite animations finishing.
"""

from playwright.sync_api import Page

from e2e.support import stack as stack_support

#: The rail stage whose drawer holds the gain rows.
VOLUME_STAGE = "volume"

#: The Volume drawer tab the PCM gain compensation row sits on.
GAIN_TAB = "gain"

#: The PCM gain compensation row's key: HQPlayer's own `/config` field name.
GAIN_COMP_ROW = "gain_comp"

#: The Compact plate, the smallest, laid out at scale 1: CSS pixels in landscape.
COMPACT = (1133, 744)

#: How far inside the popover's box each corner probe lands, CSS pixels, clear
#: of a rounded corner's cut and of the border's antialiased edge.
CORNER_INSET = 4.0

#: Ceiling on the open drawer and popover settling. A ceiling on a condition,
#: never a duration anything is expected to take.
SETTLE_TIMEOUT = 10_000

#: Waits out every finite animation and transition on the open drawer and
#: everything inside it, then answers, for each corner of the single visible
#: popover in the drawer stepped in by `inset`, whether the element painted
#: there is the popover or inside it. Null when the drawer, the row's see-more
#: trigger or the popover is missing.
CORNERS_JS = """
async ({ row, inset }) => {
  const drawer = document.querySelector("aside:not([data-closed])");
  if (!drawer) return null;
  const finite = (a) => a.effect && a.effect.getTiming().iterations !== Infinity;
  await Promise.all(drawer.getAnimations({ subtree: true }).filter(finite).map((a) => a.finished));
  const shown = (el) => el.getClientRects().length > 0;
  const triggers = [...drawer.querySelectorAll(`[data-k="${row}"] [data-testid="see-more"]`)].filter(shown);
  const pops = [...drawer.querySelectorAll('[role="dialog"]')].filter(shown);
  if (triggers.length !== 1 || pops.length !== 1) return null;
  const pop = pops[0];
  const r = pop.getBoundingClientRect();
  const corners = [
    [r.left + inset, r.top + inset],
    [r.right - inset, r.top + inset],
    [r.left + inset, r.bottom - inset],
    [r.right - inset, r.bottom - inset],
  ];
  return corners.map(([x, y]) => {
    const hit = document.elementFromPoint(x, y);
    return hit !== null && pop.contains(hit);
  });
}
"""


def _gain_comp_note_corners(page: Page, base_url: str) -> tuple[bool, ...] | None:
    """Open the PCM gain compensation row's see-more note on the Compact plate; return whether each corner shows it."""
    width, height = COMPACT
    page.set_viewport_size({"width": width, "height": height})
    page.goto(base_url)
    page.locator(f'button[data-stage="{VOLUME_STAGE}"]').click(timeout=SETTLE_TIMEOUT)
    drawer = page.locator("aside:not([data-closed])")
    drawer.locator(f'[role="tab"][data-tab="{GAIN_TAB}"]').click(timeout=SETTLE_TIMEOUT)
    drawer.locator(f'[data-k="{GAIN_COMP_ROW}"] [data-testid="see-more"]:visible').first.click(timeout=SETTLE_TIMEOUT)
    drawer.locator('[role="dialog"]:visible').first.wait_for(timeout=SETTLE_TIMEOUT)
    result = page.evaluate(CORNERS_JS, {"row": GAIN_COMP_ROW, "inset": CORNER_INSET})
    if result is None:
        return None
    return tuple(bool(v) for v in result)


def test_the_see_more_note_near_the_switcher_shows_whole(page: Page, stack: stack_support.Stack) -> None:
    """Every corner of the note popover shows the popover itself: no drawer edge cuts any of it off."""
    corners = _gain_comp_note_corners(page, stack.base_url)
    assert corners is not None
    assert corners == (True, True, True, True)
