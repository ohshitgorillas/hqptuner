"""Where the window is smaller than the plate, the plate's top and left edges can be reached.

The plate never scales. In a direction where the window is smaller than the
plate, the page scrolls in that direction and every part of the plate can be
reached, its top and left edges included: with the page at its start, the
plate's top and left edges lie inside the window, not off past it where no
scroll reaches. Holds for a pinned format in a smaller window and for Auto
below Compact's size.

The cases, the Display choice and the measure are the page suite's
(`e2e.test_plate_page_scrolls_or_centers`), which this file extends.

Policy notes:

- Geometry exists only in a real layout engine, so this is the browser lane.
- Waits are bounded condition-polls: the plate shown, fonts loaded and every
  finite animation settled.
"""

import pytest
from playwright.sync_api import Page

from e2e import test_plate_page_scrolls_or_centers as around
from e2e.support import fit
from e2e.support import stack as stack_support


@pytest.mark.parametrize("axis", [around.ACROSS, around.DOWN])
@pytest.mark.parametrize("case", sorted(around.SMALLER))
def test_in_a_smaller_window_the_plates_top_and_left_edges_can_be_reached(
    page: Page, stack: stack_support.Stack, case: str, axis: str
) -> None:
    """With the page at its start, the plate's leading edge lies inside the window, not off past it."""
    measure = around.plate_against_window(page, stack, around.SMALLER[case])
    assert measure.lead[axis] >= -fit.ROUNDING


def test_in_a_window_wider_but_shorter_than_the_plate_its_top_edge_can_be_reached(
    page: Page, stack: stack_support.Stack
) -> None:
    """Down, with the page at its start, the plate's top edge lies inside the window."""
    measure = around.plate_against_window(page, stack, around.WIDE_SHORT)
    assert measure.lead[around.DOWN] >= -fit.ROUNDING
