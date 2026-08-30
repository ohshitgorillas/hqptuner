"""Browser end-to-end pins on what a pick in the Live preset picker sends the engine.

Picking a live preset applies that preset's stored settings to the running
engine: the app sends the engine the batch of control-API commands the preset
carries (docs/architecture.md, the live lane). The behavior under change is the
SECOND pick of the SAME row — picking the preset that is already the picker's
current selection applies it again, where before it sent nothing at all.

Why these cases are here and not in `tests/js/components/livepresetscard.test.js`:
a pick is a pointer event on an option row, and `preact-render-to-string` fires
no handler, so the SSR harness can observe the picker's markup and never what a
pick does. The batch only exists on the wire, and only a real browser driving
the real app against the control fake puts it there.

What is observed is `stack.control_log` — every control-API (port 4321) command
the app has sent this session, in order. It is cumulative across the session and
it records READS as well as writes: the app polls `State` and `Status` for as
long as the page is open, so its raw length grows on its own and says nothing.
What a pick puts on the wire is a batch of SETTERS, so these cases count only
the setter vocabulary (`WRITES`, protocol.md §6) and ask whether that count grew
past a baseline they took first. Counting rather than naming is deliberate:
WHICH settings a preset carries depends on what the engine held when it was
saved, and pinning that would pin the fixture rather than the behavior.

Policy notes (docs/testing.md):

- One assertion per test. Playwright's `expect()` is invisible to the assertion
  gate and is not used as the assertion: the helpers below do the WAITING and
  each case makes exactly one plain `assert`.
- No test waits on the wall clock. Every wait here is a BOUNDED POLL ON A
  CONDITION and every ceiling is a ceiling, never a duration anything is
  expected to take. `wait_for_growth` runs out quietly rather than raising, so a
  case that does not get its batch fails on its own assertion instead of inside
  its setup.
- Controls are addressed by machine identity only (rule 9): `data-testid` for
  the LIVE switch and the picker, `data-v` for each option row (for this picker
  the wire value of a preset row is the preset's name, and the placeholder row's
  is the empty string), `role="combobox"` for the picker button, and the shared
  `#ask-field` the inline name prompt renders. No caption is clicked and no
  wording is asserted.
- The preset a case picks is created through the card's own Save flow, in the
  browser, because that is the only way a browser has to make one. The Save
  button carries no machine identity of its own, so `open_name_prompt` finds it
  by what it DOES — the one action button on the card that opens a name prompt —
  rather than by the words on it.
- `clean_slate` removes the preset a case saved, so nothing here leaks into the
  next test in the session.

NOT covered here, and deliberately so: that picking the PLACEHOLDER row applies
nothing. Stating "no command followed" needs either a fixed wall-clock wait,
which rule 7 forbids outright, or a positive condition that necessarily comes
after any batch would have been dispatched, and the picker offers none — the pop
closing says the click was handled, not that the app has finished deciding what
to send. A case anchored on the pop closing would pass whether or not a batch
was on its way, so none is written. A regression that applied the placeholder
row would pass this suite.
"""

import time

from playwright.sync_api import Locator, Page
from playwright.sync_api import TimeoutError as PlaywrightTimeout

from e2e.support.stack import Stack

#: Bounded waits, in ms — ceilings on a condition poll, never a duration
#: anything is expected to take.
LOAD_MS = 30_000
SETTLE_MS = 20_000

#: Ceiling on "did clicking THIS button open the name prompt". Short because it
#: is asked once per action button while identifying the Save control, and the
#: negative answer is the useful one for every button that is not Save.
PROBE_MS = 3_000

#: Gap between passes of the control-log poll. Not a wait anything is expected
#: to take — it is how often the question gets asked again.
POLL_S = 0.05

#: The Live preset picker's own control wrapper.
PICKER = "[data-testid='live-preset']"

#: The card the picker sits in: whatever section encloses it, so nothing here is
#: pinned to a card id or to the page order. `section.card` and not `section`:
#: the tab body is a section too, and matching it as well is a strict-mode
#: violation, not a wider net.
CARD = f"section.card:has({PICKER})"

#: The picker's placeholder row — the empty-valued first row, which selects no
#: preset at all.
PLACEHOLDER = ""

#: The name the cases save their preset under. Arbitrary, and unique enough that
#: it cannot collide with the daemon's own furniture.
PRESET = "E2E Repick"

#: The control API's setter vocabulary (protocol.md §6) — the commands that MOVE
#: the engine, as against the reads (`State`, `Status`, `Get*`, ...) the app
#: keeps sending for as long as a page is open. Applying a preset is a batch of
#: these, so these are what a case counts.
WRITES = frozenset(
    {
        "SetMode",
        "SetFilter",
        "SetShaping",
        "SetRate",
        "SetJunkFilter",
        "SetAdaptiveVolume",
        "Volume",
        "MatrixSetProfile",
    }
)

