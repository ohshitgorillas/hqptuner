"""Browser end-to-end checks for the login: the outcomes only a browser can show.

The offline suite proves the gate, the login route and the cookie's attributes over the wire. What it cannot show
is whether a browser stores that cookie and sends it back on its own `fetch`, on the meter feed's `EventSource` and
on a download link, over the plain-HTTP loopback origin the stack serves. These cases drive that.

Two journeys with no login, then three with it:

- a browser with no login gets the Connection panel and no tab bar, and logging in through the panel loads the app;
- a logged-in browser loads the UI with no gated response refused, its meter feed request is answered 200, and the
  System tab's two download links deliver a zip archive.

Policy notes (docs/testing.md): one plain `assert` per test, locators and bounded waits do the waiting, no sleeps,
and controls are found by `data-testid`, state attributes and wire paths, never by the words on them. The meter feed
sends events only while the engine plays and the stack's metering socket serves no frames, so the feed is held to
its response, not to events. The advisor is off in every build (`config.ADVISOR_ENABLED`), so the stack answers the
feed 204 where a build with it on answers 200; either is an answer to a request that carried the login, and a 401
is the refusal this case is written to catch.
"""

import zipfile
from collections.abc import Iterator

import pytest
from playwright.sync_api import Browser, Page, Response

from e2e.support.stack import APP_PAIR, Stack

#: Bounded waits, in ms: ceilings on a condition, never a duration anything is expected to take.
LOAD_MS = 30_000

PANEL = "[data-testid='setup-panel']"
TAB_BAR_ENTRY = "[data-testid='tab-system']"
SAVE = "[data-testid='setup-save']"
FEED_PATH = "/api/meter/feed"
OPEN_PATHS = ("/api/health", "/api/login")


@pytest.fixture
def anonymous_page(browser: Browser, stack: Stack) -> Iterator[Page]:
    """A fresh context with no cookie at all, opened on the app and waited until it shows the login screen."""
    context = browser.new_context()
    page = context.new_page()
    try:
        page.goto(stack.base_url)
        page.wait_for_selector(PANEL, timeout=LOAD_MS)
        yield page
    finally:
        context.close()


def _row(key: str) -> str:
    """The selector for one row of the Connection panel."""
    return f"[data-testid='setup-{key}']"


def _gated_answers(page: Page, stack: Stack) -> list[Response]:
    """Load the app on a logged-in page and return every gated response seen up to the feed's.

    The feed is opened at start-up, after the first polls have gone out, so its response closes the window.
    """
    seen: list[Response] = []

    def note(response: Response) -> None:
        seen.append(response)

    page.on("response", note)
    with page.expect_response(lambda r: r.url.endswith(FEED_PATH), timeout=LOAD_MS):
        page.goto(stack.base_url)
    page.wait_for_selector("footer.pending-bar", timeout=LOAD_MS)
    return [r for r in seen if "/api/" in r.url and not r.url.endswith(OPEN_PATHS)]


def test_a_browser_with_no_login_shows_the_panel_and_nothing_else(anonymous_page: Page) -> None:
    assert anonymous_page.locator(f"{PANEL}, {TAB_BAR_ENTRY}").count() == 1


def test_logging_in_through_the_panel_lets_the_browser_fetch_gated_routes(anonymous_page: Page) -> None:
    anonymous_page.fill(_row("username"), APP_PAIR[0])
    anonymous_page.fill(_row("password"), APP_PAIR[1])
    with anonymous_page.expect_navigation(timeout=LOAD_MS):
        anonymous_page.click(SAVE)
    assert anonymous_page.evaluate("fetch('/api/state').then((r) => r.status)") == 200


def test_a_logged_in_page_loads_with_no_gated_response_refused(page: Page, stack: Stack) -> None:
    assert 401 not in {r.status for r in _gated_answers(page, stack)}


def test_a_logged_in_page_has_its_meter_feed_request_answered(page: Page, stack: Stack) -> None:
    with page.expect_response(lambda r: r.url.endswith(FEED_PATH), timeout=LOAD_MS) as feed:
        page.goto(stack.base_url)
    assert feed.value.status in {200, 204}


@pytest.mark.parametrize("href", ["/api/backup", "/api/state-export"])
def test_a_download_link_delivers_a_zip_archive(page: Page, stack: Stack, href: str) -> None:
    page.goto(stack.base_url)
    page.wait_for_selector("footer.pending-bar", timeout=LOAD_MS)
    page.locator(TAB_BAR_ENTRY).click()
    with page.expect_download(timeout=LOAD_MS) as download:
        page.locator(f"a[href='{href}']").click()
    assert zipfile.is_zipfile(download.value.path())
