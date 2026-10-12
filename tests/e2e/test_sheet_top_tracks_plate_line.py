"""Sheets open over the plate's body keep their place while the dropped-settings line comes, grows and goes.

The line naming the settings a daemon restart dropped shows directly under the top bar, one row per setting, and pushes
the plate's body down while it shows. Two sheets open over the body:

- The connection panel the brand knob opens starts at the body's top. While it is open, the line appearing, going away
  or gaining a row moves the panel with the body, so no strip of body shows above the panel and the panel never covers
  the engine row.
- The option list a filter picker opens in its sheet form spans from the body's top to the plate's foot. While it is
  open, the line appearing or going away keeps it spanning exactly that: it neither overruns the plate's foot nor falls
  short of it.

Each test opens one sheet, moves the body by changing the line, and measures once the body has moved.

Policy notes:

- Layout geometry only exists in a real browser, so this is the browser lane.
- A drop is the backend's own report, reached the way a user reaches it: live writes the engine confirms, then the
  control fake restarting by itself onto its config file, which brings each written attribute back to the value it held
  before the write, severs the open connection and turns away the first connect. The app lists the settings under
  `dropped_settings` and pushes them to the page. The line goes away through the report's clear on the REST wire, and
  gains a row when a later restart drops two settings where the first dropped one.
- The plate's foot is read as the plate's own bottom edge. The option list's span is judged by its top against the
  body's top and by its foot's distance from the plate's foot against that distance measured when it opened, so which
  edge of the plate's box counts as the foot cancels out.
- Controls are found by machine identity: the knob's and the sheets' `data-testid`, the filter nameplate's `data-key`,
  the shown body's `data-body`, the plate's `data-bottom`.
- Waits are bounded condition-polls: the line showing, found by the engine name of a setting written, before a sheet
  opens over it; the body moving off where it stood; then fonts loaded and every finite animation ended.
- One plate, the design size. Nothing in the behavior turns on the plate's size.
"""

import http.client
import json
import urllib.parse
from collections.abc import Iterator
from typing import NamedTuple

import pytest
from narrow import FixtureError
from playwright.sync_api import Page, ViewportSize

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


class Setting(NamedTuple):
    """A live setting: the field posted, the State attribute the engine reports it under, and the values a write may
    take, each with the engine's own name for it where the engine names one."""

    field: str
    state_key: str
    names: dict[str, str | None]


#: The junk filter: the control fake enumerates 1 as "20k" and 2 as "30k".
JUNK = Setting("junk_filter", "filter_junk", {"1": "20k", "2": "30k"})

#: Adaptive volume, on or off; the engine names neither.
ADAPTIVE = Setting("adaptive_volume", "adaptive", {"1": None, "0": None})

#: An alert line: an element carrying a severity.
LINE = "[data-sev]"

#: The REST routes the setup drives.
LIVE_PATH = "/api/config/live"
DROPPED_PATH = "/api/health/dropped-settings"

#: Ceiling on one REST call from the test. The app is on loopback.
CALL_TIMEOUT = 10.0

#: Ceiling, in ms, on a control or a sheet showing, on the body moving, and on the page settling.
SETTLE_TIMEOUT = 10_000

#: Layout snaps edges to device pixels, so an edge can read up to half a pixel off one it sits on.
SUBPIXEL = 0.5

#: True once the one shown body's top has moved off `before` by more than `slack`.
BODY_MOVED_JS = """
({ before, slack }) => {
  const shown = [...document.querySelectorAll("[data-body]")].filter((el) => el.getClientRects().length > 0);
  return shown.length === 1 && Math.abs(shown[0].getBoundingClientRect().top - before) > slack;
}
"""

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
    """A sheet measured once it had opened and settled, and again once the body had moved (None: not open)."""

    before: Measure
    after: Measure | None


