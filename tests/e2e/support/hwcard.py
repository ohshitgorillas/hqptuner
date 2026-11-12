"""Drives the System tab's Hardware acceleration card in a browser.

Finds the card, reads its six settings and its buttons, changes a setting the
way a user does, and waits on conditions.

Every wait is a bounded poll on a condition, or two animation frames, never a
duration (docs/testing.md rule 7). Controls are addressed by machine identity
only (rule 9). Helpers hand back what they read; the cases assert it (rule 14).
"""

from urllib.parse import urlparse

from playwright.sync_api import Locator, Page, Request, Response, expect
from playwright.sync_api import TimeoutError as PlaywrightTimeout

from e2e.support.stack import Stack

#: The REST path the card reads the daemon's hardware settings from.
ENGINE_PATH = "/api/engine"

#: Bounded waits, in ms: ceilings on a condition poll, never a duration anything
#: is expected to take.
LOAD_MS = 30_000
SETTLE_MS = 20_000
APPLY_MS = 90_000

SYSTEM_TAB = "[data-testid='tab-system']"
APPLY = "[data-testid='hw-apply']"
REVERT = "[data-testid='hw-revert']"

#: The card itself: whatever section encloses its apply button.
CARD = f"section:has({APPLY})"

#: The dirty marking, and the status line, by their own classes.
DIRTY = "primary"
STATUS = f"{CARD} .hw-status"

#: The status line's machine-readable OUTCOME, carried as a class token beside
#: `hw-status`. Contract, unlike the sentence the line reads (rule 9): the token
#: is what a caller can tell apart, the wording is the owner's.
BUSY = "busy"
OK = "ok"
ERR = "err"

#: How each of the card's six settings is driven. The kind is the control the
#: setting renders as, because a radio group, a checkbox and a number box are
#: changed in three different ways — which is exactly why "any of them" is swept
#: rather than represented by whichever one happens to render first.
RADIO = "radio"
CHECKBOX = "checkbox"
NUMBER = "number"

CUDA_DEV = "cuda_dev"

SETTINGS = [
    ("cuda_offload", RADIO),
    (CUDA_DEV, NUMBER),
    ("cuda_cdev", NUMBER),
    ("multicore_dsp", RADIO),
    ("ecore_allocation", RADIO),
    ("blocks_per_cycle", CHECKBOX),
]

#: What one control's inputs read right now, collapsed to a single string: a
#: number box contributes its value, a radio or a checkbox its value and whether
#: it is checked. Enough to say "this setting moved" and "this setting is back",
#: for all three kinds, without naming any structure inside the control.
_SIGNATURE = (
    "(root) => [...root.querySelectorAll('input')]"
    "  .map(el => (el.type === 'radio' || el.type === 'checkbox')"
    "    ? el.value + ':' + el.checked : el.value)"
    "  .join('|')"
)


#: The `_SIGNATURE` reader, reproduced for `page.wait_for_function`: it runs
#: inside the browser's own event loop, polled by Playwright itself
#: (docs/testing.md rule 7 — a bounded poll on a condition). `selector` is a
#: full CSS selector (already including `CARD`), never just the `data-k` — the
#: page, not this module, does the finding.
_SIGNATURE_AT = (
    "([selector, want, differs]) => {"
    "  const root = document.querySelector(selector);"
    "  if (!root) return false;"
    "  const sig = [...root.querySelectorAll('input')]"
    "    .map(el => (el.type === 'radio' || el.type === 'checkbox') ? el.value + ':' + el.checked : el.value)"
    "    .join('|');"
    "  return differs ? sig !== want : sig === want;"
    "}"
)


def wait_for_signature(page: Page, key: str, want: str, *, differs: bool = False, timeout_ms: int = SETTLE_MS) -> None:
    """Wait, in the browser's own event loop, for `key`'s signature to equal (or differ from) `want`."""
    page.wait_for_function(_SIGNATURE_AT, arg=[f"{CARD} [data-k='{key}']", want, differs], timeout=timeout_ms)


def wait_for_every_setting(page: Page, want: str, timeout_ms: int = SETTLE_MS) -> None:
    """Wait until every one of the six settings' signatures, joined the way `every_setting` reads them, equal `want`."""
    selectors = [f"{CARD} [data-k='{key}']" for key, _ in SETTINGS]
    page.wait_for_function(
        "([selectors, want]) => {"
        "  const sig = (root) => [...root.querySelectorAll('input')]"
        "    .map(el => (el.type === 'radio' || el.type === 'checkbox') ? el.value + ':' + el.checked : el.value)"
        "    .join('|');"
        "  const parts = selectors.map((s) => { const r = document.querySelector(s); return r ? sig(r) : null; });"
        "  return !parts.includes(null) && parts.join('|') === want;"
        "}",
        arg=[selectors, want],
        timeout=timeout_ms,
    )


def wait_for_status_to_change_from(page: Page, previous: str, timeout_ms: int = SETTLE_MS) -> None:
    """Wait until the status line reads something other than empty or `previous` — a round trip concluding."""
    page.wait_for_function(
        "(previous) => {"
        f"  const el = document.querySelector({STATUS!r});"
        "  if (!el) return false;"
        "  const text = el.textContent.trim();"
        "  return text !== '' && text !== previous;"
        "}",
        arg=previous,
        timeout=timeout_ms,
    )


def wait_for_concluded_applies(page: Page, count: int, timeout_ms: int = SETTLE_MS) -> None:
    """Wait until the page's own fetch-counting init script has seen at least `count` engine applies conclude."""
    page.wait_for_function("(count) => (window.__engine_applies || 0) >= count", arg=count, timeout=timeout_ms)


