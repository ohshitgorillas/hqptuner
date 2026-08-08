"""Fixtures for the browser end-to-end suite.

Every test in this package drives a real headless chromium against a real,
running HQPTuner: the shipped app in its own subprocess, wired to the same wire
fakes the offline suite uses. Nothing inside the app is stubbed, so what these
tests assert on is the frontend, the REST API and the lanes together.

The whole package is skipped if `playwright` is not installed. The `e2e` marker
is applied to every test here automatically — do not write `pytestmark`.

Fixture API
===========

`stack` — session-scoped, yields a `Stack`
------------------------------------------

The running system. One per test session; it is expensive, so it is never torn
down between tests. Attributes:

- `stack.base_url` — `str`. Origin of the app under test, e.g.
  `"http://127.0.0.1:41213"`. No trailing slash. The SPA is at `base_url + "/"`
  and the REST API under `base_url + "/api/..."`.
- `stack.control_log` — `list[tuple[str, dict[str, str]]]`. Every control-API
  (port 4321) command the app has sent, in order, as `(command_name, attrs)` —
  e.g. `("SetFilter", {"value": "40"})`. Appended to live: read it after an
  action to assert what the app told the engine. It is *cumulative across the
  whole session*, so a test that cares about "what did this click send" should
  record `len(stack.control_log)` first and slice from there, or scan for its
  own command name rather than asserting on the list as a whole.
- `stack.control_state` — `dict[str, str]`. The control fake's live State,
  shared across connections the way a real daemon has one engine. Keys are the
  State attribute names (`"state"`, `"mode"`, `"rate"`, `"filter1x"`,
  `"filterNx"`, `"shaper"`, `"volume"`, ...; underscore-prefixed keys are the
  fake's own knobs). Reading it shows what a write actually applied; writing to
  it moves the engine with no command sent, which is how a test simulates the
  daemon changing underneath the UI. It starts at `fake_control.DEFAULTS`.
- `stack.http_state` — `dict[str, Any]`. The HTTP config fake's live state, as
  returned by `fake_http.state()` (`"title"`, `"backend"`, `"filter"`,
  `"samplerate"`, `"volume_fixed"`, `"_restore_attempts"`, ...) plus `"_port"`.
  This is the file-lane truth: an apply that goes through `/restore` shows up
  here.

Because the stack is session-scoped, state a test changes persists into the
next test. Tests must not assume a pristine engine; assert on the transition
they caused, not on absolute starting values.

`browser` — module-scoped, yields `playwright.sync_api.Browser`
----------------------------------------------------------------

Headless chromium, one per test module. Uses the binary named by the
`HQPTUNER_CHROMIUM` environment variable when set, otherwise playwright's own.
Tests rarely need it directly — take `page` instead.

`page` — function-scoped, yields `playwright.sync_api.Page`
------------------------------------------------------------

A fresh browser context and a fresh page for each test, both closed at
teardown, so cookies, storage and console state never leak between tests. The
page starts blank: navigate with `page.goto(stack.base_url)`.

Typical use
-----------

    def test_something(page, stack):
        page.goto(stack.base_url)
        page.get_by_role("button", name="Apply").click()
        assert any(name == "SetFilter" for name, _ in stack.control_log)
"""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest

pytest.importorskip("playwright.sync_api", reason="playwright is required for the browser e2e suite")

from playwright.sync_api import Browser, Page, sync_playwright

from e2e.support import stack as stack_support

HERE = Path(__file__).parent

#: pytest finds the hook below by name, never by reference; naming it here is
#: what tells a static dead-code sweep it is live.
__all__ = ["browser", "page", "pytest_collection_modifyitems", "stack"]


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Mark everything under tests/e2e/ `e2e`, so no author has to remember to."""
    for item in items:
        if item.path is not None and item.path.is_relative_to(HERE):
            item.add_marker("e2e")


@pytest.fixture(scope="session")
def stack(tmp_path_factory: pytest.TempPathFactory) -> Iterator[stack_support.Stack]:
    """The app and its three fakes, up for the whole session."""
    yield from stack_support.stack(tmp_path_factory.mktemp("e2e"))


@pytest.fixture(scope="module")
def browser() -> Iterator[Browser]:
    """Headless chromium, preferring the binary named by HQPTUNER_CHROMIUM."""
    binary = os.environ.get("HQPTUNER_CHROMIUM")
    with sync_playwright() as pw:
        launched = pw.chromium.launch(executable_path=binary) if binary else pw.chromium.launch()
        try:
            yield launched
        finally:
            launched.close()


@pytest.fixture
def page(browser: Browser) -> Iterator[Page]:
    """A fresh context and page per test, closed at teardown."""
    context = browser.new_context()
    try:
        yield context.new_page()
    finally:
        context.close()
