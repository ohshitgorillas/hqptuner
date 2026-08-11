"""Browser end-to-end characterization of the app shell and the staging round trip.

Tranche 1. Every case here drives a real headless chromium against a real
HQPTuner wired to the wire fakes, so what is pinned is the frontend, the REST
API and the lanes together: the shell renders, the daemon's own enumeration
reaches a selector, a knob change stages and shows as pending, Apply puts the
matching command on the control wire, the applied value reads back on the
control, a refused write is reported as a failure, and an engine that moves with
no command sent shows up in the LIVE view.

Policy notes (docs/testing.md):

- One assertion per test. Playwright's `expect()` is not used as the assertion
  anywhere — it is invisible to the assertion gate. Locators and `wait_for*` do
  the WAITING, and each test then makes exactly one plain `assert`.
- No test waits on the wall clock. The clock cannot be virtualized across the
  subprocess boundary, so there are no fixed sleeps: every wait is a bounded
  poll on a condition (a selector, or a DOM predicate).
- These are characterization tests for already-shipped behaviour, so the
  "new tests must bite" rule does not apply to them (rule 8's stated exemption).
- The stack is session-scoped and its engine state persists between tests, so
  each case states the baseline it needs and asserts on the transition it
  caused. Server-side state (staging, auto-save, presets) is the one thing put
  back before every test, by conftest's `clean_slate`.

The control it drives through the staging round trip is the Output tab's
High-frequency filter (`junk_filter`), which is a live-lane setting written with
`SetJunkFilter` (docs/settings-classification.md), so one control exercises both
the staging UI and the control wire.
"""

import re

from playwright.sync_api import Locator, Page

from e2e.support.stack import Stack

#: Bounded waits, in ms. Generous: they are ceilings on a condition poll, never
#: a duration anything is expected to take.
LOAD_MS = 30_000
SETTLE_MS = 20_000
APPLY_MS = 90_000

JUNK_LABEL = "High-frequency filter"

#: The pending bar carries a bare `.note` while an apply is in flight ("Applying…")
#: and adds `ok` or `err` to it once the apply has concluded, so waiting on the
#: bare class would read the in-flight note as the result.
RESULT_NOTE = "footer.pending-bar .note.ok, footer.pending-bar .note.err"

#: What a concluded apply puts in front of the user when it did not take: the
#: note reads this mark followed by the daemon's own diagnostic. Asserting on
#: the visible text rather than the note's class keeps the check on what the
#: user is actually told.
FAIL_MARK = "✗"

#: The filter names the control fake's PCM chain enumerates over GetFilters. The
#: running engine is the enumeration authority (architecture §2), so this is the
#: list the LIVE filter selector must be offering.
PCM_FILTER_NAMES = ["none", "poly-sinc-gauss-long", "sinc-M"]

#: The tabs the shell puts up. Pinning the names is what makes "the shell
#: rendered" mean something: a skeleton carrying the right class names but no
#: tabs is not a shell.
TAB_NAMES = ["Output", "Volume", "Resampling", "Matrix", "System"]

#: The engine baseline each staging case starts the High-frequency filter from,
#: as the control fake stores it: an index string, `"0"` being the `none` entry
#: of the junk-filter enumeration. The stack is session-scoped, so without a
#: known starting point a case could pick the value already in force, stage
#: nothing, and fail as a timeout rather than as the behaviour it is about.
JUNK_BASELINE_INDEX = "0"
JUNK_BASELINE_NAME = "none"

#: The one rule both label-matching helpers use, so `field()` and the DOM
#: predicates below can never resolve to different rows: a field's label text,
#: trimmed, starts with the name asked for.
_MATCHING_FIELDS = (
    "[...document.querySelectorAll('.field')].filter("
    "  f => (f.querySelector('label')?.textContent || '').trim().startsWith(label))"
)
_BOX_TEXT = "f => (f.querySelector('button.dd-box')?.textContent || '').trim()"


def open_app(page: Page, stack: Stack) -> None:
    """Load the SPA and wait until the config-driven body is on screen."""
    page.goto(stack.base_url)
    page.wait_for_selector("footer.pending-bar", timeout=LOAD_MS)
    page.wait_for_selector(f"label:has-text('{JUNK_LABEL}')", timeout=LOAD_MS)