def open_system_tab(page: Page, stack: Stack) -> None:
    """Load the SPA and bring up the System tab, where the hardware card lives."""
    page.goto(stack.base_url)
    page.wait_for_selector("footer.pending-bar", timeout=LOAD_MS)
    page.locator(SYSTEM_TAB).click()
    page.wait_for_selector("section.card", timeout=LOAD_MS)


def open_hardware_card(page: Page, stack: Stack) -> None:
    """Bring up the System tab with the hardware card's controls on screen.

    The card renders open — it is not a disclosure — so the tab click is the
    whole of getting to it and the buttons are simply waited for.
    """
    open_system_tab(page, stack)
    page.wait_for_selector(APPLY, timeout=SETTLE_MS)


def control(page: Page, key: str) -> Locator:
    """The card's control for one hardware setting, by the `data-k` it carries."""
    return page.locator(f"{CARD} [data-k='{key}']")


def signature(page: Page, key: str) -> str:
    """What one setting's control currently reads, across whichever inputs it has."""
    return str(control(page, key).evaluate(_SIGNATURE))


def every_setting(page: Page) -> str:
    """What all six settings read right now, collapsed to one string.

    The reading "every one of them was restored" needs one value, not six
    assertions: a revert that put five back and dropped the sixth differs from
    this by exactly the sixth.
    """
    return "|".join(signature(page, key) for key, _ in SETTINGS)


def loaded_card(page: Page, stack: Stack) -> None:
    """Open the card and wait until its settings carry what the daemon reported.

    A PRECONDITION, not a result: until the load has landed there is no snapshot,
    so a case that edited a setting before it would be asking a question about a
    card that is not in the state the case is about. The card renders its
    defaults before the read answers, so nothing on screen says the load landed;
    the read's own answer arriving, then two frames for the card to take it in,
    does, and says nothing about which values it carried.
    """
    with page.expect_response(is_engine_answer, timeout=LOAD_MS):
        open_hardware_card(page, stack)
    flush_frames(page)


def is_engine_read(request: Request) -> bool:
    """Whether a request is the card's read of the daemon's hardware settings."""
    return request.method == "GET" and urlparse(request.url).path == ENGINE_PATH


def is_engine_answer(response: Response) -> bool:
    """Whether a response answers the card's read of the daemon's hardware settings."""
    return is_engine_read(response.request)


def flush_frames(page: Page) -> None:
    """Let two animation frames pass, so any post-render effect has run."""
    page.wait_for_function(
        "() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
        timeout=SETTLE_MS,
    )


def bumped(value: str) -> str:
    """A value the box does not already hold, so writing it is a real change."""
    try:
        return str(int(float(value)) + 1)
    except ValueError:
        return f"{value}1"


def set_number_setting(page: Page, key: str) -> str:
    """Type a new value into a number setting and COMMIT it, the way a user does.

    Filling alone raises `input`; the value is not the control's until focus
    leaves the box and `change` fires, which is what tabbing away does. Handing
    back the value typed, so a case can ask whether that value reached the daemon.
    """
    box = control(page, key).locator("input[type='number']")
    want = bumped(box.input_value())
    box.fill(want)
    box.press("Tab")
    expect(box).to_have_value(want, timeout=SETTLE_MS)
    return want


def _toggle_checkbox_setting(page: Page, key: str) -> None:
    control(page, key).locator("input[type='checkbox']").click()


def _pick_another_radio(page: Page, key: str) -> None:
    """Choose whichever option of a radio group is not the one in force."""
    radios = control(page, key).locator("input[type='radio']")
    other = next(i for i in range(radios.count()) if not radios.nth(i).is_checked())
    radios.nth(other).click()


def change_setting(page: Page, key: str, kind: str) -> str:
    """Move one hardware setting away from what the daemon reported; hand back its old reading.

    Takes the card as already loaded — it never navigates, so a case that has put
    the card into some state (a status message, say) still has it afterwards.

    The change is waited for on the CONTROL's own inputs — weaker than anything a
    case asserts about the buttons, so no case can be made vacuous by its own
    setup.
    """
    was = signature(page, key)
    if kind == NUMBER:
        set_number_setting(page, key)
    elif kind == CHECKBOX:
        _toggle_checkbox_setting(page, key)
    else:
        _pick_another_radio(page, key)
    wait_for_signature(page, key, was, differs=True)
    flush_frames(page)
    return was


def apply_classes(page: Page) -> list[str]:
    """The class tokens the apply button carries right now."""
    return [str(token) for token in page.locator(APPLY).evaluate("el => [...el.classList]")]


def status_text(page: Page) -> str:
    """What the card's status line reads. The element is always rendered, and
    reads empty when the card has nothing to say."""
    return str(page.locator(STATUS).evaluate("el => el.textContent.trim()"))


def saw_outcome(page: Page, outcome: str, timeout_ms: int = SETTLE_MS) -> bool:
    """Whether the status line ever carries `outcome` before the ceiling passes.

    A bounded poll on a condition, not a wait for a duration (docs/testing.md
    rule 7) — but one that hands back WHAT IT SAW, because an outcome can be
    transient: `busy` lasts as long as the round trip and `ok` clears itself, so
    a case that waited and then read the class back would be asking about a
    moment that has already gone. Waiting for the very thing a case asserts
    cannot make it vacuous here: a poll that runs out returns False and the case
    fails on its own assertion.
    """
    try:
        page.wait_for_selector(f"{STATUS}.{outcome}", state="attached", timeout=timeout_ms)
    except PlaywrightTimeout:
        return False
    return True
