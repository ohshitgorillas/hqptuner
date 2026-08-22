"""Browser end-to-end characterization of the System tab's log tail: scroll pinning and Copy.

These belong here rather than in `tests/js/` for one reason: both behaviors are
about things the JS unit harness does not have. `docs/testing.md` pins components
to `preact-render-to-string`, so there is no element to carry `scrollTop` /
`scrollHeight` / `clientHeight`, no `useEffect` to run the 3-second poll that
fills the pane, and no event dispatch to click a button with. Here the pane has
real layout and the poll really runs, so the scroll arithmetic is the browser's
own.

The lines come from the daemon's 8088 web interface at `GET /log`, which the
e2e stack serves from the HTTP fake: `stack.http_state["_log"]` is the whole log
body, and the app serves the tail of it at `GET /api/log`. Putting known lines in
front of the UI therefore means writing that key — the fake's own knob, no new
seam — and a "new poll" means writing it again and waiting for the pane's text to
follow.

Policy notes (docs/testing.md):

- One assertion per test. `expect()` is invisible to the assertion gate and is
  not used as the assertion; locators, `wait_for_function` and the helpers below
  do the WAITING, and each test then makes exactly one plain `assert`.
- No test waits on the wall clock. Every wait is a bounded poll on a condition.
  `flush_frames` waits two animation frames — frames, not a duration — which is
  what the cases that assert a scroll position did NOT move need: without it they
  could read the pane in the window between new text landing and the component's
  post-render effect running, and pass by looking too early.
- Waits are always WEAKER than the assertion they precede, so no wait can make
  its assertion vacuous. The pinning cases wait for the pane to move at all and
  then assert where it landed; the copy cases wait for the button to leave its
  idle state and then assert which state it reached.
- Controls are addressed by machine identity, never by their wording
  (docs/testing.md rule 9): `data-testid` for the System tab and the tail's
  toggle, `data-copy` for the copy button's outcome. The captions those controls
  render are the owner's to reword and are neither selected on nor asserted.
- The stack is session-scoped and its state persists between tests, so each case
  writes the whole log body it wants rather than assuming what the last one left.

"At the bottom" is the spec's own predicate — `scrollHeight - scrollTop -
clientHeight <= 4` — never an exact scrollTop: an implementation that pins by
assigning `scrollHeight` and one that assigns `scrollHeight - clientHeight` are
the same thing to a browser, which clamps, and pinning the difference would be
pinning the implementation.
"""

from playwright.sync_api import Locator, Page

from e2e.support.stack import Stack

#: Bounded waits, in ms: ceilings on a condition poll, never a duration anything
#: is expected to take. The tail polls every 3 s, so a wait for new lines has to
#: outlast a poll interval comfortably.
LOAD_MS = 30_000
SETTLE_MS = 20_000

TAIL = "pre.log-tail"
WRAP = ".log-tail-wrap"

#: Controls are addressed by machine identity, never by the words on them
#: (docs/testing.md rule 9): the System tab and the tail's toggle carry a
#: `data-testid`, and the copy button reports its outcome in `data-copy`.
SYSTEM_TAB = "[data-testid='tab-system']"
TOGGLE = "[data-testid='logtail-toggle']"
COPY = f"{WRAP} button[data-copy]"

#: What `data-copy` reads: before a click, after one that landed, after one that
#: did not. The button's caption changes with it and is copy; the state is not.
COPY_IDLE = "idle"
COPY_OK = "ok"
COPY_FAIL = "fail"

#: The window the component asks for. Anything longer than this is trimmed to its
#: last 50 lines before it reaches the pane.
WINDOW = 50

#: How far off the bottom counts as still at the bottom (spec's own predicate).
SLACK = 4


def logged(tag: str, count: int) -> str:
    """A log body of `count` distinctly-tagged lines, as the daemon serves one.

    Tags are equal-length and mutually non-overlapping on purpose: a poll is
    detected by finding the new body's last line as a SUBSTRING of the pane, so a
    tag that is a suffix of the previous one ("eta" inside "zeta") matches the
    text already on screen and every wait for the new poll returns instantly.
    """
    return "\n".join(f"{tag} log line {i}" for i in range(1, count + 1))


def last_line(tag: str, count: int) -> str:
    """The final line of `logged(tag, count)` — the marker a poll has landed."""
    return f"{tag} log line {count}"


