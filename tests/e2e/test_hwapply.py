"""Browser end-to-end pins on the Hardware acceleration card's apply/revert marking.

What the card promises: it snapshots the six engine settings it loaded from the
daemon, marks its apply button while any of them differs from that snapshot,
restores every one of them on revert, keeps both buttons enabled at all times,
and drops a stale status message the moment a field is changed.

Why these cases are here and not in `tests/js/components/hardware-apply.test.js`:
the snapshot is taken in the card's load, which runs in a `useEffect`, and
`preact-render-to-string` never runs one — so under SSR the card is always
unloaded and there is no snapshot to differ from. The six settings are module-private
signals with no public writer, and exporting one to reach the dirty state would
widen the public surface to serve a test, which `docs/testing.md` ("Branches that
cannot be reached") forbids. Here the load really runs against the wire fake and
a real edit really fires, so the dirty state is observable the way a user makes
it. The SSR suite keeps the clean-state contrast.

The fake serves `<engine cuda="1" multicore="1" nblocks="16" cuda_dev="-1">`
(`tests/support/fake_config_xml.py:60-63`), so the card loads real, non-default
values and "the value the daemon reported" is a value the test can read back
rather than a blank.

Policy notes (docs/testing.md):

- One assertion per test. `expect()` is invisible to the assertion gate and is
  not used as the assertion; the helpers below do the WAITING and each case makes
  exactly one plain `assert`.
- No test waits on the wall clock. Every wait is a bounded poll on a condition,
  and `flush_frames` waits two animation frames — frames, not a duration — which
  is what stands between an edit landing in the DOM and everything the component
  does about it having happened.
- Waits are weaker than the assertion they precede, so no wait can make its
  assertion vacuous: the cases about the marking wait for the EDIT to land (on
  the input's own value) and then assert what the BUTTON did about it, never for
  the marking they are about to assert.
- Controls are addressed by machine identity only (rule 9): `data-testid` for the
  System tab and both buttons, the `primary` class for the marking, the
  `hw-status` class for the message. No caption is selected on or asserted.
- The card is found as the section enclosing its own apply button rather than by
  a card id, and the field a case edits is whichever of the card's own settings a
  user can type into — so neither is pinned to a layout decision.
- The stack is session-scoped and its state persists between tests, so each case
  reads the value it is about to change rather than assuming a starting one.
"""

from playwright.sync_api import Page
from playwright.sync_api import TimeoutError as PlaywrightTimeout

from e2e.support.stack import Stack

#: Bounded waits, in ms: ceilings on a condition poll, never a duration anything
#: is expected to take. `PROBE_MS` is the short one used where a MISS is a normal
#: answer (is the card already open?), not a failure.
LOAD_MS = 30_000
SETTLE_MS = 20_000
PROBE_MS = 3_000

SYSTEM_TAB = "[data-testid='tab-system']"
APPLY = "[data-testid='hw-apply']"
REVERT = "[data-testid='hw-revert']"

#: The card itself: whatever section encloses its apply button.
CARD = f"section:has({APPLY})"

#: A hardware setting the user can type a value into. Both input flavors are
#: accepted so the case does not depend on which of the six is rendered first.
FIELD = f"{CARD} input[type='number'], {CARD} input[type='text']"

#: The dirty marking, and the status line, by their own classes.
DIRTY = "primary"
STATUS = f"{CARD} .hw-status"


def open_system_tab(page: Page, stack: Stack) -> None:
    """Load the SPA and bring up the System tab, where the hardware card lives."""
    page.goto(stack.base_url)
    page.wait_for_selector("footer.pending-bar", timeout=LOAD_MS)
    page.locator(SYSTEM_TAB).click()
    page.wait_for_selector("section.card", timeout=LOAD_MS)


def open_hardware_card(page: Page, stack: Stack) -> None:
    """Bring up the System tab with the hardware card's controls on screen.

    A card on this tab may be a disclosure that starts closed, and a closed one
    renders no buttons to click, so any closed card is opened before the wait for
    the apply button. Which cards those are is a disclosure decision rather than a
    behavior, so they are opened by the `closed` state their own section carries
    instead of by naming this card's id.
    """
    open_system_tab(page, stack)
    try:
        page.wait_for_selector(APPLY, timeout=PROBE_MS)
    except PlaywrightTimeout:
        heads = page.locator("section.card.closed .card-head")
        for index in range(heads.count()):
            heads.nth(index).click()
    page.wait_for_selector(APPLY, timeout=SETTLE_MS)


def loaded_card(page: Page, stack: Stack) -> None:
    """Open the card and wait until its settings carry what the daemon reported.

    A PRECONDITION, not a result: until the load has landed there is no snapshot,
    so a case that edited a field before it would be asking a question about a
    card that is not in the state the case is about. A non-empty value is the
    weakest reading of "the load landed" — it says nothing about which value.
    """
    open_hardware_card(page, stack)
    page.wait_for_function(
        "(selector) => { const el = document.querySelector(selector);  return el !== null && el.value !== ''; }",
        arg=FIELD,
        timeout=SETTLE_MS,
    )