def _call(stack: stack_support.Stack, method: str, path: str, payload: dict[str, object] | None = None) -> None:
    """Send one request to the app's REST API; a non-2xx answer raises."""
    data = None if payload is None else json.dumps(payload).encode()
    headers = {} if payload is None else {"Content-Type": "application/json"}
    conn = http.client.HTTPConnection(urllib.parse.urlsplit(stack.base_url).netloc, timeout=CALL_TIMEOUT)
    try:
        conn.request(method, path, body=data, headers=headers)
        response = conn.getresponse()
        response.read()
    finally:
        conn.close()
    if response.status // 100 != 2:
        raise FixtureError(reason=f"{method} {path} answered {response.status}")


def _clear_report(stack: stack_support.Stack) -> None:
    """Clear the dropped-settings report."""
    _call(stack, "DELETE", DROPPED_PATH)


@pytest.fixture
def no_report(stack: stack_support.Stack) -> Iterator[None]:
    """Start and end with the report listing nothing, so the session's next test inherits no line."""
    _clear_report(stack)
    yield
    _clear_report(stack)


class Written(NamedTuple):
    """A confirmed live write: the setting, the value the engine held before it, which its config file brings back,
    and the value written."""

    setting: Setting
    config_value: str
    value: str


def _write_live(stack: stack_support.Stack, setting: Setting) -> Written:
    """Write `setting` live onto a value the engine is not on and have the engine confirm it."""
    before = stack.control_state[setting.state_key]
    value = next(v for v in setting.names if v != before)
    _call(stack, "POST", LIVE_PATH, {"fields": {setting.field: value}})
    if stack.control_state[setting.state_key] != value:
        raise FixtureError(reason=f"the engine never took {setting.field}={value}")
    return Written(setting, before, value)


def _restart_on_its_own(stack: stack_support.Stack, *written: Written) -> None:
    """hqplayerd restarts by itself onto its config file: every written attribute is back on the file's value, every
    open connection is severed, and the first connect inside the restart window is turned away."""
    state = stack.control_state
    for w in written:
        state[w.setting.state_key] = w.config_value
    state["_generation"] = str(int(state.get("_generation", "0")) + 1)
    state["_refuse_connects"] = "1"


def _load(page: Page, stack: stack_support.Stack) -> None:
    """Load the plate at the design size."""
    page.set_viewport_size(DESIGN)
    page.goto(f"{stack.base_url}/")


def _wait_for_line(page: Page, written: Written) -> None:
    """Wait for the line naming the junk filter `written` put on the engine to show."""
    name = written.setting.names[written.value]
    if name is None:
        raise FixtureError(reason=f"{written.setting.field}={written.value} has no engine name to find its line by")
    page.locator(LINE, has_text=name).first.wait_for(state="visible", timeout=SETTLE_TIMEOUT)


def _measure(page: Page, sheet: Sheet) -> Measure | None:
    """The open sheet, the body and the plate as they stand."""
    found = page.evaluate(MEASURE_JS, {"sheet": sheet.sheet})
    if found is None:
        return None
    return Measure(float(found["top"]), float(found["bottom"]), float(found["body"]), float(found["foot"]))


def _open(page: Page, sheet: Sheet) -> Measure:
    """Open `sheet` from its control, let the page settle and measure it; raises when it did not open."""
    page.locator(sheet.opener).first.click(timeout=SETTLE_TIMEOUT)
    page.locator(f"{sheet.sheet}:not([data-closed])").first.wait_for(state="visible", timeout=SETTLE_TIMEOUT)
    page.wait_for_function(SETTLED_JS, timeout=SETTLE_TIMEOUT)
    opened = _measure(page, sheet)
    if opened is None:
        raise FixtureError(reason=f"{sheet.sheet} did not open over a single body on a single plate")
    return opened


def _after_move(page: Page, sheet: Sheet, before: Measure) -> Moved:
    """Wait for the body to move off where it stood in `before` and the page to settle, then measure again."""
    page.wait_for_function(BODY_MOVED_JS, arg={"before": before.body, "slack": SUBPIXEL}, timeout=SETTLE_TIMEOUT)
    page.wait_for_function(SETTLED_JS, timeout=SETTLE_TIMEOUT)
    return Moved(before, _measure(page, sheet))


