"""The page around the plate: it scrolls where the window is smaller than the plate, and centers it where larger.

The plate never scales. In a direction where the window is smaller than the plate,
the page scrolls in that direction and every part of the plate can be reached,
its top and left edges included, with nothing of it cut off. In a direction
where the window is larger, the plate sits centered and the page does not
scroll. A plate that fills the window exactly leaves the page with no scroll.
Each holds for a format the Display choice pins and for Auto, whose plate
stretches to the window from Compact's size up to Expanded's.

Each case pins a Display choice in the browser's storage before the app loads,
lays the page out in one window, and measures the plate's box against the
window with the page scrolled to its start and to its end.

Policy notes:

- Geometry exists only in a real layout engine, so this is the browser lane.
- The Display choice is set the way the browser holds it: the storage key and
  the format ids the prefs suite names (`hqptuner.displayFormat`).
- The plate is found by its `plate` class; the window is the page's own box
  (`document.documentElement`'s client size), so a scroll bar the page shows is
  not counted as window.
- An edge is reachable when, with the page scrolled as far toward it as it
  goes, it lies inside the window. The top and left edges, reached with the
  page at its start, are held by `test_plate_top_and_left_edges_reachable`. A plate squeezed below its size would make
  every edge reachable, so its size is held to the size the choice gives.
- Waits are bounded condition-polls: the plate shown, fonts loaded and every
  finite animation settled.
"""

from typing import NamedTuple

import pytest
from playwright.sync_api import Page, ViewportSize

from e2e.support import fit
from e2e.support import stack as stack_support

#: Where the browser holds the Display choice.
DISPLAY_KEY = "hqptuner.displayFormat"

#: The Display choices, by format id.
AUTO = "auto"
EXPANDED = "expanded"
NORMAL = "normal"
COMPACT = "compact"

#: Each format's size, in CSS px.
EXPANDED_SIZE = (1366, 1024)
NORMAL_SIZE = (1180, 820)
COMPACT_SIZE = (1133, 744)

#: The plate element.
PLATE = ".plate"

#: Far past any scroll range, so a scroll there lands at the end.
FAR = 1_000_000


class Case(NamedTuple):
    """A Display choice, the window it is laid out in, and the plate size it gives there."""

    choice: str
    window: ViewportSize
    plate: tuple[int, int]


#: Smaller than the plate in both directions: a pinned format in a smaller
#: window, a pinned format in a far smaller one, Auto below Compact's size.
SMALLER = {
    "expanded-in-a-normal-window": Case(EXPANDED, ViewportSize(width=1180, height=820), EXPANDED_SIZE),
    "compact-in-a-far-smaller-window": Case(COMPACT, ViewportSize(width=900, height=600), COMPACT_SIZE),
    "auto-below-compact": Case(AUTO, ViewportSize(width=1000, height=650), COMPACT_SIZE),
}

#: Larger than the plate in both directions: a pinned format, and Auto past Expanded's size.
LARGER = {
    "compact-in-an-expanded-window": Case(COMPACT, ViewportSize(width=1366, height=1024), COMPACT_SIZE),
    "auto-past-expanded": Case(AUTO, ViewportSize(width=1600, height=1200), EXPANDED_SIZE),
}

#: Larger than the plate across, smaller down: Expanded pinned in a wide, short window.
WIDE_SHORT = Case(EXPANDED, ViewportSize(width=1600, height=820), EXPANDED_SIZE)

#: The plate filling the window exactly: a pinned format at its size, and Auto between the formats.
EXACT = {
    "normal-in-a-normal-window": Case(NORMAL, ViewportSize(width=1180, height=820), NORMAL_SIZE),
    "auto-between-the-formats": Case(AUTO, ViewportSize(width=1250, height=900), (1250, 900)),
}

#: The two directions, as the measure names them.
ACROSS = "x"
DOWN = "y"

#: Shows the plate, settles, then measures it with the page scrolled to its start and to its end.
MEASURE_JS = "async ({ plate, far, ceiling }) => {" + fit.PRELUDE_JS + """
  await until(() => {
    const el = document.querySelector(plate);
    return el !== null && el.getClientRects().length > 0;
  }, ceiling, "the plate to show");
  await settle(ceiling);
  const el = document.querySelector(plate);
  const page = document.documentElement;
  window.scrollTo(0, 0);
  await frame();
  const start = el.getBoundingClientRect();
  window.scrollTo(far, far);
  await frame();
  const end = el.getBoundingClientRect();
  const scrolled = { x: window.scrollX, y: window.scrollY };
  window.scrollTo(0, 0);
  return {
    size: { x: start.width, y: start.height },
    lead: { x: start.left, y: start.top },
    trail: { x: page.clientWidth - end.right, y: page.clientHeight - end.bottom },
    before: { x: start.left, y: start.top },
    after: { x: page.clientWidth - start.right, y: page.clientHeight - start.bottom },
    scrolled,
  };
}
"""


