"""The rate pin picker's size and place on the Output drawer's Format tab.

The picker (`Auto | 44.1k | 48k`) shows on the Rate row while Settings, Behavior,
Allow pinned rates is on. It is a switch like the drawer's others, so a finger
has to be able to hit each of its buttons: each is as tall as the Output mode
and DoP switches' buttons, the three are one size, and the picker sits on the
Rate row's label line rather than hanging off the row's corner past it.

Policy notes:

- Browser lane: a size and a position exist only once a stylesheet lays the
  drawer out, which server rendering never does.
- Controls are found by wire identity only: the rail stage (`data-stage`), the
  Format tab (`data-tab`), a row's catalog key (`data-k`), the dial's block
  (`data-block`) and the picker's options (`data-pin`). No caption is read.
- The Rate row's label line has no wire identity, so it is found as the drawer
  row grammar's head line, `.fh`, inside the dial's block. A `data-testid` on
  that line would be the copy-free handle.
- The page is laid out at 1133x744, the Compact plate, the smallest, at scale 1.
- Locators wait on conditions, and the drawer's own finite animations are
  awaited to their end before anything is measured.
"""

from typing import Any

from playwright.sync_api import Locator, Page, ViewportSize

from e2e.support import stack as stack_support

#: The Compact plate, the smallest, laid out at scale 1: CSS pixels in landscape.
VIEWPORT: ViewportSize = {"width": 1133, "height": 744}

#: Where the app keeps the Allow pinned rates preference, and its On value.
PINNED_RATES_KEY = "hqptuner.allowPinnedRates"
ON = "1"

#: The picker's three options by wire identity: Auto, the 44.1k family, the 48k family.
PIN_OPTIONS = ("auto", "f44", "f48")

#: Box edges and sizes are compared to this many pixels: layout rounds to sub-pixel steps.
TOLERANCE = 0.5

#: Ceiling on the drawer coming up. Generous: the app is on loopback and already answering.
OPEN_TIMEOUT_MS = 10_000

#: Turns the preference on before any app script reads it.
ALLOW_PINNED_RATES_JS = f"""
try {{ window.localStorage.setItem("{PINNED_RATES_KEY}", "{ON}"); }} catch (e) {{}}
"""

#: Resolves once every finite animation on the page has finished or been canceled.
SETTLE_JS = """
async () => {
  const finite = document
    .getAnimations()
    .filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity);
  await Promise.allSettled(finite.map((a) => a.finished));
}
"""


def open_format_tab(page: Page, stack: stack_support.Stack) -> None:
    """Load the app with pinned rates allowed, open the Output drawer on Format, and let it settle."""
    page.set_viewport_size(VIEWPORT)
    page.add_init_script(ALLOW_PINNED_RATES_JS)
    page.goto(stack.base_url)
    page.locator("button[data-stage='output']").click()
    page.locator("[role='tab'][data-tab='format']").click()
    page.locator(f"[data-pin='{PIN_OPTIONS[-1]}']").wait_for(state="visible", timeout=OPEN_TIMEOUT_MS)
    page.evaluate(SETTLE_JS)


def box(locator: Locator) -> dict[str, Any]:
    """The laid-out box of the one element `locator` names; an element that is not shown has none to measure."""
    found = locator.bounding_box(timeout=OPEN_TIMEOUT_MS)
    if found is None:
        raise LookupError(locator)
    return dict(found)


def pin_boxes(page: Page) -> list[dict[str, Any]]:
    """The boxes of the picker's three options, in `PIN_OPTIONS` order."""
    return [box(page.locator(f"[data-pin='{pin}']")) for pin in PIN_OPTIONS]


def picker_box(page: Page) -> dict[str, Any]:
    """The box of the radio group that holds the picker's options."""
    return box(page.locator("[role='radiogroup']", has=page.locator("[data-pin]")))


def rate_label_line_box(page: Page) -> dict[str, Any]:
    """The box of the Rate row's label line: the head line of the dial's block."""
    return box(page.locator("[data-block='dial'] .fh").first)


def overhang(inner: dict[str, Any], outer: dict[str, Any]) -> float:
    """How far `inner` reaches above or below `outer`, in pixels, summed over both edges."""
    above = max(0.0, float(outer["y"]) - float(inner["y"]))
    below = max(0.0, float(inner["y"]) + float(inner["height"]) - float(outer["y"]) - float(outer["height"]))
    return above + below


def test_the_pin_options_are_one_width(page: Page, stack: stack_support.Stack) -> None:
    open_format_tab(page, stack)
    widths = [float(b["width"]) for b in pin_boxes(page)]
    assert max(widths) - min(widths) <= TOLERANCE, f"pin option widths {widths}"


def test_the_pin_picker_sits_within_the_rate_rows_label_line(page: Page, stack: stack_support.Stack) -> None:
    open_format_tab(page, stack)
    picker, line = picker_box(page), rate_label_line_box(page)
    assert overhang(picker, line) <= TOLERANCE, f"picker {picker}, label line {line}"