def flush_frames(page: Page) -> None:
    """Let two animation frames pass, so any post-render effect has run."""
    page.wait_for_function(
        "() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
        timeout=SETTLE_MS,
    )


def field_value(page: Page) -> str:
    """What the edited hardware setting currently reads, as the browser reports it."""
    return str(page.evaluate("(selector) => document.querySelector(selector).value", FIELD))


def bumped(value: str) -> str:
    """A value the field does not already hold, so writing it is a real change."""
    try:
        return str(int(float(value)) + 1)
    except ValueError:
        return f"{value}1"


def change_field(page: Page) -> str:
    """Edit one hardware setting away from what the daemon reported; hand back the old value.

    Takes the card as already loaded — it never navigates, so a case that has put
    the card into some state (a status message, say) still has it afterwards.

    The edit is waited for on the INPUT's own value — weaker than anything a case
    asserts about the buttons, so no case can be made vacuous by its own setup.
    """
    was = field_value(page)
    page.locator(FIELD).first.fill(bumped(was))
    page.wait_for_function(
        "([selector, want]) => { const el = document.querySelector(selector);"
        "  return el !== null && el.value === want; }",
        arg=[FIELD, bumped(was)],
        timeout=SETTLE_MS,
    )
    flush_frames(page)
    return was


def apply_classes(page: Page) -> list[str]:
    """The class tokens the apply button carries right now."""
    return [token for token in (page.locator(APPLY).get_attribute("class") or "").split() if token]


def status_text(page: Page) -> str:
    """What the card's status line reads, or "" when it renders none at all."""
    return str(
        page.evaluate(
            "(selector) => { const el = document.querySelector(selector);"
            "  return el === null ? '' : el.textContent.trim(); }",
            STATUS,
        )
    )


def apply_and_wait_for_a_message(page: Page) -> None:
    """Click apply and poll until the card has SOMETHING to say about it.

    Which message is the owner's copy and is neither selected on nor asserted
    (docs/testing.md rule 9); that a message is there at all is the precondition
    the stale-message case needs.
    """
    page.locator(APPLY).click()
    page.wait_for_function(
        "(selector) => { const el = document.querySelector(selector);"
        "  return el !== null && el.textContent.trim() !== ''; }",
        arg=STATUS,
        timeout=SETTLE_MS,
    )


# --- the dirty marking --------------------------------------------------------


def test_a_freshly_loaded_card_leaves_the_apply_button_unmarked(page: Page, stack: Stack) -> None:
    """Nothing differs from what was loaded, so there is nothing to apply."""
    loaded_card(page, stack)
    flush_frames(page)
    assert DIRTY not in apply_classes(page)


def test_changing_a_hardware_field_marks_the_apply_button(page: Page, stack: Stack) -> None:
    """A value away from the snapshot is an unapplied change, and the button says so."""
    loaded_card(page, stack)
    change_field(page)
    assert DIRTY in apply_classes(page)


def test_reverting_returns_the_apply_button_to_unmarked(page: Page, stack: Stack) -> None:
    """Revert puts the settings back, so the card is clean again and the marking goes."""
    loaded_card(page, stack)
    change_field(page)
    page.locator(REVERT).click()
    flush_frames(page)
    assert DIRTY not in apply_classes(page)


def test_reverting_restores_the_field_to_the_value_the_daemon_reported(page: Page, stack: Stack) -> None:
    """Revert is a restore of the snapshot, not merely a clearing of the marking."""
    loaded_card(page, stack)
    was = change_field(page)
    page.locator(REVERT).click()
    flush_frames(page)
    assert field_value(page) == was


def test_applying_leaves_the_card_reading_clean(page: Page, stack: Stack) -> None:
    """A successful apply re-snapshots, so what was just applied is no longer a change.

    Not vacuous: the card is provably MARKED on the way in — the same edit as
    `test_changing_a_hardware_field_marks_the_apply_button`, which pins that — and
    the wait for a status message is what says the apply round-tripped, rather
    than only that the click landed.
    """
    loaded_card(page, stack)
    change_field(page)
    apply_and_wait_for_a_message(page)
    flush_frames(page)
    assert DIRTY not in apply_classes(page)


# --- the status message -------------------------------------------------------


def test_changing_a_field_clears_the_status_message(page: Page, stack: Stack) -> None:
    """A message about the last apply is stale the moment a setting moves again."""
    loaded_card(page, stack)
    apply_and_wait_for_a_message(page)
    change_field(page)
    assert status_text(page) == ""


# --- neither button is ever disabled ------------------------------------------


def test_the_apply_button_is_enabled_while_the_card_is_dirty(page: Page, stack: Stack) -> None:
    """User actions always proceed: a change is applicable whatever the engine is doing."""
    loaded_card(page, stack)
    change_field(page)
    assert page.locator(APPLY).is_disabled() is False


def test_the_revert_button_is_enabled_on_a_clean_card(page: Page, stack: Stack) -> None:
    """Nothing disables revert either, not even having nothing to revert."""
    loaded_card(page, stack)
    flush_frames(page)
    assert page.locator(REVERT).is_disabled() is False