#: How many consecutive quiet passes end a quiescence poll. The condition is
#: "the batch has stopped arriving", not any length of time: the passes are how
#: many times in a row the answer has to keep being no.
STILL_PASSES = 6


def enter_live(page: Page, stack: Stack) -> None:
    """Load the SPA, force the LIVE switch on, and wait for the preset picker."""
    page.goto(stack.base_url)
    page.wait_for_selector("footer.pending-bar", timeout=LOAD_MS)
    switch = page.locator("[data-testid='live-toggle']")
    # The switch latches, so it is driven to the on state rather than toggled.
    if switch.get_attribute("aria-pressed") != "true":
        switch.click()
    page.wait_for_selector(PICKER, timeout=LOAD_MS)


def open_name_prompt(page: Page) -> None:
    """Open the card's inline name prompt, by trying each of its action buttons.

    The Save and Delete buttons carry no `data-testid`, and their captions are
    owner copy that a test may not select on (rule 9). So the Save button is
    identified by the one thing that tells it apart by machine: clicking it puts
    the shared name field on screen. Anything else that opens (the delete
    confirm) is dismissed with Escape, which `Ask` documents as the way out.
    """
    field = page.locator("input#ask-field")
    buttons = page.locator(f"{CARD} .live-preset-actions button")
    for index in range(buttons.count()):
        button = buttons.nth(index)
        if not button.is_enabled():
            continue
        button.click()
        try:
            field.wait_for(state="visible", timeout=PROBE_MS)
        except PlaywrightTimeout:
            page.keyboard.press("Escape")
            continue
        return


def save_preset(page: Page, name: str) -> None:
    """Save the running settings as a live preset called `name`, through the card's own flow."""
    open_name_prompt(page)
    field = page.locator("input#ask-field")
    field.fill(name)
    # Enter commits the name prompt (components/Ask.js); the button beside it
    # says a word this test is not allowed to read.
    field.press("Enter")
    field.wait_for(state="detached", timeout=SETTLE_MS)


def row(page: Page, value: str) -> Locator:
    """The picker's option row carrying the wire value `value`."""
    return page.locator(f"{PICKER} .dd-pop [data-v='{value}']")


def pick(page: Page, value: str) -> None:
    """Open the picker and click the row carrying `value`."""
    page.locator(f"{PICKER} [role='combobox']").click()
    option = row(page, value)
    option.wait_for(state="visible", timeout=SETTLE_MS)
    option.click()


def writes(stack: Stack) -> int:
    """How many engine-moving commands the app has sent this session, reads excluded."""
    return sum(1 for name, _ in stack.control_log if name in WRITES)


def wait_for_growth(stack: Stack, baseline: int, timeout_ms: int = SETTLE_MS) -> int:
    """Poll until more writes than `baseline` have gone out, and report the count.

    Runs out quietly: a case that never gets its batch fails on its own
    assertion rather than inside this helper.
    """
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline and writes(stack) <= baseline:
        time.sleep(POLL_S)
    return writes(stack)


def settled_writes(stack: Stack, timeout_ms: int = SETTLE_MS) -> int:
    """Poll until the write count has stopped moving, and report where it stopped.

    A batch arrives as several commands, so a baseline taken the instant the
    first one lands would charge the rest of that batch to whatever the case
    does next. The condition polled is "no further write for `STILL_PASSES`
    consecutive passes", which is a condition and not a duration: nothing here
    asserts, or may assert, that a batch takes any particular time to arrive.
    """
    deadline = time.monotonic() + timeout_ms / 1000
    count = writes(stack)
    still = 0
    while time.monotonic() < deadline and still < STILL_PASSES:
        time.sleep(POLL_S)
        now = writes(stack)
        still = still + 1 if now == count else 0
        count = now
    return count


def stocked_picker(page: Page, stack: Stack) -> None:
    """Enter LIVE, save one preset, and leave the picker sitting on the placeholder."""
    enter_live(page, stack)
    save_preset(page, PRESET)
    pick(page, PLACEHOLDER)


def test_picking_a_live_preset_sends_the_engine_a_batch_of_commands(page: Page, stack: Stack) -> None:
    """A pick applies the preset: engine-moving commands follow it."""
    stocked_picker(page, stack)
    baseline = settled_writes(stack)
    pick(page, PRESET)
    assert wait_for_growth(stack, baseline) > baseline


def test_picking_the_preset_already_selected_sends_a_second_batch(page: Page, stack: Stack) -> None:
    """Re-picking the current selection applies it again, where before it sent nothing.

    The first pick is what makes the preset the current selection, so the second
    click on the same row is the one under test, and the baseline is taken once
    the first pick's batch has finished arriving — so what is counted is traffic
    the SECOND click caused and nothing the first one left in flight.
    """
    stocked_picker(page, stack)
    pick(page, PRESET)
    baseline = settled_writes(stack)
    pick(page, PRESET)
    assert wait_for_growth(stack, baseline) > baseline
