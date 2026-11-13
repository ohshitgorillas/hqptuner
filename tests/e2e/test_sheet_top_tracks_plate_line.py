"""Sheets open over the plate's body keep their place when a plate line goes away under them.

A failure line shows directly under the top bar and pushes the plate's body down while it shows; tapping it dismisses
it, and the body rises. Two sheets open over the body:

- The connection panel the brand knob opens starts at the body's top. When the line goes away while the panel is open,
  the panel rises with the body, so no strip of body shows above it.
- The option list a filter picker opens in its sheet form spans from the body's top to the plate's foot. When the line
  goes away while it is open, it still spans exactly that: it neither overruns the plate's foot nor falls short of it.

Each test raises the line, opens one sheet under it, taps the line away and measures in the frame the body moved.

Policy notes:

- Layout geometry only exists in a real browser, so this is the browser lane.
- The line is a favorite the page could not save: the browser's own `PUT /api/favorites` is refused at the network,
  the way a dropped connection refuses it, after a row's favorite control in the open option list is tapped. Nothing
  reaches the server, so the session's next test inherits no favorite.
- The plate's foot is read as the plate's own bottom edge. The option list's span is judged by its top against the
  body's top and by its foot's distance from the plate's foot against that distance measured when it opened, so which
  edge of the plate's box counts as the foot cancels out.
- Controls are found by machine identity: the knob's and the sheets' `data-testid`, the filter nameplate's `data-key`,
  a row's favorite control's `data-fav`, the line's `data-sev`, the shown body's `data-body`, the plate's
  `data-bottom`.
- Waits are bounded condition-polls: the line showing before a sheet opens under it, then fonts loaded and every
  finite animation ended before the sheet is first measured. The second measurement is taken inside the animation-frame
  poll that first sees the body moved, before that frame's ResizeObserver callbacks run, so a sheet that follows the
  body only on the observer's next report reads where it stood.
- One plate, the design size. Nothing in the behavior turns on the plate's size.
"""

from typing import NamedTuple

import pytest
from narrow import FixtureError
from playwright.sync_api import Page, Route, ViewportSize

from e2e.support import stack as stack_support

#: The design size.
DESIGN = ViewportSize(width=1080, height=810)


class Sheet(NamedTuple):
    """A sheet that opens over the body: the control that opens it, and the sheet's own element."""

    opener: str
    sheet: str


#: The connection panel, opened from the brand knob.
PANEL = Sheet(opener='[data-testid="conn"]', sheet='aside[data-testid="conn-panel"]')

#: The option list in its sheet form, opened from a filter's nameplate.
FILTER_LIST = Sheet(opener='button[data-key^="pcm_filter"]', sheet='[data-testid="option-list"]')

#: A row's favorite control in the open option list: tapping it writes the favorites out.
FAVORITE = f"{FILTER_LIST.sheet}:not([data-closed]) button[data-fav]"

#: The option list's own close control.
CLOSE_LIST = '[data-testid="close-list"]'

#: A dismissible plate line: an alert line carrying a severity that a tap acts on.
LINE = "button[data-sev]"

#: The REST route the page writes the favorites to.
FAVORITES_ROUTE = "**/api/favorites"

#: Ceiling, in ms, on a control or a sheet showing, on the body moving, and on the page settling.
SETTLE_TIMEOUT = 10_000

#: Layout snaps edges to device pixels, so an edge can read up to half a pixel off one it sits on.
SUBPIXEL = 0.5


#: True once the real fonts are in and every animation that ends has ended.
SETTLED_JS = """
() => document.fonts.status === "loaded" &&
  document.getAnimations().every(
    (a) => a.effect === null || a.effect.getComputedTiming().iterations === Infinity || a.playState !== "running",
  )
"""

#: The open sheet's top and bottom, the shown body's top and the plate's bottom; null when the sheet is shut or not
#: shown, or there is not exactly one shown body or one plate.
MEASURE_JS = """
({ sheet }) => {
  const shownOf = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length > 0);
  const open = shownOf(sheet).filter((e) => !e.hasAttribute("data-closed"));
  const body = shownOf("[data-body]");
  const plate = shownOf("[data-bottom]");
  if (open.length === 0 || body.length !== 1 || plate.length !== 1) return null;
  const box = open[0].getBoundingClientRect();
  return {
    top: box.top,
    bottom: box.bottom,
    body: body[0].getBoundingClientRect().top,
    foot: plate[0].getBoundingClientRect().bottom,
  };
}
"""

#: In the first animation frame where the one shown body's top has moved off `before` by more than `slack`, that frame's
#: measurement of `sheet` as MEASURE_JS takes it, under `m`; false in every frame before. Animation frame callbacks run
#: before the frame's ResizeObserver callbacks, so a sheet that only follows the body from the observer still stands
#: where it stood.
MOVED_JS = f"""
({{ before, slack, sheet }}) => {{
  const shown = [...document.querySelectorAll("[data-body]")].filter((el) => el.getClientRects().length > 0);
  if (shown.length !== 1 || Math.abs(shown[0].getBoundingClientRect().top - before) <= slack) return false;
  return {{ m: ({MEASURE_JS.strip()})({{ sheet }}) }};
}}
"""


