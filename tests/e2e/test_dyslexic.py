"""Browser end-to-end cover for the dyslexic-font switch.

The store suite pins the root attribute; what a user actually turns this on for
is the typeface, and only a real browser resolves `--font-ui` through the CSS.
This case drives the switch in the System tab, reloads, and reads the family the
page computes for its own body text, so it fails on a missing
`:root[data-dyslexic]` rule, a boot that never re-stamps the attribute, and a
switch that never persisted.

Policy notes (docs/testing.md): one assertion per test; the control is addressed
by `data-k` and the tab by `data-testid`, never by their wording (rule 9). The
font family the mode lands on is not named here either: the face is the owner's
to change, so the case compares against the family the page computed before the
switch rather than pinning a name.
"""

from playwright.sync_api import Page

from e2e.support.stack import Stack

#: Ceiling on the SPA's first paint. Same generous loopback budget the shell
#: suite uses: a load slower than this is a hang, not a slow machine.
LOAD_MS = 15_000

#: The schema key the preference row renders in `data-k`.
DYSLEXIC_KEY = "dyslexic"

#: What the page resolves `--font-ui` to for its own body text.
BODY_FAMILY = "getComputedStyle(document.body).fontFamily"


def test_the_dyslexic_switch_changes_the_body_font_across_a_reload(page: Page, stack: Stack) -> None:
    """Switched on and reloaded, body text computes to a different family than the default.

    Which face it lands on is the owner's choice and is asserted nowhere
    (rule 9); that the switch reaches the rendered typeface at all, and survives
    the reload, is the behavior.
    """
    page.goto(stack.base_url)
    page.wait_for_selector("footer.pending-bar", timeout=LOAD_MS)
    default_family = page.evaluate(BODY_FAMILY)
    page.click("[data-testid='tab-system']")
    box = page.locator(f".field[data-k='{DYSLEXIC_KEY}'] input[type='checkbox']")
    box.wait_for(timeout=LOAD_MS)
    box.check()
    page.reload()
    page.wait_for_selector("footer.pending-bar", timeout=LOAD_MS)
    assert page.evaluate(BODY_FAMILY) != default_family
