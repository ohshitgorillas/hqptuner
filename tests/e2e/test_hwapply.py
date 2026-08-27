"""Browser end-to-end pins on the Hardware acceleration card's apply/revert marking.

What the card promises: it snapshots the six engine settings it loaded from the
daemon, marks its apply button while ANY of them differs from that snapshot,
restores every one of them on revert, keeps both buttons enabled at all times,
sends what was changed to the daemon on apply, and drops a stale status message
the moment a setting is changed.

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
(`tests/support/fake_config_xml.py:59-63`), so the card loads real, non-default
values, CUDA offload is on and the two device boxes are live.

Policy notes (docs/testing.md):

- One assertion per test. `expect()` is invisible to the assertion gate and is
  not used as the assertion; the helpers below do the WAITING and each case makes
  exactly one plain `assert`. Case sweeps are `@pytest.mark.parametrize`, one
  setting per generated case, never an assert in a loop.
- No test waits on the wall clock. The clock cannot be virtualized across the
  subprocess boundary, so there are no fixed sleeps: every wait is a BOUNDED POLL
  ON A CONDITION (`settled`), and `flush_frames` waits two animation frames —
  frames, not a duration. A poll that runs out returns quietly rather than
  raising, so the case fails on its own assertion instead of inside its setup.
- Waits are weaker than the assertion they precede, so no wait can make its
  assertion vacuous: the cases about the marking wait for the EDIT to land (on
  the control's own inputs) and then assert what the BUTTON did about it, never
  for the marking they are about to assert.
- Controls are addressed by machine identity only (rule 9): `data-testid` for the
  System tab and both buttons, `data-k` for each of the six settings, the
  `primary` class for the marking, the `hw-status` class for the message. No
  caption is selected on or asserted.
- The card is found as the section enclosing its own apply button rather than by
  a card id, so it is not pinned to a layout decision. One resolution rule
  throughout: every control is a Playwright locator under that section, and every
  DOM read goes through `Locator.evaluate` on it.
- The stack is session-scoped and its state persists between tests, so each case
  reads the value it is about to change rather than assuming a starting one, and
  the applying cases put the daemon fake's engine attribute back the way
  `test_shell.py` puts `control_state` back.

NOT covered here, and deliberately so:

- **That a `warn` or `err` message does NOT self-clear.** The only way to state
  "this is still here later" is to wait a fixed amount of time and look, which is
  a wall-clock wait and forbidden outright (docs/testing.md rule 7, which allows
  a bounded poll on a condition and nothing else). There is no condition to poll
  for the absence of a future event, and the frontend has no clock to inject
  across the subprocess boundary. So the cases below pin that a failed apply
  reaches the `err` outcome and that a confirmed one clears itself; the asymmetry
  between them is unpinned. A regression that made every message self-clear would
  pass this suite.
- **The `warn` outcome** — submitted but not confirmed. The daemon fake can be
  made to answer nothing after adopting a restore (`_down` / `_die`), but that
  takes the whole 8088 lane down for a session-scoped stack that every later test
  in the run shares, and the fake's value-level rejection is keyed on the config
  `title`, which the hardware card does not write. Neither is a state this card
  can be driven into without contorting the stack, so no case claims it.
"""

import time
from collections.abc import Callable

import pytest
from playwright.sync_api import Locator, Page
from playwright.sync_api import TimeoutError as PlaywrightTimeout

from e2e.support.stack import Stack

#: Bounded waits, in ms: ceilings on a condition poll, never a duration anything
#: is expected to take.
LOAD_MS = 30_000
SETTLE_MS = 20_000
APPLY_MS = 90_000
#: Ceiling on "the confirmed message has gone again". A ceiling on a condition,
#: NOT how long the card is expected to hold the message for: nothing here
#: asserts, or may assert, that the lifetime is any particular length.
CLEAR_MS = 60_000

#: Gap between passes of a condition poll. Not a wait anything is expected to
#: take — it is how often the question gets asked again.
POLL_S = 0.05

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

#: How many POST /restore arrivals the daemon fake refuses with 503 in the case
#: about a refused apply. Large enough that a retrying writer runs out of tries
#: before the fake runs out of refusals, so the apply fails for the reason the
#: case is about rather than succeeding on a later pass.
REFUSE_EVERYTHING = 100

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

