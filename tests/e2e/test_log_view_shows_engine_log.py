"""The Logging drawer's log view shows the lines of HQPlayer's own log.

A user opens Settings, taps the Logging category, and the drawer's log pane
prints the lines the daemon serves on its log page; while the drawer stays open,
a line the daemon adds to its log reaches the pane without the user doing
anything.

Each test writes a log of its own onto the HTTP fake's log page, so every
expected line is wire data the test put there, and puts the fake's log back
afterwards.

Policy notes (docs/testing.md):

- Browser lane: the read starts from an effect that runs only when the drawer
  opens in a real browser, and the pane refreshes on a timer. Server rendering
  runs neither, and the tail arithmetic and the read's caching are pinned at
  the engine and REST lanes already.
- One assertion per test. The helper waits for a condition and returns what
  the pane holds; the test judges it. A wait that runs out returns the pane as
  it stands, so a missing line fails the assertion rather than the wait.
- Controls are found by machine identity: the gear's `data-testid`, the rail
  category's `data-stage`, the drawer's id.
- Waits are bounded condition-polls; the timeout is a ceiling, never a duration.
"""

import contextlib
from collections.abc import Iterator

import pytest
from playwright.sync_api import Page
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from e2e.support import stack as stack_support

#: The Settings rail category whose drawer holds the log view.
LOGGING_STAGE = "logging"

#: The log pane inside the Logging drawer.
PANE = f"#drawer-{LOGGING_STAGE} pre"

#: The HTTP fake's key for the body it serves on the daemon's log page.
LOG_KEY = "_log"

#: Ceiling on the pane reaching a condition. Covers one refresh interval plus
#: the server's hold on a recently read log, with room for a loaded host.
PANE_TIMEOUT = 15_000

#: A short log, fewer lines than the pane shows, each line unique to this file.
SHORT_LOG = (
    "e2e-logview: engine started",
    "e2e-logview: output device opened",
    "e2e-logview: 44100 Hz input",
    "e2e-logview: filter loaded",
    "e2e-logview: playback running",
)

#: The log the follow test opens on, and the line the daemon then adds to it.
FOLLOW_LOG = (
    "e2e-logfollow: engine started",
    "e2e-logfollow: playback running",
)
APPENDED_LINE = "e2e-logfollow: playback stopped"

#: True once the pane's lines include `line`.
HOLDS_LINE_JS = """
({ pane, line }) => (document.querySelector(pane)?.textContent ?? "").split("\\n").includes(line)
"""

#: True once the pane's text differs from `before`, or the pane is gone.
CHANGED_JS = """
({ pane, before }) => (document.querySelector(pane)?.textContent ?? null) !== before
"""

#: The pane's text, or null when the drawer shows no pane.
PANE_TEXT_JS = """
(pane) => document.querySelector(pane)?.textContent ?? null
"""


def _log_body(lines: tuple[str, ...]) -> str:
    """The log page body for `lines`, newline-terminated the way a log file is."""
    return "".join(f"{line}\n" for line in lines)


@pytest.fixture
def daemon_log(stack: stack_support.Stack) -> Iterator[dict[str, object]]:
    """The HTTP fake's state, with its log page put back to what it served before the test."""
    before = stack.http_state[LOG_KEY]
    yield stack.http_state
    stack.http_state[LOG_KEY] = before


def _pane_text(page: Page) -> str | None:
    """What the log pane prints right now, or None when it is not there."""
    text = page.evaluate(PANE_TEXT_JS, PANE)
    return text if isinstance(text, str) else None


def _pane_lines(page: Page) -> list[str]:
    """The log pane's lines as it stands; none when it is not there."""
    text = _pane_text(page)
    return [] if text is None else text.split("\n")


def _open_log_view(page: Page, stack: stack_support.Stack) -> None:
    """Load the app, open Settings and tap the Logging category."""
    page.goto(f"{stack.base_url}/")
    page.locator("[data-testid='settings']").click()
    page.locator(f'button[data-stage="{LOGGING_STAGE}"]').click()


def _pane_once_it_holds(page: Page, line: str) -> list[str]:
    """Wait, up to the ceiling, for the pane to print `line`, then return its lines whichever way the wait ended."""
    with contextlib.suppress(PlaywrightTimeoutError):
        page.wait_for_function(HOLDS_LINE_JS, arg={"pane": PANE, "line": line}, timeout=PANE_TIMEOUT)
    return _pane_lines(page)


def _pane_once_it_changes(page: Page, before: str | None) -> list[str]:
    """Wait, up to the ceiling, for the pane to differ from `before`, then return its lines whichever way it ended."""
    with contextlib.suppress(PlaywrightTimeoutError):
        page.wait_for_function(CHANGED_JS, arg={"pane": PANE, "before": before}, timeout=PANE_TIMEOUT)
    return _pane_lines(page)


def test_opening_the_logging_drawer_prints_every_line_of_a_short_engine_log(
    page: Page, stack: stack_support.Stack, daemon_log: dict[str, object]
) -> None:
    """A log shorter than the pane's window shows whole, oldest line first, one line per log line."""
    daemon_log[LOG_KEY] = _log_body(SHORT_LOG)
    _open_log_view(page, stack)
    shown = _pane_once_it_holds(page, SHORT_LOG[-1])
    assert shown == list(SHORT_LOG)


def test_a_line_the_engine_adds_while_the_log_view_is_open_reaches_the_pane(
    page: Page, stack: stack_support.Stack, daemon_log: dict[str, object]
) -> None:
    """With the drawer left open, the pane picks up the daemon's newest line as its last line, with no user action."""
    daemon_log[LOG_KEY] = _log_body(FOLLOW_LOG)
    _open_log_view(page, stack)
    _pane_once_it_holds(page, FOLLOW_LOG[-1])
    before = _pane_text(page)
    daemon_log[LOG_KEY] = _log_body((*FOLLOW_LOG, APPENDED_LINE))
    shown = _pane_once_it_changes(page, before)
    assert shown[-1:] == [APPENDED_LINE]