class Measure(NamedTuple):
    """The open sheet's top and bottom, the body's top and the plate's foot, in CSS px."""

    top: float
    bottom: float
    body: float
    foot: float


def _above_foot(m: Measure) -> float:
    """The sheet's foot's distance above the plate's foot in `m`."""
    return m.foot - m.bottom


def _span(m: Measure) -> tuple[float, float]:
    """Where the sheet in `m` sits against its span: its top's distance below the body's top, then its foot's distance
    above the plate's foot. A plain pair, which pytest prints in full when an approx comparison fails."""
    return (m.top - m.body, _above_foot(m))


class Moved(NamedTuple):
    """A sheet measured once it had opened and settled, and again in the frame the body moved (None: not open)."""

    before: Measure
    after: Measure | None


def _refuse_favorites_writes(route: Route) -> None:
    """Refuse a favorites write at the network; let the page's reads through."""
    if route.request.method == "PUT":
        route.abort()
    else:
        route.continue_()


def _load(page: Page, stack: stack_support.Stack) -> None:
    """Load the plate at the design size, with every favorites write it makes refused."""
    page.route(FAVORITES_ROUTE, _refuse_favorites_writes)
    page.set_viewport_size(DESIGN)
    page.goto(f"{stack.base_url}/")


def _measure_of(found: dict[str, float] | None) -> Measure | None:
    """A MEASURE_JS answer as a Measure."""
    if found is None:
        return None
    return Measure(float(found["top"]), float(found["bottom"]), float(found["body"]), float(found["foot"]))


def _measure(page: Page, sheet: Sheet) -> Measure | None:
    """The open sheet, the body and the plate as they stand."""
    return _measure_of(page.evaluate(MEASURE_JS, {"sheet": sheet.sheet}))


def _open(page: Page, sheet: Sheet) -> None:
    """Open `sheet` from its control and wait for it to show."""
    page.locator(sheet.opener).first.click(timeout=SETTLE_TIMEOUT)
    page.locator(f"{sheet.sheet}:not([data-closed])").first.wait_for(state="visible", timeout=SETTLE_TIMEOUT)


def _settled(page: Page, sheet: Sheet) -> Measure:
    """Let the page settle and measure the open `sheet`; raises when it is not open over a single body."""
    page.wait_for_function(SETTLED_JS, timeout=SETTLE_TIMEOUT)
    found = _measure(page, sheet)
    if found is None:
        raise FixtureError(reason=f"{sheet.sheet} is not open over a single body on a single plate")
    return found


def _raise_line(page: Page) -> None:
    """Tap a row's favorite control in the open option list, whose write the network refuses, and wait for the line."""
    page.locator(FAVORITE).first.click(timeout=SETTLE_TIMEOUT)
    page.locator(LINE).first.wait_for(state="visible", timeout=SETTLE_TIMEOUT)


def _tap_line_away(page: Page, sheet: Sheet, before: Measure) -> Moved:
    """Tap the line and measure `sheet` in the first frame the body has moved off where it stood in `before`."""
    page.locator(LINE).first.click(timeout=SETTLE_TIMEOUT)
    moved = page.wait_for_function(
        MOVED_JS,
        arg={"before": before.body, "slack": SUBPIXEL, "sheet": sheet.sheet},
        polling="raf",
        timeout=SETTLE_TIMEOUT,
    )
    return Moved(before, _measure_of(moved.json_value()["m"]))


def _list_as_the_line_goes(page: Page, stack: stack_support.Stack) -> Moved:
    """Raise the line from the open option list, then tap it away with the list still open."""
    _load(page, stack)
    _open(page, FILTER_LIST)
    _raise_line(page)
    return _tap_line_away(page, FILTER_LIST, _settled(page, FILTER_LIST))


def _panel_as_the_line_goes(page: Page, stack: stack_support.Stack) -> Moved:
    """Raise the line from the option list, close the list, open the panel under the line, then tap the line away."""
    _load(page, stack)
    _open(page, FILTER_LIST)
    _raise_line(page)
    page.locator(CLOSE_LIST).first.click(timeout=SETTLE_TIMEOUT)
    _open(page, PANEL)
    return _tap_line_away(page, PANEL, _settled(page, PANEL))


def test_the_open_connection_panel_moves_up_with_the_body_when_a_plate_line_goes_away(
    page: Page, stack: stack_support.Stack
) -> None:
    """The line going away lets the body rise, and the open panel's top rises with it."""
    after = _panel_as_the_line_goes(page, stack).after
    assert after is not None
    assert after.top == pytest.approx(after.body, abs=SUBPIXEL)


def test_the_open_filter_list_still_spans_the_body_top_to_the_plate_foot_when_a_plate_line_goes_away(
    page: Page, stack: stack_support.Stack
) -> None:
    """With the body risen, the sheet starts at the body's top and still ends where it ended by the foot."""
    moved = _list_as_the_line_goes(page, stack)
    assert moved.after is not None
    assert _span(moved.after) == pytest.approx((0.0, _above_foot(moved.before)), abs=SUBPIXEL)
