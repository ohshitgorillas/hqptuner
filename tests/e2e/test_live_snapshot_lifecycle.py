"""A live snapshot's life on the faceplate: saved, listed, applied, deleted.

The user saves what the engine is running as a named snapshot in the Snapshot
builder, finds it in the header's Station · Snapshot tree under the loaded
station, taps it there to put the engine back the way it was, and deletes it
from the builder again.

A snapshot belongs to a station, and the tree lists only named stations, so
every test first saves and loads a config preset of its own through the REST
API. That setup is not what is under test; the snapshot steps all go through
the browser.

Policy notes (docs/testing.md):

- One plain `assert` per test. Helpers return evidence: a list of names, a
  setting's value, or a count.
- Names the test typed (the station, the snapshot) are its own wire data and may
  be asserted. The shaper's enum index is the control fake's own table, and the
  other index is the only other entry on either chain.
- Controls are found by `data-testid` and `data-station` where the app carries
  them. The Snapshot builder's name box, Save, Delete and the confirm line's
  Confirm carry neither and are found by structure (the page title row's buttons
  in order, the confirm line's first button), never by their captions.
- No fixed sleep. Locators wait for what they act on; a wait on the engine is
  woken by the app's own control traffic, a ceiling on a condition.
"""

from collections.abc import Iterator
from typing import Literal

import pytest
from playwright.sync_api import Locator, Page, expect
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from e2e.support import stack as stack_support

#: The config preset each test saves and loads, so the tree has a station to list
#: snapshots under. `clean_slate` deletes it before the next test.
STATION = "e2e-snapshot-station"

#: The snapshot each test saves.
SNAPSHOT = "e2e-snapshot"

#: The control fake's State attribute for the shaper, an enum index.
SHAPER = "shaper"

#: The two shaper indices the control fake lists on both chains.
SHAPER_INDICES = ("0", "1")

#: Ceiling on one REST setup call, in ms.
CALL_TIMEOUT = 30_000

#: Ceiling on the engine reaching a state, in seconds.
ENGINE_TIMEOUT = 10.0

#: Ceiling on a control showing up or going away, in ms.
UI_TIMEOUT = 10_000

BUILDER_BODY = "[data-body='snapshots']"
RAIL = f"{BUILDER_BODY} nav"
TITLE_BUTTONS = f"{BUILDER_BODY} main .btitle button.btn"
NAME_BOX = f"{BUILDER_BODY} main .bhead input[type='text']"
CONFIRM_LINE = f"{BUILDER_BODY} main [role='alert'] button"
STATIONS_TRIGGER = "[data-testid='stations']"

WaitState = Literal["attached", "detached", "hidden", "visible"]


@pytest.fixture
def station(page: Page, stack: stack_support.Stack) -> Iterator[None]:
    """STATION saved from the engine's current config and loaded; SNAPSHOT gone from it again at teardown.

    `clean_slate` deletes only the snapshots the loaded station lists and names
    no station on the delete, and by then it has deleted STATION, so a snapshot
    left under STATION would reach it as a 404. The teardown deletes it here, by
    station; a 404 means the test already deleted it.
    """
    for action in ("save", "load"):
        response = page.request.post(
            f"{stack.base_url}/api/profile/{action}", data={"name": STATION}, timeout=CALL_TIMEOUT
        )
        expect(response).to_be_ok()
    yield
    page.request.delete(f"{stack.base_url}/api/livepresets/{SNAPSHOT}?station={STATION}", timeout=CALL_TIMEOUT)


def _app_shaper(page: Page, stack: stack_support.Stack) -> str | None:
    """The shaper index the app last read from the engine."""
    body = page.request.get(f"{stack.base_url}/api/state", timeout=CALL_TIMEOUT).json()
    data = body.get("data") if isinstance(body, dict) else None
    return str(data.get(SHAPER)) if isinstance(data, dict) else None


def _wait_for_station(page: Page) -> None:
    """Wait until the header names STATION as the loaded one."""
    page.locator(f"{STATIONS_TRIGGER} .v", has_text=STATION).wait_for(timeout=UI_TIMEOUT)


