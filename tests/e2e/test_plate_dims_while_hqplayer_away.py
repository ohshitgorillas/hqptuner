"""The plate looks dimmed while HQPlayer is away, every control still takes a tap, and it undims on return.

The control lane going away is what a crash or a `systemctl restart` of the
daemon looks like to HQPTuner: the open connection is severed and every connect
is refused until the daemon is back. Each test loads the page with the lane up,
takes the lane away through the control fake's state, and reads the plate.

Policy notes:

- Browser lane: the rendered component suite pins the plate's away mark follows
  the phase; that the stylesheet turns the mark into a dimmer plate, and that
  the controls under it stay live, exists only once a browser computes the
  style and routes the tap.
- A look is only ever compared with another observed look, never with a literal
  opacity or token: the plate while the lane was up, the plate while it is
  away, the plate once the lane is back.
- Controls are found by wire identity: the plate by its class, the header's
  Settings button by its test id and a Settings category by its stage.
- The session stack's lane is put back as the test found it, on failure too,
  since every later test needs a live lane.
- Every wait is a bounded ceiling on an observed condition: the e2e app polls
  at 0.1 s and alarms at 0.05 s, so a working page is far inside it.
"""

from collections.abc import Iterator

import pytest
from fake_control import take_lane_down
from playwright.sync_api import Page

from e2e.support import stack as stack_support

#: The plate and the header's Settings button.
PLATE = ".plate"
SETTINGS = "[data-testid='settings']"

#: The Settings category that opens a drawer, and that drawer.
STAGE = "logging"
DRAWER = f"#drawer-{STAGE}"

#: Ceiling on the page following the lane going away or coming back, ms.
FOLLOW_TIMEOUT_MS = 10000.0

#: The plate dimmed or not, as the browser computes it.
OPACITY_JS = "() => getComputedStyle(document.querySelector('.plate')).opacity"

#: The plate's computed opacity differs from the one passed in.
DIFFERS_JS = f"(before) => ({OPACITY_JS})() !== before"

#: The plate's computed opacity equals the one passed in.
EQUALS_JS = f"(before) => ({OPACITY_JS})() === before"


@pytest.fixture
def lane_stack(stack: stack_support.Stack) -> Iterator[stack_support.Stack]:
    """The session stack, its control lane put back when the test ends, whichever way it ended."""
    try:
        yield stack
    finally:
        stack.control_state.pop("_down", None)


def _opacity(page: Page) -> str:
    """The plate's computed opacity."""
    return str(page.evaluate(OPACITY_JS))


def _loaded(page: Page, stack: stack_support.Stack) -> str:
    """Load the page with the lane up; its plate's look."""
    page.goto(stack.base_url)
    page.locator(PLATE).wait_for(state="visible", timeout=FOLLOW_TIMEOUT_MS)
    return _opacity(page)


def _away(page: Page, stack: stack_support.Stack, before: str) -> str:
    """Take the lane away and wait for the plate to look other than `before`; its look."""
    take_lane_down(stack.control_state)
    page.wait_for_function(DIFFERS_JS, arg=before, timeout=FOLLOW_TIMEOUT_MS)
    return _opacity(page)


def test_the_plate_looks_dimmed_while_the_lane_is_away(page: Page, lane_stack: stack_support.Stack) -> None:
    before = _loaded(page, lane_stack)
    away = _away(page, lane_stack, before)
    assert float(away) < float(before)


def test_a_tap_while_the_lane_is_away_starts_its_action(page: Page, lane_stack: stack_support.Stack) -> None:
    before = _loaded(page, lane_stack)
    _away(page, lane_stack, before)
    page.locator(SETTINGS).click(timeout=FOLLOW_TIMEOUT_MS)
    page.locator(f'button[data-stage="{STAGE}"]').click(timeout=FOLLOW_TIMEOUT_MS)
    page.locator(DRAWER).wait_for(state="visible", timeout=FOLLOW_TIMEOUT_MS)
    assert page.locator(DRAWER).is_visible()


def test_the_plate_looks_as_it_did_once_the_lane_is_back(page: Page, lane_stack: stack_support.Stack) -> None:
    before = _loaded(page, lane_stack)
    _away(page, lane_stack, before)
    lane_stack.control_state.pop("_down", None)
    page.wait_for_function(EQUALS_JS, arg=before, timeout=FOLLOW_TIMEOUT_MS)
    assert _opacity(page) == before
