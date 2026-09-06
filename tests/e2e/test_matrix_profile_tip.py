"""Browser end-to-end pin on the Matrix tab's saved-profile picker and its hover tip.

A saved matrix profile may carry a description — HQPTuner's own store, written
through `PUT /api/descriptions` and keyed by the profile NAME, because
`<matrix_profile>` carries only `name` and hqplayerd's config has nowhere to
hold the text (hqplayerd-readme.txt §1.12). The behavior under test is what a
user sees while PICKING: the row for a profile that carries a description pops
that text beside it, and a row for a profile nobody has described pops nothing.

Why this suite is here and not in `tests/js/components/matrixtab.test.js`: the
tip mounts only while the pop is open with a pointer over an option row, and
`preact-render-to-string` fires no handlers, so the tip markup is unreachable
from the SSR harness (docs/testing.md, "Branches that cannot be reached") —
the same limit `tests/e2e/test_combotip.py` states for the filter picker's tip.
A real pointer over a real row is the only way to observe it.

What the fixture supplies. The saved profile names come from the running
engine's own enumeration, which is the authority for names and ordering
(docs/architecture.md §2); the control fake answers `MatrixListProfiles` with
two of them (`tests/support/fake_control.py`, `_profile_names`). The
description is written by this suite through the app's own route, so the only
string asserted on is one the test itself put on the wire (docs/testing.md
rule 9). Nothing else in the browser suite writes a description, so a row this
suite did not describe has none.

Policy notes (docs/testing.md):

- One assertion per test; playwright's `expect()` is invisible to the assertion
  gate and is not used as the assertion. The helpers do the waiting and the case
  makes exactly one plain `assert`.
- No wait is a wall-clock wait: every ceiling below is a bound on a condition
  poll, never a duration anything is expected to take. The absent-tip half runs
  its bound out and reports "no tip arrived within it" rather than raising, so
  the case fails on its own assertion.
- Controls are addressed by machine identity only: `data-testid` for the tab,
  the `dd-box` / `dd-opt` / `dd-tip` markings the combobox suites already pin,
  and the `data-v` wire value each row carries. No caption is clicked and no
  wording of the app's own is asserted.
- The picker is found as the combobox on the Matrix tab that OFFERS the
  daemon's saved profile names, which is machine identity too, and does not
  assume where in the card it sits.
"""

import json
import urllib.request
from collections.abc import Iterator

import pytest
from playwright.sync_api import Page
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from e2e.support.stack import Stack

#: Bounded waits, in ms — ceilings on a condition poll, never a duration
#: anything is expected to take.
LOAD_MS = 30_000
SETTLE_MS = 20_000

#: Ceiling on "has a tip mounted for the row under the pointer". Also the
#: evidence for the negative half: a row still showing no tip when this runs out
#: is a row with no tip.
TIP_MS = 5_000

#: Ceiling on one probe of a candidate combobox: whether opening it put the
#: profile rows on screen.
PROBE_MS = 2_000

#: Ceiling on one REST call to the running stack, in seconds.
CALL_TIMEOUT = 10.0

#: A saved profile the control fake enumerates, and the description this suite
#: writes for it. The text is the test's own string on the wire, and it is
#: nothing like the profile's name, so a tip built out of the row's name states
#: something else.
DESCRIBED = "Mch-to-Stereo mixdown"
DESCRIPTION = "written by the browser suite"

#: The closed trigger and the option rows of the app's own dropdown, as the
#: combobox suites pin them.
BOX = "button.dd-box"
ROWS = ".dd-opt"


def _put_description(stack: Stack, name: str, text: str) -> None:
    """Write (or, with blank text, clear) one profile description through the app's own route."""
    payload = json.dumps({"name": name, "text": text}).encode()
    request = urllib.request.Request(  # noqa: S310 — literal loopback http URL
        f"{stack.base_url}/api/descriptions",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    with urllib.request.urlopen(request, timeout=CALL_TIMEOUT) as response:  # noqa: S310 — same URL
        response.read()


@pytest.fixture
def described(stack: Stack) -> Iterator[str]:
    """One saved profile carrying a description, cleared again so nothing leaks into the session."""
    _put_description(stack, DESCRIBED, DESCRIPTION)
    try:
        yield DESCRIBED
    finally:
        _put_description(stack, DESCRIBED, "   ")


def _open_picker(page: Page, stack: Stack) -> None:
    """Load the SPA, open the Matrix tab and open the saved-profile picker.

    The picker is the combobox whose rows carry the daemon's own profile names;
    each candidate is opened until those rows are on screen, so nothing here
    depends on where in the card the control sits.
    """
    page.goto(stack.base_url)
    page.wait_for_selector("footer.pending-bar", timeout=LOAD_MS)
    page.locator("[data-testid='tab-matrix']").click()
    page.wait_for_selector(BOX, timeout=LOAD_MS)
    boxes = page.locator(BOX)
    for index in range(boxes.count()):
        box = boxes.nth(index)
        box.click()
        try:
            page.locator(f"{ROWS}[data-v='{DESCRIBED}']").first.wait_for(state="visible", timeout=PROBE_MS)
        except PlaywrightTimeoutError:
            box.click()
        else:
            return
    raise RuntimeError("no combobox on the Matrix tab offers the daemon's saved profiles")


def _open_rows(page: Page) -> list[str]:
    """The wire value of every row of the open picker, in render order."""
    pop = page.locator(f".dd-pop:has({ROWS}[data-v='{DESCRIBED}'])")
    return [value for row in pop.locator(ROWS).all() if (value := row.get_attribute("data-v")) is not None]


def _tip_over(page: Page, stack: Stack, value: str) -> str | None:
    """The text of the tip that mounts with the pointer over one row, or None when none mounts.

    Each row is taken on its own fresh load of the page, so a tip left over from
    an earlier hover can never be read as this row's.
    """
    _open_picker(page, stack)
    page.locator(f".dd-pop:has({ROWS}[data-v='{DESCRIBED}']) {ROWS}[data-v='{value}']").hover()
    try:
        page.wait_for_selector(".dd-tip", state="attached", timeout=TIP_MS)
    except PlaywrightTimeoutError:
        return None
    return page.locator(".dd-tip").first.text_content() or ""


def test_only_the_described_profiles_row_pops_a_tip_and_it_states_the_description(
    page: Page, stack: Stack, described: str
) -> None:
    """Exactly the described row shows a tip, and that tip carries the text the test wrote.

    Two wrong pickers fail here: one that builds the tip out of the row's name
    states the name instead of the description, and one that mounts a tip for
    every row puts an empty popover beside the profile nobody described.
    """
    _open_picker(page, stack)
    seen = {value: _tip_over(page, stack, value) for value in _open_rows(page)}
    tipped = {value for value, tip in seen.items() if tip is not None}
    assert (tipped, DESCRIPTION in (seen.get(described) or "")) == ({described}, True)