def _as_the_line_appears(page: Page, stack: stack_support.Stack, sheet: Sheet) -> Moved:
    """Open `sheet` with no line showing, then have a restart drop a live write."""
    written = _write_live(stack, JUNK)
    _load(page, stack)
    before = _open(page, sheet)
    _restart_on_its_own(stack, written)
    return _after_move(page, sheet, before)


def _as_the_line_goes(page: Page, stack: stack_support.Stack, sheet: Sheet) -> Moved:
    """Have a restart drop a live write, open `sheet` under the line, then clear the report."""
    written = _write_live(stack, JUNK)
    _restart_on_its_own(stack, written)
    _load(page, stack)
    _wait_for_line(page, written)
    before = _open(page, sheet)
    _clear_report(stack)
    return _after_move(page, sheet, before)


def _as_the_line_grows(page: Page, stack: stack_support.Stack, sheet: Sheet) -> Moved:
    """Have a restart drop one live write, open `sheet` under its one-row line, then have a second restart drop two."""
    first = _write_live(stack, JUNK)
    _restart_on_its_own(stack, first)
    _load(page, stack)
    _wait_for_line(page, first)
    before = _open(page, sheet)
    _restart_on_its_own(stack, _write_live(stack, JUNK), _write_live(stack, ADAPTIVE))
    return _after_move(page, sheet, before)


@pytest.mark.usefixtures("no_report")
def test_the_open_connection_panel_moves_down_with_the_body_when_the_dropped_settings_line_appears(
    page: Page, stack: stack_support.Stack
) -> None:
    """The line showing pushes the body down, and the open panel's top follows it there."""
    after = _as_the_line_appears(page, stack, PANEL).after
    assert after is not None
    assert after.top == pytest.approx(after.body, abs=SUBPIXEL)


@pytest.mark.usefixtures("no_report")
def test_the_open_connection_panel_moves_up_with_the_body_when_the_dropped_settings_line_goes_away(
    page: Page, stack: stack_support.Stack
) -> None:
    """The line clearing lets the body rise, and the open panel's top rises with it."""
    after = _as_the_line_goes(page, stack, PANEL).after
    assert after is not None
    assert after.top == pytest.approx(after.body, abs=SUBPIXEL)


@pytest.mark.usefixtures("no_report")
def test_the_open_connection_panel_moves_down_with_the_body_when_the_dropped_settings_line_gains_a_row(
    page: Page, stack: stack_support.Stack
) -> None:
    """A report gaining a setting makes the line taller and pushes the body further down; the panel's top follows."""
    after = _as_the_line_grows(page, stack, PANEL).after
    assert after is not None
    assert after.top == pytest.approx(after.body, abs=SUBPIXEL)


@pytest.mark.usefixtures("no_report")
def test_the_open_filter_list_still_spans_the_body_top_to_the_plate_foot_when_the_dropped_settings_line_appears(
    page: Page, stack: stack_support.Stack
) -> None:
    """With the body pushed down, the sheet starts at the body's top and still ends where it ended by the foot."""
    moved = _as_the_line_appears(page, stack, FILTER_LIST)
    assert moved.after is not None
    assert _span(moved.after) == pytest.approx((0.0, _above_foot(moved.before)), abs=SUBPIXEL)


@pytest.mark.usefixtures("no_report")
def test_the_open_filter_list_still_spans_the_body_top_to_the_plate_foot_when_the_dropped_settings_line_goes_away(
    page: Page, stack: stack_support.Stack
) -> None:
    """With the body risen, the sheet starts at the body's top and still ends where it ended by the foot."""
    moved = _as_the_line_goes(page, stack, FILTER_LIST)
    assert moved.after is not None
    assert _span(moved.after) == pytest.approx((0.0, _above_foot(moved.before)), abs=SUBPIXEL)
