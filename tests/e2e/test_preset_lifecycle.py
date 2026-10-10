"""A station loaded and exported through the faceplate does what the user asked of it.

A station is a whole configuration held in HQPTuner's preset store. The
header's Station · Snapshot tree loads one by name, and the settings page's
Download state link exports the store. Each test drives one user action through
the page and reads the outcome from the server or the downloaded file.

Policy notes (docs/testing.md):

- One assertion per test. Helpers return what they observed and raise when a
  setup write is refused, so a refused setup never reads as a pass.
- Every expected value is a station name the test chose itself, and it differs
  from what the server held before the action.
- Controls are found by `data-testid` and `data-station`.
- No fixed sleep: each action's own request or download is waited on as an
  event, under a ceiling.
- Server state left behind: the stations these tests create are removed by
  `clean_slate`. The active station pointer is not reset by `clean_slate`; it
  is cleared when `clean_slate` deletes the test station that was active.
"""

import io
import zipfile
from pathlib import Path

from playwright.sync_api import Page

from e2e.support import stack as stack_support

#: Stations these tests save into the preset store; the session does not start with either.
STATION_A = "lifecycle-a"
STATION_B = "lifecycle-b"

#: The archive member a station is exported under: the preset store's name, then the station's file.
EXPORT_MEMBER = "presets/{name}.xml"

#: Ceiling on a control appearing, a request answering and a download arriving.
#: A ceiling on a condition, never a duration anything is expected to take.
SETTLE_TIMEOUT = 15_000


class _SetupRefusedError(RuntimeError):
    """A write the test makes to put state in place was refused, so the test cannot say anything."""

    def __init__(self, *, route: str, status: int, body: str) -> None:
        super().__init__(f"{route} refused the setup write: {status} {body}")


def _post(page: Page, base_url: str, route: str, data: object) -> None:
    """POST `data` to `route`, raising when the server refuses it."""
    response = page.request.post(f"{base_url}{route}", data=data, timeout=SETTLE_TIMEOUT)
    if not response.ok:
        raise _SetupRefusedError(route=route, status=response.status, body=response.text())


def _active(page: Page, base_url: str) -> object:
    """The station the server reports as loaded, as `/api/config` carries it."""
    active: object = page.request.get(f"{base_url}/api/config").json()["data"]["active"]
    return active


def _save_station(page: Page, base_url: str, name: str) -> None:
    """Save the running configuration as station `name`; the server makes it the loaded station."""
    _post(page, base_url, "/api/profile/save", {"name": name})


def _open_tree(page: Page, base_url: str) -> None:
    """Open the page and the header's Station · Snapshot tree."""
    page.goto(base_url)
    page.locator('[data-testid="stations"]').click(timeout=SETTLE_TIMEOUT)


def test_tapping_a_station_in_the_tree_makes_it_the_loaded_station(page: Page, stack: stack_support.Stack) -> None:
    """A station other than the loaded one, tapped by name in the tree, is loaded once the switch applies."""
    base = stack.base_url
    _save_station(page, base, STATION_A)
    _save_station(page, base, STATION_B)
    _open_tree(page, base)
    name = page.locator(f'[data-testid="station-row"][data-station="{STATION_A}"] [data-testid="station-name"]')
    with page.expect_response(
        lambda r: r.url.endswith("/api/config/apply") and r.request.method == "POST", timeout=SETTLE_TIMEOUT
    ):
        name.click(timeout=SETTLE_TIMEOUT)
    assert _active(page, base) == STATION_A


def test_downloading_state_exports_a_saved_station(page: Page, stack: stack_support.Stack, tmp_path: Path) -> None:
    """A station saved before the download is a member of the state file the settings page downloads."""
    base = stack.base_url
    _save_station(page, base, STATION_A)
    page.goto(base)
    page.locator('[data-testid="settings"]').click(timeout=SETTLE_TIMEOUT)
    with page.expect_download(timeout=SETTLE_TIMEOUT) as pending:
        page.locator('[data-testid="state-export"]').click(timeout=SETTLE_TIMEOUT)
    target = tmp_path / pending.value.suggested_filename
    pending.value.save_as(target)
    members = zipfile.ZipFile(io.BytesIO(target.read_bytes())).namelist()
    assert EXPORT_MEMBER.format(name=STATION_A) in members