def open_system_tab(page: Page, stack: Stack) -> None:
    """Load the SPA and bring up the System tab, where the log tail lives."""
    page.goto(stack.base_url)
    page.wait_for_selector("footer.pending-bar", timeout=LOAD_MS)
    page.locator(SYSTEM_TAB).click()
    page.wait_for_selector(TOGGLE, timeout=LOAD_MS)


def show_tail(page: Page) -> None:
    """Drive the toggle to the shown state and wait for what the shown state renders.

    Driven, not toggled: the toggle DEFAULTS to the daemon's logging setting, so
    a blind click on a tail that is already shown would hide it.

    The decision is keyed off the CHECKBOX, never off the pane. A shown tail
    renders the pane only once its first poll has resolved, and renders
    `.log-tail-msg` instead of the pane when the log is unavailable, so "no
    `pre.log-tail` on screen" is not the same question as "the tail is hidden" —
    asking it that way races the first poll and hides a tail that was already
    shown.
    """
    box = page.locator(f"{TOGGLE} input[type='checkbox']")
    box.wait_for(state="attached", timeout=SETTLE_MS)
    if not box.is_checked():
        page.locator(TOGGLE).click()
    # Either child of the wrapper means shown: the pane, or the unavailable note.
    page.wait_for_selector(f"{TAIL}, {WRAP} .log-tail-msg", timeout=SETTLE_MS)


def wait_for_text(page: Page, marker: str) -> None:
    """Poll until the pane's text carries `marker` — i.e. that poll has landed."""
    page.wait_for_function(
        "(marker) => { const p = document.querySelector('pre.log-tail');"
        "  return p !== null && p.textContent.includes(marker); }",
        arg=marker,
        timeout=SETTLE_MS,
    )


def wait_for_overflow(page: Page) -> None:
    """Poll until the pane has more content than fits, so scrolling means something."""
    page.wait_for_function(
        "() => { const p = document.querySelector('pre.log-tail');"
        "  return p !== null && p.scrollHeight > p.clientHeight; }",
        timeout=SETTLE_MS,
    )


def wait_for_scroll_past(page: Page, mark: float) -> None:
    """Poll until the pane has scrolled further down than `mark`.

    Deliberately weaker than "at the bottom": a component that scrolls to the
    wrong place still satisfies this and then fails the assertion, which is where
    the diagnosis belongs. A component that never scrolls at all fails here, as a
    timeout.
    """
    page.wait_for_function(
        "(mark) => { const p = document.querySelector('pre.log-tail');  return p !== null && p.scrollTop > mark; }",
        arg=mark,
        timeout=SETTLE_MS,
    )


def wait_for_gap_between(page: Page, low: float, high: float) -> None:
    """Poll until the pane sits strictly between `low` and `high` px off the bottom.

    A PRECONDITION, not a result: the browser clamps `scrollTop`, so a pane whose
    overflow is smaller than the offset asked for lands at 0 or at the bottom
    instead of where the case needs it, and the case then silently becomes a
    different one that still goes green. Failing here says the fixture never set
    up the situation, which is a different diagnosis from the behavior breaking.
    """
    page.wait_for_function(
        "([low, high]) => { const p = document.querySelector('pre.log-tail');"
        "  if (p === null) return false;"
        "  const gap = p.scrollHeight - p.scrollTop - p.clientHeight;"
        "  return gap > low && gap < high; }",
        arg=[low, high],
        timeout=SETTLE_MS,
    )


def flush_frames(page: Page) -> None:
    """Let two animation frames pass, so any post-render effect has run.

    Frames, not a duration: this is what stands between "the new lines are in the
    DOM" and "everything the component does about them has happened", and the
    cases asserting the pane did NOT move need to be on the far side of it.
    """
    page.wait_for_function(
        "() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
        timeout=SETTLE_MS,
    )


def scroll_top(page: Page) -> float:
    """Where the pane is scrolled to, as the browser reports it."""
    return float(page.evaluate("() => document.querySelector('pre.log-tail').scrollTop"))


def bottom_gap(page: Page) -> float:
    """`scrollHeight - scrollTop - clientHeight`: how far the pane is off the bottom."""
    return float(
        page.evaluate(
            "() => { const p = document.querySelector('pre.log-tail');"
            "  return p.scrollHeight - p.scrollTop - p.clientHeight; }"
        )
    )


def scroll_to(page: Page, offset: float) -> float:
    """Put the pane at `offset` and report where it actually landed (the browser clamps)."""
    return float(
        page.evaluate(
            "(offset) => { const p = document.querySelector('pre.log-tail');"
            "  p.scrollTop = offset; return p.scrollTop; }",
            offset,
        )
    )


