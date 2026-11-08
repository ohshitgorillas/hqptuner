"""The browser enforces the page's content policy, and the app runs inside it.

The offline suite proves the headers on the wire. What only a browser shows is that it enforces them, and that the
shipped app, with its inline import map, its fonts, its `data:` favicon and masks and its meter feed, loads and runs
every tab without raising a `securitypolicyviolation`.

Policy notes (docs/testing.md): one plain `assert` per test, bounded waits on a condition, tabs found by `data-testid`.
"""

import pytest
from playwright.sync_api import Page

from e2e.support.stack import Stack

#: Bounded wait, in ms: a ceiling on a condition, never a duration anything is expected to take.
LOAD_MS = 30_000

TAB_IDS = ["tab-output", "tab-volume", "tab-matrix", "tab-system"]

#: Records the page's load and every policy violation it raises, in order, from before its first script runs.
RECORD_EVENTS = """
window.__events = [];
window.addEventListener('load', () => window.__events.push('load'));
document.addEventListener('securitypolicyviolation', (e) =>
  window.__events.push('violation ' + e.violatedDirective + ' ' + e.blockedURI));
"""

#: What the recorder holds for a refused inline script: the directive the browser names and the blocked source.
INLINE_SCRIPT_REFUSED = "violation script-src-elem inline"

#: Adds an inline script the page did not ship.
INJECT_INLINE_SCRIPT = """() => {
  const s = document.createElement('script');
  s.textContent = 'window.__injected = true';
  document.head.appendChild(s);
}"""


@pytest.fixture
def watched(page: Page, stack: Stack) -> Page:
    """A logged-in page that records its load and every policy violation from before its first script runs."""
    page.add_init_script(RECORD_EVENTS)
    page.goto(stack.base_url)
    page.wait_for_selector("nav.tab-nav", timeout=LOAD_MS)
    return page


@pytest.mark.parametrize("tab", TAB_IDS)
def test_every_tab_loads_and_runs_with_no_policy_violation(watched: Page, tab: str) -> None:
    watched.locator(f"[data-testid='{tab}']").click(timeout=LOAD_MS)
    watched.wait_for_selector(f"[data-testid='{tab}'].active", timeout=LOAD_MS)
    assert watched.evaluate("() => window.__events") == ["load"]


def test_the_browser_refuses_an_inline_script_the_page_did_not_ship(watched: Page) -> None:
    watched.evaluate(INJECT_INLINE_SCRIPT)
    watched.wait_for_function("() => window.__events.length > 1", timeout=LOAD_MS)
    assert watched.evaluate("() => window.__events") == ["load", INLINE_SCRIPT_REFUSED]
