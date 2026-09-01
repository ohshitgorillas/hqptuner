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
- Controls are addressed by machine identity, never by their wording
  (rule 9): `data-k` for a field, `data-v` for a combobox option row,
  `data-testid` for the shell chrome. The captions are the owner's to reword, so
  they appear in no selector and in no assertion. Option NAMES the daemon
  enumerated (`sinc-M`, `30k`) are wire identifiers, not copy, and stay pinned.
  Because the testid lookups would not notice a button losing its label,
  `test_a_shell_control_carries_an_accessible_name` keeps that coverage
  explicitly, without pinning what the label reads.
- These are characterization tests for already-shipped behavior, so the
  "new tests must bite" rule does not apply to them (rule 8's stated exemption).
- The stack is session-scoped and its engine state persists between tests, so
  each case states the baseline it needs and asserts on the transition it
  caused. Server-side state (staging, auto-save, presets) is the one thing put
  back before every test, by conftest's `clean_slate`.

The control it drives through the staging round trip is the High-frequency
filter (`junk_filter`), which is a live-lane setting written with
`SetJunkFilter` (docs/settings-classification.md), so one control exercises both
the staging UI and the control wire. The Conversion tab is gone and its cards
live on the Output tab, so the control sits on the landing tab: `open_app`
reaching it with no tab switch is itself part of the pinned behavior.
"""

import re

import pytest
from playwright.sync_api import Locator, Page

from e2e.support.stack import Stack

#: Bounded waits, in ms. Generous: they are ceilings on a condition poll, never
#: a duration anything is expected to take.
LOAD_MS = 30_000
SETTLE_MS = 20_000
APPLY_MS = 90_000

#: Controls are addressed by machine identity, never by the words on them
#: (docs/testing.md rule 9): every Field wrapper carries its schema key in
#: `data-k`, every combobox option row its wire value in `data-v`, and the shell
#: chrome its `data-testid`. The wording those controls render is copy the owner
#: may reword at will, so it appears in no selector and in no assertion here.
JUNK_KEY = "junk_filter"

#: The LIVE view keys its chain fields by catalog key, and the two chains key
#: SEPARATELY — `pcm_filter_nx` and `sdm_filter_nx`. Every LIVE case here is
#: about the PCM chain (it reads the PCM filter enumeration and moves
#: `filterNx`), so it names the PCM one rather than "whichever Nx is on screen":
#: a case that silently followed the SDM chain would be asserting the PCM
#: enumeration against the wrong selector.
PCM_NX_KEY = "pcm_filter_nx"

#: Junk-filter option rows, by the wire value each carries in `data-v` — the
#: enum's `value`, not its index. The control fake enumerates the junk filters
#: as `(index, name, value)` triples `("0", "none", "0")`, `("1", "20k", "1")`,
#: `("2", "30k", "2")`. The names are the daemon's own enumeration — wire
#: identifiers, so asserting on one is contract rather than copy.
JUNK_20K = "1"
JUNK_30K = "2"
JUNK_30K_NAME = "30k"

#: A non-empty accessible name, with nothing said about what it reads.
ANY_NAME = re.compile(r"\S")

#: How a concluded apply reports its outcome: the pending bar carries a bare
#: `.note` while the apply is in flight and adds `ok` or `err` to it once the
#: apply has concluded, so waiting on the bare class would read the in-flight
#: note as the result. The note's TEXT is the daemon's diagnostic wrapped in
#: copy and stays out of every assertion; the class carries the same fact and is
#: contract.
OK_NOTE = "footer.pending-bar .note.ok"
FAIL_NOTE = "footer.pending-bar .note.err"
RESULT_NOTE = f"{OK_NOTE}, {FAIL_NOTE}"

#: The filter names the control fake's PCM chain enumerates over GetFilters. The
#: running engine is the enumeration authority (architecture §2), so this is the
#: list the LIVE filter selector must be offering.
PCM_FILTER_NAMES = ["none", "poly-sinc-gauss-long", "sinc-M", "poly-sinc-short-mp"]

#: The tabs the shell puts up, by their `data-testid`. Pinning these is what
#: makes "the shell rendered" mean something: a skeleton carrying the right class
#: names but no tabs is not a shell. The tab captions are copy and are not
#: pinned; which tabs exist, and in what order, is behavior.
TAB_IDS = ["tab-output", "tab-volume", "tab-matrix", "tab-system"]

#: Every shell control this suite drives, by `data-testid`. Each is a button a
#: keyboard or screen-reader user has to be able to identify, so each gets an
#: accessible-name case below.
NAMED_CONTROLS = ["apply", "discard", "live-toggle", *TAB_IDS]

#: The engine baseline each staging case starts the High-frequency filter from,
#: as the control fake stores it: an index string, `"0"` being the `none` entry
#: of the junk-filter enumeration. The stack is session-scoped, so without a
#: known starting point a case could pick the value already in force, stage
#: nothing, and fail as a timeout rather than as the behavior it is about.
JUNK_BASELINE_INDEX = "0"
JUNK_BASELINE_NAME = "none"

#: The one rule both field-matching helpers use, so `field()` and the DOM
#: predicates below can never resolve to different rows: a field carries the
#: schema key it renders in `data-k`.
_MATCHING_FIELDS = "[...document.querySelectorAll('.field')].filter(f => f.getAttribute('data-k') === key)"
_BOX_TEXT = "f => (f.querySelector('button.dd-box')?.textContent || '').trim()"


def open_app(page: Page, stack: Stack) -> None:
    """Load the SPA and wait until the config-driven body is on screen."""
    page.goto(stack.base_url)
    page.wait_for_selector("footer.pending-bar", timeout=LOAD_MS)
    # The High-frequency filter lives on the Output tab the app opens on, so it
    # must come up with NO tab switch — every case in this module rides on that.
    page.wait_for_selector(f".field[data-k='{JUNK_KEY}']", timeout=LOAD_MS)


def clear_staging(page: Page) -> None:
    """Drop anything staged earlier in this case, so it goes on from clean.

    The buffer a *previous* test left is not this helper's job: the
    `clean_slate` fixture empties it server-side before the page ever loads.
    Deciding here whether anything is staged would race the app's fetch of that
    buffer, which lands after the first render.
    """
    discard = page.locator("[data-testid='discard']")
    if discard.is_enabled():
        discard.click()
    # The count element is always rendered, so requiring it to exist as well as
    # to be empty keeps a not-yet-rendered bar from reading as cleared.
    page.wait_for_function(
        "() => { const c = document.querySelector('footer.pending-bar .count');"
        "  return c !== null && c.textContent.trim() === ''; }",
        timeout=SETTLE_MS,
    )


def field(page: Page, key: str) -> Locator:
    """The field row rendering the schema key `key`, found by its `data-k`."""
    return page.locator(f".field[data-k='{key}']")


def named_button(page: Page, testid: str) -> Locator:
    """The control with `testid`, but only if it is a button with a non-empty accessible name.

    Resolving through the role lookup is what keeps the move off the wording from
    quietly dropping the accessibility coverage the old text locators carried:
    the name has to exist, and nothing here says what it reads.
    """
    return page.get_by_role("button", name=ANY_NAME).and_(page.locator(f"[data-testid='{testid}']"))


def combobox_value(page: Page, key: str) -> str:
    """What a field's combobox currently reads.

    The text is the option name the daemon enumerated — a wire identifier, and
    contract — not a caption the owner writes.
    """
    return field(page, key).locator("button.dd-box").inner_text().strip()


def choose(page: Page, key: str, value: str) -> None:
    """Open a field's combobox and pick the option carrying wire value `value`."""
    row = field(page, key)
    row.locator("button.dd-box").click()
    row.locator(f".dd-opt[data-v='{value}']").click()


def enter_live(page: Page) -> None:
    """Force the LIVE switch on and wait for the engine-fed chain controls.

    The switch latches, so it is driven to the on state rather than toggled: a
    blind click on a page that is already in LIVE would leave it.
    """
    switch = page.locator("[data-testid='live-toggle']")
    if switch.get_attribute("aria-pressed") != "true":
        switch.click()
    page.wait_for_selector(f".field[data-k='{PCM_NX_KEY}']", timeout=LOAD_MS)
    # Only that the selector is populated at all. Waiting on a particular option
    # count would turn "the engine offered too few filters" into a helper
    # timeout instead of the list comparison the assertion is written to show.
    field(page, PCM_NX_KEY).locator(".dd-opt").first.wait_for(state="attached", timeout=SETTLE_MS)


def wait_for_combobox_change(page: Page, key: str, previous: str) -> None:
    """Poll until the field's combobox reads something non-empty other than `previous`."""
    page.wait_for_function(
        f"([key, previous]) => {_MATCHING_FIELDS}.some("
        f"  f => {{ const t = ({_BOX_TEXT})(f); return t !== '' && t !== previous; }})",
        arg=[key, previous],
        timeout=SETTLE_MS,
    )


def wait_for_combobox_text(page: Page, key: str, expected: str) -> None:
    """Poll until the field's combobox reads exactly `expected`."""
    page.wait_for_function(
        f"([key, expected]) => {_MATCHING_FIELDS}.some(f => ({_BOX_TEXT})(f) === expected)",
        arg=[key, expected],
        timeout=SETTLE_MS,
    )


def staged_count(page: Page) -> int:
    """How many changes the pending bar says are staged, read as a number.

    The bar's wording is copy and may change; the number in it is the
    behavior. An empty count reads as nothing staged.
    """
    digits = re.search(r"\d+", page.locator("footer.pending-bar .count").inner_text())
    return int(digits.group()) if digits else 0


def option_names(page: Page, key: str) -> list[str]:
    """A combobox's option labels, with the trailing row marks stripped off each.

    A row carries its favorite heart (filled or empty) and, on rated rows, the
    quality-stars run; both are marks trailing the name, not the name. Only a
    trailing run of marks is stripped, so a mark leaked into the name label
    itself survives into the answer and fails the exact-equality assertions.
    """
    rows = field(page, key).locator(".dd-opt").all_text_contents()
    return [re.sub(r"[\s★☆♥♡]+$", "", row).strip() for row in rows]


def test_the_index_page_renders_the_app_shell(page: Page, stack: Stack) -> None:
    """The served index brings up the whole chrome: header, tabs, body, pending bar."""
    open_app(page, stack)
    # Structure as waits, not as the assertion: the shell failing to come up
    # times out here, while the assertion stays on what the shell offers.
    for selector in ("header.chrome-header", "nav.tab-nav", "main section.tab-body"):
        page.wait_for_selector(selector, timeout=LOAD_MS)
    assert [tab.get_attribute("data-testid") for tab in page.locator("nav.tab-nav").locator("button").all()] == TAB_IDS


@pytest.mark.parametrize("testid", NAMED_CONTROLS)
def test_a_shell_control_carries_an_accessible_name(page: Page, stack: Stack, testid: str) -> None:
    """Every button this suite drives is reachable by role and name, whatever that name reads.

    The suite addresses these controls by `data-testid`, so nothing else here
    would notice a button losing its label entirely. This is the case that would:
    it asks the accessibility tree for a button with a non-empty name and
    requires the identified control to be it, without pinning the wording.
    """
    open_app(page, stack)
    assert named_button(page, testid).count() == 1


def test_the_high_frequency_filter_is_reachable_without_switching_tabs(page: Page, stack: Stack) -> None:
    """The landing tab carries the High-frequency filter: no tab click between load and control.

    Every other case leans on this through `open_app`, where a regression would
    surface as a timeout inside whichever test runs first; this one names the
    behavior. The page is loaded directly — deliberately not via `open_app` —
    and no tab-nav click happens before the assert.
    """
    page.goto(stack.base_url)
    # The waits are bounded polls for the shell and then the field; the assert
    # is what they left on screen.
    page.wait_for_selector("footer.pending-bar", timeout=LOAD_MS)
    page.wait_for_selector(f".field[data-k='{JUNK_KEY}']", timeout=LOAD_MS)
    assert field(page, JUNK_KEY).is_visible()


def test_the_daemons_filter_enumeration_fills_the_live_filter_selector(page: Page, stack: Stack) -> None:
    """The LIVE Nx filter selector offers exactly what the daemon enumerated."""
    open_app(page, stack)
    enter_live(page)
    assert option_names(page, PCM_NX_KEY) == PCM_FILTER_NAMES


def test_staging_a_knob_change_marks_the_pending_bar_as_unapplied(page: Page, stack: Stack) -> None:
    """Picking a new value stages it and the pending bar counts it as unapplied."""
    stack.control_state["filter_junk"] = JUNK_BASELINE_INDEX
    open_app(page, stack)
    clear_staging(page)
    choose(page, JUNK_KEY, JUNK_20K)
    page.wait_for_selector("footer.pending-bar.active", timeout=SETTLE_MS)
    assert staged_count(page) == 1


def test_applying_a_staged_change_sends_the_matching_control_command(page: Page, stack: Stack) -> None:
    """Apply puts SetJunkFilter with the picked index on the control wire."""
    stack.control_state["filter_junk"] = JUNK_BASELINE_INDEX
    open_app(page, stack)
    clear_staging(page)
    choose(page, JUNK_KEY, JUNK_20K)
    page.wait_for_selector("footer.pending-bar.active", timeout=SETTLE_MS)
    mark = len(stack.control_log)
    page.locator("[data-testid='apply']").click()
    page.wait_for_selector(RESULT_NOTE, timeout=APPLY_MS)
    assert ("SetJunkFilter", {"value": JUNK_20K}) in stack.control_log[mark:]


def test_the_applied_value_shows_on_the_control_after_readback(page: Page, stack: Stack) -> None:
    """Once applied, the control reads the value the engine now reports."""
    stack.control_state["filter_junk"] = JUNK_BASELINE_INDEX
    open_app(page, stack)
    clear_staging(page)
    wait_for_combobox_text(page, JUNK_KEY, JUNK_BASELINE_NAME)
    was = combobox_value(page, JUNK_KEY)
    choose(page, JUNK_KEY, JUNK_30K)
    page.wait_for_selector("footer.pending-bar.active", timeout=SETTLE_MS)
    page.locator("[data-testid='apply']").click()
    page.wait_for_selector(OK_NOTE, timeout=APPLY_MS)
    # Reload, so what the control shows is a readback of the engine rather than
    # the value the page optimistically painted when the edit was staged.
    open_app(page, stack)
    wait_for_combobox_change(page, JUNK_KEY, was)
    assert combobox_value(page, JUNK_KEY) == JUNK_30K_NAME


def test_a_write_the_engine_ignores_is_reported_as_a_failed_apply(page: Page, stack: Stack) -> None:
    """A setter the daemon accepts but never applies surfaces as a failure, not a success."""
    stack.control_state["filter_junk"] = JUNK_BASELINE_INDEX
    stack.control_state["_deaf"] = "SetJunkFilter"
    try:
        open_app(page, stack)
        clear_staging(page)
        choose(page, JUNK_KEY, JUNK_20K)
        page.wait_for_selector("footer.pending-bar.active", timeout=SETTLE_MS)
        page.locator("[data-testid='apply']").click()
        # Weaker than the assertion on purpose: this waits for the apply to
        # conclude EITHER way, so an apply that wrongly concluded ok reaches the
        # assertion and fails there rather than timing out here.
        page.wait_for_selector(RESULT_NOTE, timeout=APPLY_MS)
        failed = page.locator(FAIL_NOTE).count() == 1
    finally:
        stack.control_state["_deaf"] = ""
        clear_staging(page)
    assert failed


def test_a_write_the_engine_refuses_is_reported_as_a_failed_apply(page: Page, stack: Stack) -> None:
    """A setter the daemon answers with an Error surfaces as a failure, not a success."""
    stack.control_state["filter_junk"] = JUNK_BASELINE_INDEX
    stack.control_state["_error"] = "SetJunkFilter"
    try:
        open_app(page, stack)
        clear_staging(page)
        choose(page, JUNK_KEY, JUNK_20K)
        page.wait_for_selector("footer.pending-bar.active", timeout=SETTLE_MS)
        page.locator("[data-testid='apply']").click()
        # Weaker than the assertion, for the same reason as the case above.
        page.wait_for_selector(RESULT_NOTE, timeout=APPLY_MS)
        failed = page.locator(FAIL_NOTE).count() == 1
    finally:
        stack.control_state["_error"] = ""
        clear_staging(page)
    assert failed


def test_an_engine_change_sent_by_no_command_shows_in_the_live_view(page: Page, stack: Stack) -> None:
    """The LIVE view follows the engine even when the move came from elsewhere."""
    stack.control_state["filterNx"] = "0"
    open_app(page, stack)
    enter_live(page)
    wait_for_combobox_text(page, PCM_NX_KEY, PCM_FILTER_NAMES[0])
    before = combobox_value(page, PCM_NX_KEY)
    stack.control_state["filterNx"] = "2"
    wait_for_combobox_change(page, PCM_NX_KEY, before)
    assert combobox_value(page, PCM_NX_KEY) == "sinc-M"
