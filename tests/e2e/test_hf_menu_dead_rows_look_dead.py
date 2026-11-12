"""How an HF menu row that does nothing on the playing content looks, on screen.

The engine row's HF filter menu lists the engine's playback filters. A filter
that does nothing on the content playing is drawn dead: other ink than the same
row where the filter acts, a plain cursor in place of the tap cursor, and no
hover wash. Each test plays a source, opens the menu, and reads one row's
rendered look.

Policy notes:

- Browser lane: the rendered component suite pins the grayed row's `disabled`
  flag and that a tap writes nothing; what the stylesheet does with that flag
  exists only once a browser computes the style. The lamp on the rail follows
  the content in the store and rendered suites already, so it is not read here.
- A look is only ever compared with another observed look, never with a literal
  color, cursor name or token: the same row while the content changes under it,
  or the same row hovered and not.
- The fake engine's HF filters are `none`, `20k` and `30k` (`fake_control`).
  Its `20k` does nothing on a 44.1 kHz source and acts on an 88.2 kHz one, both
  rates the test puts on the wire on the Status frame's `<metadata>` child.
- Controls are found by wire identity: the menu's trigger and panel
  (`data-pop`), a row by its role and the engine's name for its filter, and a
  dead row by its `disabled` flag.
- The engine's transport and track are put back as the test found them. Opening
  the menu and hovering a row write nothing.
"""

from collections.abc import Iterator

import pytest
from playwright.sync_api import Locator, Page

from e2e.support import stack as stack_support

#: State's transport value for playing.
PLAYING = "2"

#: A source rate no HF filter acts on, and one the fake's `20k` acts on.
DEAD_RATE = "44100"
ACTING_RATE = "88200"

#: The fake engine's filter whose row the tests read.
ROW_NAME = "20k"

#: The HF menu's trigger and its open panel.
TRIGGER = "button[data-pop='hf']"
PANEL = "div[data-pop='hf'][role='menu']"

#: Ceiling on the page following a change of source or opening the menu, ms. The
#: app polls the fake every 0.1 s and pushes what moved, so a working page is far inside it.
FOLLOW_TIMEOUT_MS = 5000.0


def _metadata(rate: str) -> str:
    """The Status frame's `<metadata>` child for a stereo PCM source at `rate`."""
    return f'<metadata samplerate="{rate}" bits="24" channels="2"/>'


@pytest.fixture
def playing(stack: stack_support.Stack) -> Iterator[stack_support.Stack]:
    """The session stack playing a source; its transport and track are put back afterwards."""
    state = stack.control_state
    was_state, was_metadata = state["state"], state["_metadata"]
    state["_metadata"] = _metadata(DEAD_RATE)
    state["state"] = PLAYING
    try:
        yield stack
    finally:
        state["state"] = was_state
        state["_metadata"] = was_metadata


def _row(page: Page, stack: stack_support.Stack) -> Locator:
    """Load the page, open the HF menu, and return the row the tests read."""
    page.goto(stack.base_url)
    page.locator(TRIGGER).click(timeout=FOLLOW_TIMEOUT_MS)
    page.locator(PANEL).wait_for(state="visible", timeout=FOLLOW_TIMEOUT_MS)
    return page.locator(f"{PANEL} button[role='menuitemradio']", has_text=ROW_NAME)


def _play(stack: stack_support.Stack, row: Locator, rate: str) -> None:
    """Play a source at `rate` and wait until the row is drawn dead or live for it."""
    stack.control_state["_metadata"] = _metadata(rate)
    dead = "true" if rate == DEAD_RATE else "false"
    row.page.wait_for_function(
        "([row, dead]) => String(row.disabled) === dead",
        arg=[row.element_handle(timeout=FOLLOW_TIMEOUT_MS), dead],
        timeout=FOLLOW_TIMEOUT_MS,
    )


def _style(row: Locator, prop: str) -> str:
    """The row's computed value of `prop`."""
    return str(row.evaluate("(el, prop) => getComputedStyle(el).getPropertyValue(prop)", prop))


def _looks(page: Page, stack: stack_support.Stack, prop: str) -> tuple[str, str]:
    """The row's `prop` where its filter does nothing on the content, then where it acts."""
    row = _row(page, stack)
    _play(stack, row, DEAD_RATE)
    dead = _style(row, prop)
    _play(stack, row, ACTING_RATE)
    return dead, _style(row, prop)


def test_a_row_that_does_nothing_on_the_content_reads_in_other_ink_than_where_it_acts(
    page: Page, playing: stack_support.Stack
) -> None:
    dead, acting = _looks(page, playing, "color")
    assert dead != acting


def test_a_row_that_does_nothing_on_the_content_shows_another_cursor_than_where_it_acts(
    page: Page, playing: stack_support.Stack
) -> None:
    dead, acting = _looks(page, playing, "cursor")
    assert dead != acting


def test_hovering_a_row_that_does_nothing_on_the_content_paints_no_wash(
    page: Page, playing: stack_support.Stack
) -> None:
    row = _row(page, playing)
    _play(playing, row, DEAD_RATE)
    resting = _style(row, "background-color")
    row.hover(timeout=FOLLOW_TIMEOUT_MS)
    assert _style(row, "background-color") == resting
