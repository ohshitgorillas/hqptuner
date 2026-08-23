"""Browser end-to-end pins on the combobox hover tip's machine markings.

The filter hover tip marks each facet row with `data-facet` (`quality`,
`genre`, `focus`, `phase`, `length`, `ratio`) and each boolean chip with
`data-chip` (`apodizing`, `half-apodizing`, `upsample-only`), so a reader can
tell WHICH facet a row states and WHICH boolean a chip stands for without
reading the label beside it — the labels being owner copy (docs/testing.md
rule 9). `tests/js/components/facettip.test.js` pins the module that computes
those facets; nothing pinned the markings on the rendered tip.

Why this suite is here and not in the combobox component suites: the tip mounts
only while the pop is open with a pointer over an option row, and
`preact-render-to-string` fires no handlers, so the tip markup is unreachable
from the SSR harness — the same limit `tests/js/components/plaindesc-truename.js`
states for `.dd-tip-name`/`.dd-tip-desc`, which is why that suite pins the tip's
name through the module API instead. A real pointer over a real row is the only
way to observe the rendered tip, and that is what a browser test is for.

Every case is a CONTRAST rather than an existence check: a filter the facet
rules place carries the marking and a filter they do not place carries no such
marking, so a tip that marked every row with one constant, or dropped the
markings entirely, fails here.

What the tip states comes from two sources this stack serves for real. The live
enumeration (`tests/support/fake_control.py`) supplies each filter's quality,
ratio and apodizing flag through `GetFilters`; the shipped static overlay
supplies genre and fills phase where a name carries no phase token. The filters
driven here:

- `none` — the pass-through, `1/5 ⥮ 1:1`, `arg="0"`. Rated and ratioed, and
  nothing else: no phase, no length, no boolean facet at all.
- `sinc-M` — no length: the sinc-M set states a tap count and no length letter,
  and nothing classifies it (the rule `facettip.test.js` pins by name).
- `poly-sinc-short-mp` — a `-mp` name token (minimum phase) and a `short` one.

Policy notes (docs/testing.md): one assertion per test; playwright's `expect()`
is never the assertion — locators and `wait_for*` do the waiting and each case
makes one plain `assert`. Rows are addressed by the `data-v` wire value each
carries, never by the words on them. These characterize shipped behavior, so
rule 8's bite requirement does not apply (its stated exemption).
"""

import pytest
from playwright.sync_api import Page

from e2e.support.stack import Stack

#: Bounded waits, in ms — ceilings on a condition poll, never a duration
#: anything is expected to take.
LOAD_MS = 30_000
SETTLE_MS = 20_000

#: The LIVE view's Nx PCM filter selector, keyed by catalog key. It is fed by
#: the daemon's own `GetFilters` enumeration, which is the authority for the
#: names and the descriptions the facets are read out of (architecture §2).
PCM_NX_KEY = "pcm_filter_nx"

#: Option rows by the `data-v` each carries — the enum `value` the control fake
#: serves for the PCM chain, not the row index.
NONE = "0"
SINC_M = "25"
SHORT_MP = "57"


def open_live_filters(page: Page, stack: Stack) -> None:
    """Load the SPA, switch into LIVE and open the Nx filter dropdown."""
    page.goto(stack.base_url)
    page.wait_for_selector("footer.pending-bar", timeout=LOAD_MS)
    switch = page.locator("[data-testid='live-toggle']")
    # The switch latches, so it is driven to the on state rather than toggled.
    if switch.get_attribute("aria-pressed") != "true":
        switch.click()
    page.wait_for_selector(f".field[data-k='{PCM_NX_KEY}']", timeout=LOAD_MS)
    field = page.locator(f".field[data-k='{PCM_NX_KEY}']")
    field.locator("button.dd-box").click()
    field.locator(".dd-opt").first.wait_for(state="visible", timeout=SETTLE_MS)


def hover_tip(page: Page, stack: Stack, value: str) -> None:
    """Put the pointer over the option row carrying `value` and wait for its tip."""
    open_live_filters(page, stack)
    page.locator(f".field[data-k='{PCM_NX_KEY}'] .dd-opt[data-v='{value}']").hover()
    page.wait_for_selector(".dd-tip", state="attached", timeout=SETTLE_MS)