class Measure(NamedTuple):
    """The plate against the window, per direction, in CSS px.

    `lead` is the plate's top or left edge's distance inside the window with the
    page at its start, `trail` its bottom or right edge's with the page at its
    end; `before` and `after` are the gaps either side of it with the page at
    its start; `scrolled` is how far the page moved when asked to scroll to its end.
    """

    size: dict[str, float]
    lead: dict[str, float]
    trail: dict[str, float]
    before: dict[str, float]
    after: dict[str, float]
    scrolled: dict[str, float]


def plate_against_window(page: Page, stack: stack_support.Stack, case: Case) -> Measure:
    """Pin `case`'s Display choice, lay the page out in its window, and measure the plate."""
    page.set_viewport_size(case.window)
    page.add_init_script(f'try {{ window.localStorage.setItem("{DISPLAY_KEY}", "{case.choice}"); }} catch (e) {{}}')
    page.goto(f"{stack.base_url}/")
    found = page.evaluate(MEASURE_JS, {"plate": PLATE, "far": FAR, "ceiling": fit.SETTLE_TIMEOUT})
    return Measure(**found)


def axis_index(axis: str) -> int:
    """Which entry of a (width, height) pair `axis` names."""
    return 0 if axis == ACROSS else 1


@pytest.mark.parametrize("axis", [ACROSS, DOWN])
@pytest.mark.parametrize("case", sorted(SMALLER))
def test_in_a_smaller_window_the_plate_keeps_its_size(
    page: Page, stack: stack_support.Stack, case: str, axis: str
) -> None:
    """The plate is laid out at the size its choice gives, not squeezed into the window."""
    measure = plate_against_window(page, stack, SMALLER[case])
    assert abs(measure.size[axis] - SMALLER[case].plate[axis_index(axis)]) <= fit.ROUNDING


@pytest.mark.parametrize("axis", [ACROSS, DOWN])
@pytest.mark.parametrize("case", sorted(SMALLER))
def test_in_a_smaller_window_the_page_scrolls_to_the_plates_bottom_and_right_edges(
    page: Page, stack: stack_support.Stack, case: str, axis: str
) -> None:
    """With the page scrolled to its end, the plate's trailing edge lies inside the window."""
    measure = plate_against_window(page, stack, SMALLER[case])
    assert measure.trail[axis] >= -fit.ROUNDING


@pytest.mark.parametrize("axis", [ACROSS, DOWN])
@pytest.mark.parametrize("case", sorted(LARGER))
def test_in_a_larger_window_the_plate_sits_centered(
    page: Page, stack: stack_support.Stack, case: str, axis: str
) -> None:
    """The space before the plate equals the space after it."""
    measure = plate_against_window(page, stack, LARGER[case])
    assert abs(measure.before[axis] - measure.after[axis]) <= fit.ROUNDING


@pytest.mark.parametrize("axis", [ACROSS, DOWN])
@pytest.mark.parametrize("case", sorted(LARGER))
def test_in_a_larger_window_the_page_does_not_scroll(
    page: Page, stack: stack_support.Stack, case: str, axis: str
) -> None:
    """Asked to scroll to its end, the page stays where it is."""
    measure = plate_against_window(page, stack, LARGER[case])
    assert measure.scrolled[axis] <= fit.ROUNDING


def test_in_a_window_wider_but_shorter_than_the_plate_the_plate_sits_centered_across(
    page: Page, stack: stack_support.Stack
) -> None:
    """Across, where the window is larger, the space left of the plate equals the space right of it."""
    measure = plate_against_window(page, stack, WIDE_SHORT)
    assert abs(measure.before[ACROSS] - measure.after[ACROSS]) <= fit.ROUNDING


def test_in_a_window_wider_but_shorter_than_the_plate_the_page_does_not_scroll_across(
    page: Page, stack: stack_support.Stack
) -> None:
    """Across, where the window is larger, the page does not scroll."""
    measure = plate_against_window(page, stack, WIDE_SHORT)
    assert measure.scrolled[ACROSS] <= fit.ROUNDING


def test_in_a_window_wider_but_shorter_than_the_plate_the_page_scrolls_to_the_plates_foot(
    page: Page, stack: stack_support.Stack
) -> None:
    """Down, where the window is smaller, the page scrolls far enough to bring the plate's bottom edge in."""
    measure = plate_against_window(page, stack, WIDE_SHORT)
    assert measure.trail[DOWN] >= -fit.ROUNDING


@pytest.mark.parametrize("axis", [ACROSS, DOWN])
@pytest.mark.parametrize("case", sorted(EXACT))
def test_a_plate_filling_the_window_leaves_the_page_without_scroll(
    page: Page, stack: stack_support.Stack, case: str, axis: str
) -> None:
    """Asked to scroll to its end, the page stays where it is."""
    measure = plate_against_window(page, stack, EXACT[case])
    assert measure.scrolled[axis] <= fit.ROUNDING
