"""The rate pin picker's size and place on the Output drawer's Format tab.

The picker (`Auto | 44.1k | 48k`) shows on the Rate row while Settings, Behavior,
Allow pinned rates is on (docs/faceplate-spec.md, Output drawer). It is a switch
like the drawer's others, so a finger has to be able to hit each of its buttons:
each is as tall as the Output mode and DoP switches' buttons, the three are one
size, and the picker sits on the Rate row's label line rather than hanging off
the row's corner past it.

Policy notes (docs/testing.md):

- Browser lane: a size and a position exist only once a stylesheet lays the
  drawer out, which server rendering never does (rule 15).
- One assertion per test; the helpers return boxes and the test judges them.
- Controls are found by wire identity only: the rail stage (`data-stage`), the
  Format tab (`data-tab`), a row's catalog key (`data-k`), the dial's block
  (`data-block`) and the picker's options (`data-pin`). No caption is read.
- The Rate row's label line has no wire identity, so it is found as the drawer
  row grammar's head line, `.fh`, inside the dial's block. A `data-testid` on
  that line would be the copy-free handle rule 9 asks for.
- The page is laid out at 1080x810, the design size and the smallest plate
  (docs/design-system.md, Plate).
- Nothing waits on a clock: locators wait on conditions, and the drawer's own
  finite animations are awaited to their end before anything is measured.
"""

from typing import Any

import pytest
from playwright.sync_api import Locator, Page, ViewportSize

from e2e.support import stack as stack_support

#: The design size, iPad 10.2" landscape in points.
VIEWPORT: ViewportSize = {"width": 1080, "height": 810}

#: Where the app keeps the Allow pinned rates preference, and its On value.
PINNED_RATES_KEY = "hqptuner.allowPinnedRates"
ON = "1"

#: The picker's three options by wire identity: Auto, the 44.1k family, the 48k family.
PIN_OPTIONS = ("auto", "f44", "f48")

#: The drawer's other switches, by catalog key: Output mode, and DoP on the stack's network backend.
REFERENCE_SWITCHES = ("output_mode", "net_dop")

#: Box edges and sizes are compared to this many pixels: layout rounds to sub-pixel steps.
TOLERANCE = 0.5

#: Ceiling on the drawer coming up. Generous: the app is on loopback and already answering.
OPEN_TIMEOUT_MS = 10_000

#: Turns the preference on before any app script reads it.
ALLOW_PINNED_RATES_JS = f"""
try {{ window.localStorage.setItem("{PINNED_RATES_KEY}", "{ON}"); }} catch (e) {{}}
"""

#: Resolves once every finite animation on the page has finished or been cancelled.
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


def switch_button_height(page: Page, key: str) -> float:
    """The height of the first shown button in the drawer row whose catalog key is `key`."""
    return float(box(page.locator(f"[data-k='{key}'] button:visible").first)["height"])


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


@pytest.mark.parametrize("key", REFERENCE_SWITCHES)
def test_each_pin_option_is_as_tall_as_the_drawers_switch_in_row(
    page: Page, stack: stack_support.Stack, key: str
) -> None:
    open_format_tab(page, stack)
    reference = switch_button_height(page, key)
    heights = [float(b["height"]) for b in pin_boxes(page)]
    matches = [abs(height - reference) <= TOLERANCE for height in heights]
    assert matches == [True] * len(PIN_OPTIONS), f"pin option heights {heights}, {key} button {reference}"


def test_the_pin_options_are_one_width(page: Page, stack: stack_support.Stack) -> None:
    open_format_tab(page, stack)
    widths = [float(b["width"]) for b in pin_boxes(page)]
    assert max(widths) - min(widths) <= TOLERANCE, f"pin option widths {widths}"


def test_the_pin_picker_sits_within_the_rate_rows_label_line(page: Page, stack: stack_support.Stack) -> None:
    open_format_tab(page, stack)
    picker, line = picker_box(page), rate_label_line_box(page)
    assert overhang(picker, line) <= TOLERANCE, f"picker {picker}, label line {line}"