def facets(page: Page) -> list[str | None]:
    """The facet each row of the open tip is marked with, in render order."""
    return [key.get_attribute("data-facet") for key in page.locator(".dd-tip span.dd-tip-key").all()]


def chips(page: Page) -> list[str | None]:
    """The boolean facet each chip of the open tip is marked with."""
    return [chip.get_attribute("data-chip") for chip in page.locator(".dd-tip span.dd-tip-chip").all()]


# --- the facet markings -------------------------------------------------------


@pytest.mark.parametrize("facet", ["quality", "ratio"])
def test_a_facet_every_filter_states_is_marked_on_the_pass_throughs_tip(page: Page, stack: Stack, facet: str) -> None:
    """Quality and ratio come off the live description, so even the pass-through states them."""
    hover_tip(page, stack, NONE)
    assert facet in facets(page)


@pytest.mark.parametrize("facet", ["genre", "phase", "length"])
def test_a_facet_a_resampler_states_is_marked_on_its_tip(page: Page, stack: Stack, facet: str) -> None:
    """A `-short-mp` name is placed by the phase and length rules, and the overlay gives it a genre."""
    hover_tip(page, stack, SHORT_MP)
    assert facet in facets(page)


@pytest.mark.parametrize("facet", ["genre", "phase", "length"])
def test_a_facet_the_pass_through_does_not_state_is_marked_on_no_row_of_its_tip(
    page: Page, stack: Stack, facet: str
) -> None:
    """The pass-through carries none of the three, so none of the three markings appears.

    Paired with the case above: between them, each marking rides the facet it
    names rather than every row, which a single existence check cannot show.
    """
    hover_tip(page, stack, NONE)
    assert facet not in facets(page)


@pytest.mark.parametrize("facet", ["quality", "genre", "phase", "ratio"])
def test_a_facet_the_no_length_filter_states_is_marked_on_its_tip(page: Page, stack: Stack, facet: str) -> None:
    """sinc-M is placed by every facet rule but length, and each of those rows is marked.

    The positive half of the contrast below: without it, a tip that rendered no
    facet rows at all for this filter would satisfy "no length row" too.
    """
    hover_tip(page, stack, SINC_M)
    assert facet in facets(page)


def test_a_filter_no_length_rule_places_is_marked_with_no_length_facet(page: Page, stack: Stack) -> None:
    """sinc-M states a tap count and no length letter, so its tip carries no length row.

    The contrast that makes `data-facet="length"` mean something: the case above
    shows this filter IS marked for quality, genre, phase and ratio.
    """
    hover_tip(page, stack, SINC_M)
    assert "length" not in facets(page)


def test_every_facet_row_of_a_tip_carries_a_marking(page: Page, stack: Stack) -> None:
    """No row ships unmarked: a facet key with no `data-facet` is unreadable by machine."""
    hover_tip(page, stack, SHORT_MP)
    assert None not in facets(page)


# --- the chip markings --------------------------------------------------------


def test_an_apodizing_filters_tip_marks_the_apodizing_chip(page: Page, stack: Stack) -> None:
    """The enumeration sets the apodizing bit on this filter, and the chip says which boolean it is."""
    hover_tip(page, stack, SHORT_MP)
    assert "apodizing" in chips(page)


def test_the_pass_through_filters_tip_carries_no_chip(page: Page, stack: Stack) -> None:
    """It resamples nothing, so it apodizes nothing and its tip has no boolean facet to chip."""
    hover_tip(page, stack, NONE)
    assert chips(page) == []


def test_an_upsample_only_filters_tip_marks_the_upsample_only_chip(page: Page, stack: Stack) -> None:
    """sinc-M is upsample-only in the shipped overlay, and its chip carries that code."""
    hover_tip(page, stack, SINC_M)
    assert "upsample-only" in chips(page)


def test_a_filter_that_is_not_upsample_only_carries_no_such_chip(page: Page, stack: Stack) -> None:
    """The contrast to the case above: this filter is chipped apodizing and not upsample-only.

    A tip that stamped one constant on every chip would pass the case above and
    fail this one.
    """
    hover_tip(page, stack, SHORT_MP)
    assert "upsample-only" not in chips(page)