def clear_staging(page: Page) -> None:
    """Drop anything staged earlier in this case, so it goes on from clean.

    The buffer a *previous* test left is not this helper's job: the
    `clean_slate` fixture empties it server-side before the page ever loads.
    Deciding here whether anything is staged would race the app's fetch of that
    buffer, which lands after the first render.
    """
    discard = page.get_by_role("button", name="Discard")
    if discard.is_enabled():
        discard.click()
    # The count element is always rendered, so requiring it to exist as well as
    # to be empty keeps a not-yet-rendered bar from reading as cleared.
    page.wait_for_function(
        "() => { const c = document.querySelector('footer.pending-bar .count');"
        "  return c !== null && c.textContent.trim() === ''; }",
        timeout=SETTLE_MS,
    )


def field(page: Page, label: str) -> Locator:
    """The one field row whose label starts with `label`."""
    prefix = re.compile(rf"^\s*{re.escape(label)}")
    return page.locator(".field", has=page.locator("label", has_text=prefix))


def combobox_value(page: Page, label: str) -> str:
    """What a field's combobox currently reads."""
    return field(page, label).locator("button.dd-box").inner_text().strip()


def choose(page: Page, label: str, option: str) -> None:
    """Open a field's combobox and pick the option named `option`."""
    row = field(page, label)
    row.locator("button.dd-box").click()
    row.get_by_role("option", name=option, exact=True).click()


def enter_live(page: Page) -> None:
    """Force the LIVE switch on and wait for the engine-fed chain controls.

    The switch latches, so it is driven to the on state rather than toggled: a
    blind click on a page that is already in LIVE would leave it.
    """
    switch = page.get_by_role("button", name="LIVE")
    if switch.get_attribute("aria-pressed") != "true":
        switch.click()
    page.wait_for_selector("label:has-text('Nx filter')", timeout=LOAD_MS)
    # Only that the selector is populated at all. Waiting on a particular option
    # count would turn "the engine offered too few filters" into a helper
    # timeout instead of the list comparison the assertion is written to show.
    field(page, "Nx filter").locator(".dd-opt").first.wait_for(state="attached", timeout=SETTLE_MS)


def wait_for_combobox_change(page: Page, label: str, previous: str) -> None:
    """Poll until the field's combobox reads something non-empty other than `previous`."""
    page.wait_for_function(
        f"([label, previous]) => {_MATCHING_FIELDS}.some("
        f"  f => {{ const t = ({_BOX_TEXT})(f); return t !== '' && t !== previous; }})",
        arg=[label, previous],
        timeout=SETTLE_MS,
    )


def wait_for_combobox_text(page: Page, label: str, expected: str) -> None:
    """Poll until the field's combobox reads exactly `expected`."""
    page.wait_for_function(
        f"([label, expected]) => {_MATCHING_FIELDS}.some(f => ({_BOX_TEXT})(f) === expected)",
        arg=[label, expected],
        timeout=SETTLE_MS,
    )


def staged_count(page: Page) -> int:
    """How many changes the pending bar says are staged, read as a number.

    The bar's wording is copy and may change; the number in it is the
    behaviour. An empty count reads as nothing staged.
    """
    digits = re.search(r"\d+", page.locator("footer.pending-bar .count").inner_text())
    return int(digits.group()) if digits else 0


def option_names(page: Page, label: str) -> list[str]:
    """A combobox's option labels, with the favourite star stripped off each."""
    rows = field(page, label).locator(".dd-opt").all_text_contents()
    return [row.replace("☆", "").replace("★", "").strip() for row in rows]


def test_the_index_page_renders_the_app_shell(page: Page, stack: Stack) -> None:
    """The served index brings up the whole chrome: header, tabs, body, pending bar."""
    open_app(page, stack)
    # Structure as waits, not as the assertion: the shell failing to come up
    # times out here, while the assertion stays on what the shell offers.
    for selector in ("header.chrome-header", "nav.tab-nav", "main section.tab-body"):
        page.wait_for_selector(selector, timeout=LOAD_MS)
    assert [name.strip() for name in page.locator("nav.tab-nav button").all_text_contents()] == TAB_NAMES


def test_the_daemons_filter_enumeration_fills_the_live_filter_selector(page: Page, stack: Stack) -> None:
    """The LIVE Nx filter selector offers exactly what the daemon enumerated."""
    open_app(page, stack)
    enter_live(page)
    assert option_names(page, "Nx filter") == PCM_FILTER_NAMES