def scroll_near_bottom(page: Page, slack: float) -> float:
    """Put the pane `slack` px short of the bottom and report where it landed."""
    return float(
        page.evaluate(
            "(slack) => { const p = document.querySelector('pre.log-tail');"
            "  p.scrollTop = p.scrollHeight - p.clientHeight - slack; return p.scrollTop; }",
            slack,
        )
    )


def scroll_to_middle(page: Page) -> float:
    """Put the pane halfway down and report where it landed."""
    return float(
        page.evaluate(
            "() => { const p = document.querySelector('pre.log-tail');"
            "  p.scrollTop = Math.floor((p.scrollHeight - p.clientHeight) / 2); return p.scrollTop; }"
        )
    )


def copy_button(page: Page) -> Locator:
    """The tail's Copy button, found inside the tail block as a user finds it."""
    return page.locator(COPY)


def observed_copy_state(page: Page) -> str:
    """Wait for the button to leave the idle state, and report what state it reached.

    Captured at the moment of the change rather than read afterwards, so a button
    that reverts to idle on a timer cannot turn this into a race. The button's
    caption is copy and is not looked at; `data-copy` is the outcome.
    """
    page.wait_for_function(
        "([selector, idle]) => { const b = document.querySelector(selector);"
        "  if (b === null) return false;"
        "  const state = b.getAttribute('data-copy');"
        "  if (state === null || state === idle) return false;"
        "  window.__hqptunerCopyState = state; return true; }",
        arg=[COPY, COPY_IDLE],
        timeout=SETTLE_MS,
    )
    return str(page.evaluate("() => window.__hqptunerCopyState"))


def open_tail_with(page: Page, stack: Stack, tag: str, count: int) -> None:
    """Serve `count` lines tagged `tag`, open the System tab, and show the tail on them."""
    stack.http_state["_log"] = logged(tag, count)
    open_system_tab(page, stack)
    show_tail(page)
    wait_for_text(page, last_line(tag, count))


def poll_with(page: Page, stack: Stack, tag: str, count: int) -> None:
    """Change the served log and wait for the tail's own poll to bring it in."""
    stack.http_state["_log"] = logged(tag, count)
    wait_for_text(page, last_line(tag, count))


# --- scroll pinning -----------------------------------------------------------


def test_an_opened_tail_starts_scrolled_to_the_bottom(page: Page, stack: Stack) -> None:
    """The newest lines are what a log tail is for, so it opens showing them."""
    open_tail_with(page, stack, "TAG01", 60)
    wait_for_overflow(page)
    wait_for_scroll_past(page, 0)
    assert bottom_gap(page) <= SLACK


def test_a_tail_left_at_the_bottom_follows_new_lines_down(page: Page, stack: Stack) -> None:
    """A pane the user has not moved keeps showing the newest lines as they arrive."""
    open_tail_with(page, stack, "TAG02", WINDOW - 5)
    wait_for_overflow(page)
    wait_for_scroll_past(page, 0)
    was = scroll_top(page)
    poll_with(page, stack, "TAG03", WINDOW + 10)
    wait_for_scroll_past(page, was)
    assert bottom_gap(page) <= SLACK


def test_a_tail_scrolled_to_the_top_stays_at_the_top_across_a_poll(page: Page, stack: Stack) -> None:
    """Reading the oldest lines in the window is not interrupted by a poll."""
    open_tail_with(page, stack, "TAG04", WINDOW)
    wait_for_overflow(page)
    # Let the open-time pin land BEFORE scrolling away, or it lands afterwards and
    # fails this case for a reason that is not the behavior under test.
    wait_for_scroll_past(page, 0)
    scroll_to(page, 0)
    poll_with(page, stack, "TAG05", WINDOW)
    flush_frames(page)
    assert scroll_top(page) == 0


def test_a_tail_scrolled_to_the_middle_does_not_move_across_a_poll(page: Page, stack: Stack) -> None:
    """A pane the user has parked mid-way stays exactly where they parked it."""
    open_tail_with(page, stack, "TAG06", WINDOW)
    wait_for_overflow(page)
    wait_for_scroll_past(page, 0)  # the open-time pin, before the user moves the pane
    parked = scroll_to_middle(page)
    poll_with(page, stack, "TAG07", WINDOW)
    flush_frames(page)
    assert scroll_top(page) == parked


