"""How the rate dial's glass looks under the pin picker, on screen.

The Output drawer's rate dial prints both rates of every tier, its 44.1k-family
value and its 48k-family value (docs/faceplate-spec.md, Output drawer). Under
Auto every value reads alike; picking a family is rate-picking mode, and there the
glass sets the other family's values apart while the picked family's look as they
did under Auto, every value still on screen. The claim holds on the tier the
running band's needle sits on as on any other tier, and the needle's tier is
the one read here.

Each test opens the drawer with pinned rates allowed and picks a family. One
reads a value's rendered look under Auto and again after the pick; the other
reads the tier's two values after the pick and compares them with each other.
A look is only ever compared with another observed look, never with a literal
colour.

Policy notes (docs/testing.md):

- Browser lane: the rendered suite already pins the markup; what a stylesheet
  does with it, including a rule keyed on an ancestor of the value, exists only
  once a browser computes the style (rule 15).
- The look of a value is its computed paint (fill, stroke, colour, weight,
  decoration, visibility) plus the opacity and filters it inherits from every
  element between it and the dial. Nothing here names a class or a token.
- Controls and values are found by wire identity: the rail stage (`data-stage`),
  the Format tab (`data-tab`), the picker's options (`data-pin`, picked reads
  `aria-checked`), the dial's band (`data-band`) and tier (`data-i`, PCM 1x..32x
  as 0..5), and a value by its number alone, in kHz or Hz.
- The running band is PCM: the stack's control fake is configured to mode 1. Its
  needle sits on the PCM limit the HTTP fake serves, read from the fake at test
  time, so the needle's tier follows the fixture.
- Picking a family writes nothing, so the pick leaves the session's daemon as it
  found it.
- Nothing waits on a clock: locators wait on conditions, and every finite
  animation (a colour transition included) is awaited to its end before a look is
  read.
"""

from typing import Any

import pytest
from playwright.sync_api import Page, ViewportSize

from e2e.support import stack as stack_support

#: The design size, iPad 10.2" landscape in points.
VIEWPORT = ViewportSize(width=1080, height=810)

#: Where the app keeps the Allow pinned rates preference, and its On value.
PINNED_RATES_KEY = "hqptuner.allowPinnedRates"
ON = "1"

#: The Output drawer's rail stage and its Format tab.
OUTPUT_STAGE = "output"
FORMAT_TAB = "format"

#: The picker's Auto option and the two families, by wire identity.
AUTO = "auto"
F44 = "f44"
F48 = "f48"

#: The running band, PCM in the stack's control fake.
BAND = "pcm"

#: The two family bases of PCM 1x; tier `i` holds each base times 2**i.
BASE_44 = 44100
BASE_48 = 48000

#: Ceiling on the drawer coming up and settling. A ceiling on a condition, never a duration.
SETTLE_TIMEOUT = 10_000

#: Turns the preference on before any app script reads it.
ALLOW_PINNED_RATES_JS = f"""
try {{ window.localStorage.setItem("{PINNED_RATES_KEY}", "{ON}"); }} catch (e) {{}}
"""

#: True once the real fonts are in and every animation that ends has ended.
SETTLED_JS = """
() => document.fonts.status === "loaded" &&
  document.getAnimations().every(
    (a) => a.effect === null || a.effect.getComputedTiming().iterations === Infinity || a.playState !== "running",
  )
"""

#: The rendered look of the value `hz` on tier `tier` of band `band`: the smallest
#: element in the tier whose text reads that rate in kHz or Hz, its own computed
#: paint, and the opacity and filters it inherits from every element up to the
#: dial. Null when the tier prints no such value.
LOOK_JS = """
({ band, tier, hz }) => {
  const dial = document.querySelector('#drawer-output .dial[role="group"]');
  if (dial === null) return null;
  const group = dial.querySelector(`g[data-band="${band}"] g[data-i="${tier}"]`);
  if (group === null) return null;
  const re = /^(\\d+(?:\\.\\d+)?)\\s*(k|kHz|Hz)?$/i;
  const reads = (el) => {
    const m = re.exec(el.textContent.trim());
    return m !== null && [hz, hz / 1000].includes(Number(m[1]));
  };
  const hits = [...group.querySelectorAll("*")]
    .filter(reads)
    .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
  if (hits.length === 0) return null;
  const value = hits[0];
  const own = getComputedStyle(value);
  let opacity = 1;
  const filters = [];
  for (let el = value; el !== null && el !== dial.parentElement; el = el.parentElement) {
    const style = getComputedStyle(el);
    opacity *= Number(style.opacity);
    if (style.filter !== "none") filters.push(style.filter);
  }
  return {
    fill: own.fill,
    fill_opacity: own.fillOpacity,
    stroke: own.stroke,
    color: own.color,
    font_weight: own.fontWeight,
    text_decoration: own.textDecorationLine,
    visibility: own.visibility,
    opacity: String(opacity),
    filters: filters.join(" "),
  };
}
"""