def test_staging_a_knob_change_marks_the_pending_bar_as_unapplied(page: Page, stack: Stack) -> None:
    """Picking a new value stages it and the pending bar counts it as unapplied."""
    stack.control_state["filter_junk"] = JUNK_BASELINE_INDEX
    open_app(page, stack)
    clear_staging(page)
    choose(page, JUNK_LABEL, "20k")
    page.wait_for_selector("footer.pending-bar.active", timeout=SETTLE_MS)
    assert staged_count(page) == 1


def test_applying_a_staged_change_sends_the_matching_control_command(page: Page, stack: Stack) -> None:
    """Apply puts SetJunkFilter with the picked index on the control wire."""
    stack.control_state["filter_junk"] = JUNK_BASELINE_INDEX
    open_app(page, stack)
    clear_staging(page)
    choose(page, JUNK_LABEL, "20k")
    page.wait_for_selector("footer.pending-bar.active", timeout=SETTLE_MS)
    mark = len(stack.control_log)
    page.get_by_role("button", name="Apply", exact=True).click()
    page.wait_for_selector(RESULT_NOTE, timeout=APPLY_MS)
    assert ("SetJunkFilter", {"value": "1"}) in stack.control_log[mark:]


def test_the_applied_value_shows_on_the_control_after_readback(page: Page, stack: Stack) -> None:
    """Once applied, the control reads the value the engine now reports."""
    stack.control_state["filter_junk"] = JUNK_BASELINE_INDEX
    open_app(page, stack)
    clear_staging(page)
    wait_for_combobox_text(page, JUNK_LABEL, JUNK_BASELINE_NAME)
    was = combobox_value(page, JUNK_LABEL)
    choose(page, JUNK_LABEL, "30k")
    page.wait_for_selector("footer.pending-bar.active", timeout=SETTLE_MS)
    page.get_by_role("button", name="Apply", exact=True).click()
    page.wait_for_selector("footer.pending-bar .note.ok", timeout=APPLY_MS)
    # Reload, so what the control shows is a readback of the engine rather than
    # the value the page optimistically painted when the edit was staged.
    open_app(page, stack)
    wait_for_combobox_change(page, JUNK_LABEL, was)
    assert combobox_value(page, JUNK_LABEL) == "30k"


def test_a_write_the_engine_ignores_is_reported_as_a_failed_apply(page: Page, stack: Stack) -> None:
    """A setter the daemon accepts but never applies surfaces as a failure, not a success."""
    stack.control_state["filter_junk"] = JUNK_BASELINE_INDEX
    stack.control_state["_deaf"] = "SetJunkFilter"
    try:
        open_app(page, stack)
        clear_staging(page)
        choose(page, JUNK_LABEL, "20k")
        page.wait_for_selector("footer.pending-bar.active", timeout=SETTLE_MS)
        page.get_by_role("button", name="Apply", exact=True).click()
        page.wait_for_selector(RESULT_NOTE, timeout=APPLY_MS)
        note_text = page.locator(RESULT_NOTE).inner_text().strip()
    finally:
        stack.control_state["_deaf"] = ""
        clear_staging(page)
    assert note_text.startswith(FAIL_MARK)


def test_a_write_the_engine_refuses_is_reported_as_a_failed_apply(page: Page, stack: Stack) -> None:
    """A setter the daemon answers with an Error surfaces as a failure, not a success."""
    stack.control_state["filter_junk"] = JUNK_BASELINE_INDEX
    stack.control_state["_error"] = "SetJunkFilter"
    try:
        open_app(page, stack)
        clear_staging(page)
        choose(page, JUNK_LABEL, "20k")
        page.wait_for_selector("footer.pending-bar.active", timeout=SETTLE_MS)
        page.get_by_role("button", name="Apply", exact=True).click()
        page.wait_for_selector(RESULT_NOTE, timeout=APPLY_MS)
        note_text = page.locator(RESULT_NOTE).inner_text().strip()
    finally:
        stack.control_state["_error"] = ""
        clear_staging(page)
    assert note_text.startswith(FAIL_MARK)


def test_an_engine_change_sent_by_no_command_shows_in_the_live_view(page: Page, stack: Stack) -> None:
    """The LIVE view follows the engine even when the move came from elsewhere."""
    stack.control_state["filterNx"] = "0"
    open_app(page, stack)
    enter_live(page)
    wait_for_combobox_text(page, "Nx filter", PCM_FILTER_NAMES[0])
    before = combobox_value(page, "Nx filter")
    stack.control_state["filterNx"] = "2"
    wait_for_combobox_change(page, "Nx filter", before)
    assert combobox_value(page, "Nx filter") == "sinc-M"