#: The same six, ordered for the case that dirties ALL of them before reverting.
#: CUDA offload goes last because turning it off takes the two device boxes out
#: of play, and a case about restoring every setting has to have moved every
#: setting first. Which settings exist is the contract; this order is only how
#: one case reaches them all.
EVERY_SETTING_IN_TURN = [entry for entry in SETTINGS if entry[0] != "cuda_offload"] + [("cuda_offload", RADIO)]

#: The engine attribute the CUDA device box writes, as the daemon fake stores it
#: (`<engine cuda_dev=…>`, `tests/support/fake_config_xml.py`). This is the
#: file-lane truth an apply has to reach: a card that printed a message and
#: dropped its marking without sending anything leaves this untouched.
CUDA_DEV_ATTR = "cuda_dev"

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


def settled(condition: Callable[[], bool], timeout_ms: int = SETTLE_MS) -> None:
    """Poll `condition` until it holds, or give up quietly when the ceiling passes.

    Bounded poll on a condition, never a fixed wait (docs/testing.md rule 7):
    what is bounded is how long the question keeps being asked, and a poll that
    runs out says nothing — the case then fails on its own assertion, which names
    the behavior, instead of raising inside its setup.
    """
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(POLL_S)


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
    card that is not in the state the case is about. A non-empty CUDA device box
    is the weakest reading of "the load landed" — it says nothing about which
    value landed.
    """
    open_hardware_card(page, stack)
    settled(lambda: signature(page, CUDA_DEV) != "")
    flush_frames(page)


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
    settled(lambda: box.input_value() == want)
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
    settled(lambda: signature(page, key) != was)
    flush_frames(page)
    return was


def apply_classes(page: Page) -> list[str]:
    """The class tokens the apply button carries right now."""
    return [token for token in (page.locator(APPLY).get_attribute("class") or "").split() if token]


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


def apply_and_wait_for_a_message(page: Page) -> None:
    """Click apply and poll until the card has SOMETHING to say about it.

    Which message is the owner's copy and is neither selected on nor asserted
    (docs/testing.md rule 9); that a message is there at all is the precondition
    the stale-message case needs.
    """
    page.locator(APPLY).click()
    settled(lambda: status_text(page) != "", timeout_ms=APPLY_MS)


def apply_and_wait_for_the_value_to_land(page: Page, stack: Stack, want: str) -> None:
    """Click apply and poll until the daemon fake's engine carries `want`.

    Stronger than waiting for a message, and deliberately so: a message is
    printed by a failed apply too, so a case that needs the apply to have
    SUCCEEDED waits on the file-lane truth instead.
    """
    page.locator(APPLY).click()
    settled(lambda: stack.http_state[CUDA_DEV_ATTR] == want, timeout_ms=APPLY_MS)


def apply_and_wait_for_it_to_conclude(page: Page, stack: Stack, want: str) -> None:
    """Click apply, wait for the value to reach the daemon, then for the card to stop applying.

    Two facts, neither of them the marking a case then asserts on. The first is
    the review's requirement — the value really went out — and the second is that
    the round trip is over: the card says one thing while an apply is in flight
    and another once it has concluded, so the wait is for the reading to CHANGE
    from whatever it was in flight. Nothing here names what either reading says,
    which is the only copy-free conclusion signal the card offers — it carries no
    outcome class the way the pending bar's `.note.ok` / `.note.err` does.

    A concluded apply that was read too late degrades to no wait at all, so the
    case still fails on its own assertion rather than passing on a timeout.
    """
    apply_and_wait_for_the_value_to_land(page, stack, want)
    in_flight = status_text(page)
    settled(lambda: status_text(page) not in ("", in_flight), timeout_ms=APPLY_MS)


# --- the dirty marking --------------------------------------------------------


def test_a_freshly_loaded_card_leaves_the_apply_button_unmarked(page: Page, stack: Stack) -> None:
    """Nothing differs from what was loaded, so there is nothing to apply."""
    loaded_card(page, stack)
    assert DIRTY not in apply_classes(page)


@pytest.mark.parametrize(("key", "kind"), SETTINGS)
def test_changing_a_hardware_setting_marks_the_apply_button(page: Page, stack: Stack, key: str, kind: str) -> None:
    """ANY of the six moving away from the snapshot is an unapplied change, and the button says so."""
    loaded_card(page, stack)
    change_setting(page, key, kind)
    assert DIRTY in apply_classes(page)


@pytest.mark.parametrize(("key", "kind"), SETTINGS)
def test_reverting_returns_the_apply_button_to_unmarked(page: Page, stack: Stack, key: str, kind: str) -> None:
    """Revert puts the settings back, so the card is clean again and the marking goes."""
    loaded_card(page, stack)
    change_setting(page, key, kind)
    page.locator(REVERT).click()
    flush_frames(page)
    assert DIRTY not in apply_classes(page)


@pytest.mark.parametrize(("key", "kind"), SETTINGS)
def test_reverting_restores_a_setting_to_what_the_daemon_reported(
    page: Page, stack: Stack, key: str, kind: str
) -> None:
    """Revert restores every one of the six, not merely the marking."""
    loaded_card(page, stack)
    was = change_setting(page, key, kind)
    page.locator(REVERT).click()
    settled(lambda: signature(page, key) == was)
    assert signature(page, key) == was


def test_reverting_restores_every_setting_that_was_changed(page: Page, stack: Stack) -> None:
    """Revert restores EVERY one of the six, not just the last one touched.

    The sweep above asks the question one setting at a time, which a revert that
    only ever restored the setting most recently edited would pass six times
    over. This one moves all six and reads them all back together.
    """
    loaded_card(page, stack)
    was = every_setting(page)
    for key, kind in EVERY_SETTING_IN_TURN:
        change_setting(page, key, kind)
    page.locator(REVERT).click()
    settled(lambda: every_setting(page) == was)
    assert every_setting(page) == was


def test_applying_sends_the_changed_setting_to_the_daemon(page: Page, stack: Stack) -> None:
    """Apply is a write: the value typed into the card reaches the daemon's engine config.

    The one case that would fail a card which merely printed a message and
    dropped its marking. The fake's engine attribute is put back afterwards, so
    the session-scoped stack does not carry this edit into later modules.
    """
    loaded_card(page, stack)
    before = stack.http_state[CUDA_DEV_ATTR]
    try:
        want = set_number_setting(page, CUDA_DEV)
        flush_frames(page)
        apply_and_wait_for_the_value_to_land(page, stack, want)
        landed = stack.http_state[CUDA_DEV_ATTR]
    finally:
        stack.http_state[CUDA_DEV_ATTR] = before
    assert landed == want


def test_applying_leaves_the_card_reading_clean(page: Page, stack: Stack) -> None:
    """A SUCCESSFUL apply re-snapshots, so what was just applied is no longer a change.

    Not vacuous, and not satisfied by a card that clears the marking on click:
    the card is provably marked on the way in (the sweep above pins that), and
    what is waited for is the applied value ARRIVING at the daemon and the round
    trip then finishing — so an apply that failed, or never sent anything, fails
    here rather than passing on a dropped marking.
    """
    loaded_card(page, stack)
    before = stack.http_state[CUDA_DEV_ATTR]
    try:
        want = set_number_setting(page, CUDA_DEV)
        flush_frames(page)
        apply_and_wait_for_it_to_conclude(page, stack, want)
        flush_frames(page)
        marked = DIRTY in apply_classes(page)
    finally:
        stack.http_state[CUDA_DEV_ATTR] = before
    assert marked is False


# --- the status message -------------------------------------------------------


@pytest.mark.parametrize(("key", "kind"), SETTINGS)
def test_changing_a_setting_clears_the_status_message(page: Page, stack: Stack, key: str, kind: str) -> None:
    """A message about the last apply is stale the moment ANY of the six moves again."""
    loaded_card(page, stack)
    apply_and_wait_for_a_message(page)
    change_setting(page, key, kind)
    assert status_text(page) == ""


# --- what the message says it was, and how long it lasts ----------------------


def test_an_apply_in_flight_carries_the_busy_outcome(page: Page, stack: Stack) -> None:
    """While the round trip is out, the status is machine-readably BUSY, not merely wordy.

    The outcome is a class token beside `hw-status`, so a caller can tell an
    apply that is still going from one that concluded without reading the
    sentence. The daemon fake's engine attribute is put back once the apply has
    landed, so the session-scoped stack does not carry this edit onward.
    """
    loaded_card(page, stack)
    before = stack.http_state[CUDA_DEV_ATTR]
    try:
        want = set_number_setting(page, CUDA_DEV)
        flush_frames(page)
        page.locator(APPLY).click()
        in_flight = saw_outcome(page, BUSY)
    finally:
        settled(lambda: stack.http_state[CUDA_DEV_ATTR] == want, timeout_ms=APPLY_MS)
        stack.http_state[CUDA_DEV_ATTR] = before
    assert in_flight is True


def test_a_confirmed_apply_carries_the_ok_outcome(page: Page, stack: Stack) -> None:
    """An apply the daemon confirmed reads OK, told apart from a warning or a failure.

    Not satisfied by a card that says something cheerful on click: what is waited
    for first is the applied value ARRIVING at the daemon, so the outcome being
    asked about belongs to an apply that really happened.
    """
    loaded_card(page, stack)
    before = stack.http_state[CUDA_DEV_ATTR]
    try:
        want = set_number_setting(page, CUDA_DEV)
        flush_frames(page)
        apply_and_wait_for_the_value_to_land(page, stack, want)
        confirmed = saw_outcome(page, OK, timeout_ms=APPLY_MS)
    finally:
        stack.http_state[CUDA_DEV_ATTR] = before
    assert confirmed is True


def test_a_confirmed_applys_message_clears_itself(page: Page, stack: Stack) -> None:
    """A confirmed apply's message goes away on its own, with no further interaction.

    Nothing is clicked, typed or navigated between the message landing and the
    reading: the only thing that happens in between is the poll asking whether it
    has gone yet. Not vacuous on a card that never spoke — the case above pins
    that a confirmed apply puts an `ok` message up, and this one waits for that
    same message before it starts asking.
    """
    loaded_card(page, stack)
    before = stack.http_state[CUDA_DEV_ATTR]
    try:
        want = set_number_setting(page, CUDA_DEV)
        flush_frames(page)
        apply_and_wait_for_the_value_to_land(page, stack, want)
        saw_outcome(page, OK, timeout_ms=APPLY_MS)
        settled(lambda: status_text(page) == "", timeout_ms=CLEAR_MS)
        left = status_text(page)
    finally:
        stack.http_state[CUDA_DEV_ATTR] = before
    assert left == ""


def test_a_refused_apply_carries_the_err_outcome(page: Page, stack: Stack) -> None:
    """A write the daemon refuses outright reads ERR, not merely "something happened".

    The refusal is the real one the daemon does: `POST /restore` answered 503,
    the frame `fake_http` serves for a daemon that is up but not taking a config
    right now. Nothing is adopted, so the card is reporting a change that did not
    land — the one reading the user has to act on.
    """
    loaded_card(page, stack)
    before = stack.http_state[CUDA_DEV_ATTR]
    stack.http_state["_restore_refusals"] = REFUSE_EVERYTHING
    try:
        set_number_setting(page, CUDA_DEV)
        flush_frames(page)
        page.locator(APPLY).click()
        refused = saw_outcome(page, ERR, timeout_ms=APPLY_MS)
    finally:
        stack.http_state["_restore_refusals"] = 0
        stack.http_state[CUDA_DEV_ATTR] = before
    assert refused is True


# --- neither button is ever disabled ------------------------------------------


def test_the_apply_button_is_enabled_while_the_card_is_dirty(page: Page, stack: Stack) -> None:
    """User actions always proceed: a change is applicable whatever the engine is doing."""
    loaded_card(page, stack)
    change_setting(page, CUDA_DEV, NUMBER)
    assert page.locator(APPLY).is_disabled() is False


def test_the_revert_button_is_enabled_while_the_card_is_dirty(page: Page, stack: Stack) -> None:
    """Having something to revert does not disable revert either."""
    loaded_card(page, stack)
    change_setting(page, CUDA_DEV, NUMBER)
    assert page.locator(REVERT).is_disabled() is False


def test_the_revert_button_is_enabled_on_a_clean_card(page: Page, stack: Stack) -> None:
    """Nothing disables revert, not even having nothing to revert."""
    loaded_card(page, stack)
    assert page.locator(REVERT).is_disabled() is False