def test_a_tail_within_the_slack_of_the_bottom_counts_as_at_the_bottom(page: Page, stack: Stack) -> None:
    """A few pixels short of the bottom is still following, so a poll re-pins it."""
    open_tail_with(page, stack, "TAG08", WINDOW - 5)
    wait_for_overflow(page)
    near = scroll_near_bottom(page, SLACK - 1)
    # Strictly inside the slack and strictly off the bottom: without this the
    # browser's clamp can park the pane exactly at the bottom and the case
    # degenerates into the already-following one above while still going green.
    wait_for_gap_between(page, 0, SLACK)
    poll_with(page, stack, "TAG09", WINDOW + 10)
    wait_for_scroll_past(page, near)
    assert bottom_gap(page) <= SLACK


def test_a_tail_just_outside_the_slack_does_not_move_across_a_poll(page: Page, stack: Stack) -> None:
    """Past the slack the user is reading, not following, so a poll leaves the pane alone.

    The discriminating case for the whole feature: every other case is satisfied
    by a slack of 4, of 40, or of the pane's whole height. This one is what makes
    the constant mean something — a pane parked a couple of pixels beyond it must
    stay put.
    """
    open_tail_with(page, stack, "TAG14", WINDOW - 5)
    wait_for_overflow(page)
    parked = scroll_near_bottom(page, SLACK + 2)
    wait_for_gap_between(page, SLACK, SLACK + 4)
    poll_with(page, stack, "TAG15", WINDOW + 10)
    flush_frames(page)
    assert scroll_top(page) == parked


# --- the copy button ----------------------------------------------------------
#
# The clipboard cases stub BROWSER APIs from outside the page, never anything of
# HQPTuner's: a context permission grant for the real clipboard, and an init
# script replacing `navigator.clipboard` / `document.execCommand` for the two
# cases about a clipboard that is missing or refuses. The origin is
# `http://127.0.0.1:<port>`, a secure context, so the real clipboard is there
# when it is not taken away.

#: Deletes the clipboard the way an insecure context does — the property lives on
#: Navigator.prototype, so it is redefined rather than deleted off the instance —
#: and records every `document.execCommand` the page makes.
NO_CLIPBOARD = """
Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined, configurable: true });
window.__hqptunerExec = [];
document.execCommand = (command) => { window.__hqptunerExec.push(command); return true; };
"""

#: A clipboard that refuses, with the legacy route refusing too, so the only
#: thing left for the component to do is report the failure.
REFUSING_CLIPBOARD = """
Object.defineProperty(Navigator.prototype, 'clipboard', {
  get: () => ({
    writeText: () => Promise.reject(new Error('denied')),
    readText: () => Promise.reject(new Error('denied')),
  }),
  configurable: true,
});
document.execCommand = () => { throw new Error('denied'); };
"""


def test_copying_puts_the_displayed_lines_on_the_clipboard(page: Page, stack: Stack) -> None:
    """Copy hands over exactly what the pane shows, newline-joined."""
    page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=stack.base_url)
    # Compared against the body the test SERVED, not against what the pane ended
    # up showing: a component that renders the wrong lines and then copies those
    # same wrong lines has to fail here, and comparing with the pane's own text
    # would let it through.
    open_tail_with(page, stack, "TAG10", 12)
    copy_button(page).click()
    observed_copy_state(page)
    assert page.evaluate("() => navigator.clipboard.readText()") == logged("TAG10", 12)


def test_copying_without_a_clipboard_falls_back_to_the_legacy_command(page: Page, stack: Stack) -> None:
    """With no clipboard API, the copy still goes out through execCommand."""
    page.add_init_script(NO_CLIPBOARD)
    open_tail_with(page, stack, "TAG11", 12)
    copy_button(page).click()
    observed_copy_state(page)
    assert "copy" in page.evaluate("() => window.__hqptunerExec")


def test_a_successful_copy_says_so_on_the_button(page: Page, stack: Stack) -> None:
    """The button reports the copy landed, so the click is not silent."""
    page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=stack.base_url)
    open_tail_with(page, stack, "TAG12", 12)
    copy_button(page).click()
    assert observed_copy_state(page) == COPY_OK


def test_a_refused_copy_says_so_on_the_button(page: Page, stack: Stack) -> None:
    """A clipboard that refuses is reported as a failure, never as a success."""
    page.add_init_script(REFUSING_CLIPBOARD)
    open_tail_with(page, stack, "TAG13", 12)
    copy_button(page).click()
    assert observed_copy_state(page) == COPY_FAIL
