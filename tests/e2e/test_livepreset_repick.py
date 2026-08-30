"""Browser end-to-end pins on what a pick in the Live preset picker sends the engine.

Picking a live preset applies that preset's stored settings to the running
engine: the app sends the engine the batch of control-API commands the preset
carries (docs/architecture.md, the live lane). The behavior under change is the
SECOND pick of the SAME row — picking the preset that is already the picker's
current selection applies it again, where before it sent nothing at all.

Why these cases are here and not in `tests/js/components/livepresetscard.test.js`:
the CONTROL-API BATCH is what they observe, and that batch only exists once a
real browser drives the real app against the whole stack. What a pick does to
the app's own wire — which apply request it fires, and how many — is observable
in the JS suite, which fires an option row's own handler through the renderer's
vnode seam and counts the applies the fake was handed; those counts are pinned
there and are not this suite's job.

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
  button is addressed by the `data-testid` it carries, never by its caption.
- `clean_slate` removes the preset a case saved, so nothing here leaks into the
  next test in the session.

NOT covered here: that picking the PLACEHOLDER row applies nothing. It is a
deterministic negative on the app's own wire and it is pinned in the JS suite
(`test_picking_the_placeholder_row_applies_nothing`), where the fake answers
every request it is handed and a wire that went quiet is a real condition. A
regression that applied the placeholder row turns that case red, not this suite.
"""

import time

from playwright.sync_api import Locator, Page, expect

from e2e.support.stack import Stack

#: Bounded waits, in ms — ceilings on a condition poll, never a duration
#: anything is expected to take.
LOAD_MS = 30_000
SETTLE_MS = 20_000

#: Gap between passes of the control-log poll. Not a wait anything is expected
#: to take — it is how often the question gets asked again.
POLL_S = 0.05

#: The Live preset picker's own control wrapper.
PICKER = "[data-testid='live-preset']"

#: The picker's own button. It carries the `disabled` attribute while an apply
#: is in flight and loses it when the call settles, so its enabled state is the
#: positive completion signal these cases anchor a baseline on.
PICKER_BUTTON = f"{PICKER} [role='combobox']"

#: The card's Save control, by the machine identity it carries.
SAVE = "[data-testid='live-preset-save']"

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
    """Open the card's inline name prompt, through the Save button's own machine identity."""
    page.locator(SAVE).click()
    page.locator("input#ask-field").wait_for(state="visible", timeout=SETTLE_MS)


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
    page.locator(PICKER_BUTTON).click()
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


def settled_after_pick(page: Page, stack: Stack, before: int) -> int:
    """Wait for the apply a pick started to finish, and report the write count.

    Two positive conditions, in order: the batch has STARTED (a write past
    `before` reached the control fake) and it has FINISHED (the picker button
    has lost the `disabled` attribute it wears while an apply is in flight).
    Silence is never read as completion — a batch that stalls mid-flight would
    otherwise set a baseline its own leftovers go on to satisfy, and the case
    would pass on the FIRST pick's traffic.
    """
    wait_for_growth(stack, before)
    expect(page.locator(PICKER_BUTTON)).to_be_enabled(timeout=SETTLE_MS)
    return writes(stack)


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
    click on the same row is the one under test. Two things guard the case: the
    baseline is taken on the picker going IDLE rather than on the wire going
    quiet, so nothing the first pick left in flight is counted for the second;
    and the selection really being the preset is waited on before the second
    click, so the case cannot pass against a picker that applies only on a
    CHANGE of value. The button names the current selection, and for this picker
    a preset's wire value IS its name, so that wait reads data and not copy.
    """
    stocked_picker(page, stack)
    before = settled_writes(stack)
    pick(page, PRESET)
    baseline = settled_after_pick(page, stack, before)
    expect(page.locator(PICKER_BUTTON)).to_contain_text(PRESET)
    pick(page, PRESET)
    assert wait_for_growth(stack, baseline) > baseline