def tier_of(rate: int) -> int:
    """The PCM tier whose two members include `rate`."""
    tier = 0
    while rate not in (BASE_44 << tier, BASE_48 << tier):
        tier += 1
    return tier


def needle_tier(stack: stack_support.Stack) -> int:
    """The PCM tier the running band's needle sits on: the one holding the PCM limit the HTTP fake serves."""
    return tier_of(int(stack.http_state["defaults_samplerate"]))


def members(tier: int, fam: str) -> tuple[int, int]:
    """Tier `tier`'s value in family `fam`, then its value in the other family."""
    own, other = (BASE_44 << tier, BASE_48 << tier)
    return (own, other) if fam == F44 else (other, own)


def settle(page: Page) -> None:
    """Wait until fonts are in and every finite animation has run out."""
    page.wait_for_function(SETTLED_JS, timeout=SETTLE_TIMEOUT)


def open_format_tab(page: Page, stack: stack_support.Stack) -> None:
    """Load the app with pinned rates allowed, open the Output drawer on Format under Auto, and let it settle."""
    page.set_viewport_size(VIEWPORT)
    page.add_init_script(ALLOW_PINNED_RATES_JS)
    page.goto(stack.base_url)
    page.locator(f"button[data-stage='{OUTPUT_STAGE}']").click(timeout=SETTLE_TIMEOUT)
    drawer = page.locator(f"#drawer-{OUTPUT_STAGE}")
    drawer.locator(f"[role='tab'][data-tab='{FORMAT_TAB}']").click(timeout=SETTLE_TIMEOUT)
    drawer.locator(f"[data-pin='{AUTO}'][aria-checked='true']").wait_for(state="visible", timeout=SETTLE_TIMEOUT)
    settle(page)


def pick(page: Page, fam: str) -> None:
    """Tap the picker option `fam`, wait for it to read picked, and let the glass settle."""
    page.locator(f"#drawer-{OUTPUT_STAGE} [data-pin='{fam}']").click(timeout=SETTLE_TIMEOUT)
    page.locator(f"#drawer-{OUTPUT_STAGE} [data-pin='{fam}'][aria-checked='true']").wait_for(timeout=SETTLE_TIMEOUT)
    settle(page)


def look(page: Page, tier: int, hz: int) -> dict[str, Any]:
    """The rendered look of the value `hz` on PCM tier `tier`; a tier that prints no such value has none to read."""
    found = page.evaluate(LOOK_JS, {"band": BAND, "tier": tier, "hz": hz})
    if found is None:
        raise LookupError(BAND, tier, hz)
    return dict(found)


def looks_across_pick(
    page: Page, stack: stack_support.Stack, tier: int, hz: int, fam: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    """The look of `hz` on tier `tier` under Auto, then after picking `fam`."""
    open_format_tab(page, stack)
    auto = look(page, tier, hz)
    pick(page, fam)
    return auto, look(page, tier, hz)


def looks_after_pick(
    page: Page, stack: stack_support.Stack, tier: int, fam: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    """After picking `fam`, the look of tier `tier`'s value in that family, then of its value in the other family."""
    own, other = members(tier, fam)
    open_format_tab(page, stack)
    pick(page, fam)
    return look(page, tier, own), look(page, tier, other)


FAMILIES = (F44, F48)


@pytest.mark.parametrize("fam", FAMILIES)
def test_picking_a_family_sets_the_other_familys_value_apart_from_its_auto_look_on_the_needles_tier(
    page: Page, stack: stack_support.Stack, fam: str
) -> None:
    """After a family pick, the other family's value on the needle's tier no longer looks as it did under Auto."""
    tier = needle_tier(stack)
    _, other = members(tier, fam)
    auto, picked = looks_across_pick(page, stack, tier, other, fam)
    assert picked != auto, f"tier {tier}, {other} Hz under Auto {auto}, after {fam} {picked}"


@pytest.mark.parametrize("fam", FAMILIES)
def test_picking_a_family_sets_its_value_apart_from_the_other_familys_on_the_needles_tier(
    page: Page, stack: stack_support.Stack, fam: str
) -> None:
    """After a family pick, the picked family's value on the needle's tier looks unlike the other family's."""
    own, other = looks_after_pick(page, stack, needle_tier(stack), fam)
    assert own != other, f"after {fam}, own {own}, other {other}"