def _save_snapshot(page: Page) -> None:
    """In the Snapshot builder, start a New snapshot of what the engine runs, name it SNAPSHOT and save it."""
    page.locator("[data-testid='snapshot-builder']").click()
    page.locator(f"{RAIL} .bnew").click()
    page.locator(NAME_BOX).fill(SNAPSHOT)
    page.locator(TITLE_BUTTONS).last.click()


def _rail_entry(page: Page) -> Locator:
    """SNAPSHOT's line in the builder's rail, titled with its name."""
    return page.locator(f"{RAIL} button[title='{SNAPSHOT}']")


def _settled(locator: Locator, state: WaitState) -> None:
    """Wait, up to the ceiling, for `locator` to reach `state`; carry on either way so the test judges."""
    try:
        locator.wait_for(state=state, timeout=UI_TIMEOUT)
    except PlaywrightTimeoutError:
        return


def _station_rows(page: Page) -> Locator:
    """STATION's snapshot rows in the Station · Snapshot tree, folded or not."""
    return page.locator(f"[data-testid='snapshots'][data-station='{STATION}'] [data-testid='snapshot']")


def _unfold_station(page: Page) -> Locator:
    """Open the Station · Snapshot tree, unfold STATION, and return its snapshot rows."""
    page.locator(STATIONS_TRIGGER).click()
    page.locator(f"[data-testid='unfold'][data-station='{STATION}']").click()
    return _station_rows(page)


def _tree_names(page: Page) -> list[str]:
    """The snapshot names the tree shows under STATION, once any is listed or the ceiling passes.

    The chevron unfolds only a station holding snapshots, so it is tapped only
    once a row exists; with none, the list is empty and the test judges that.
    """
    _settled(_station_rows(page).first, "attached")
    if _station_rows(page).count() == 0:
        return []
    rows = _unfold_station(page)
    _settled(rows.first, "visible")
    return [text.strip() for text in rows.locator(".pn").all_inner_texts()]


def _rail_counts_around_delete(page: Page) -> tuple[int, int]:
    """SNAPSHOT's lines on the builder's rail once it is saved, and again once Delete is confirmed."""
    entry = _rail_entry(page)
    _settled(entry, "visible")
    before = entry.count()
    page.locator(TITLE_BUTTONS).first.click()
    page.locator(CONFIRM_LINE).first.click()
    _settled(entry, "detached")
    return before, entry.count()


@pytest.mark.usefixtures("station")
def test_a_saved_snapshot_is_listed_under_its_station_after_a_reload(page: Page, stack: stack_support.Stack) -> None:
    page.goto(stack.base_url)
    _wait_for_station(page)
    _save_snapshot(page)
    _settled(_rail_entry(page), "visible")
    page.reload()
    _wait_for_station(page)
    assert SNAPSHOT in _tree_names(page)


@pytest.mark.usefixtures("station")
def test_tapping_a_saved_snapshot_puts_the_engine_back_on_its_shaper(page: Page, stack: stack_support.Stack) -> None:
    saved = stack.control_state[SHAPER]
    moved = next(index for index in SHAPER_INDICES if index != saved)
    stack.wait_for_command(lambda: _app_shaper(page, stack) == saved, ENGINE_TIMEOUT)
    page.goto(stack.base_url)
    _wait_for_station(page)
    _save_snapshot(page)
    _settled(_rail_entry(page), "visible")
    stack.control_state[SHAPER] = moved
    stack.wait_for_command(lambda: _app_shaper(page, stack) == moved, ENGINE_TIMEOUT)
    _unfold_station(page).filter(has_text=SNAPSHOT).click()
    stack.wait_for_command(lambda: stack.control_state[SHAPER] == saved, ENGINE_TIMEOUT)
    assert stack.control_state[SHAPER] == saved


@pytest.mark.usefixtures("station")
def test_deleting_a_saved_snapshot_takes_it_off_the_builders_rail(page: Page, stack: stack_support.Stack) -> None:
    page.goto(stack.base_url)
    _wait_for_station(page)
    _save_snapshot(page)
    assert _rail_counts_around_delete(page) == (1, 0)
