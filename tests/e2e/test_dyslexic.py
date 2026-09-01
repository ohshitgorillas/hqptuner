"""Browser end-to-end cover for the dyslexic-font switch.

The store suite pins the root attribute; what a user actually turns this on for
is the typeface, and only a real browser resolves `--font-ui` through the CSS.
This case drives the switch in the System tab, reloads, and reads the family the
page computes for its own body text, so it fails on a missing `@font-face`, a
missing `:root[data-dyslexic]` rule, a boot that never re-stamps the attribute,
and a switch that never persisted.

Policy notes (docs/testing.md): one assertion per test; the control is addressed
by `data-k` and the tab by `data-testid`, never by their wording (rule 9).
"""

from playwright.sync_api import Page

from e2e.support.stack import Stack

#: Ceiling on the SPA's first paint. Same generous loopback budget the shell
#: suite uses: a load slower than this is a hang, not a slow machine.
LOAD_MS = 15_000

#: The schema key the preference row renders in `data-k`.
DYSLEXIC_KEY = "dyslexic"


def test_the_dyslexic_switch_puts_atkinson_on_the_page_after_a_reload(page: Page, stack: Stack) -> None:
    """Switched on and reloaded, body text computes to the Atkinson family."""
    page.goto(stack.base_url)
    page.wait_for_selector("footer.pending-bar", timeout=LOAD_MS)
    page.click("[data-testid='tab-system']")
    box = page.locator(f".field[data-k='{DYSLEXIC_KEY}'] input[type='checkbox']")
    box.wait_for(timeout=LOAD_MS)
    box.check()
    page.reload()
    page.wait_for_selector("footer.pending-bar", timeout=LOAD_MS)
    assert "Atkinson Hyperlegible" in page.evaluate("getComputedStyle(document.body).fontFamily")
