"""A state file downloaded from the settings page and uploaded back gives the settings back as they were downloaded.

The user's path is the About HQPTuner block on the settings page: the download
link fetches the state archive, the upload input posts it back, and HQPTuner's
own stores are replaced by what the archive carries. Each test puts one setting
at a value of its own choosing, downloads the state file through the page,
moves the setting to a second value, uploads the downloaded file through the
page, and reads the setting back from the server.

Two stores are exercised because the import reaches them by different routes:
a live snapshot sits in a single-file store, which the import writes to the
path the install's config names for it; the autosave flag sits in the preset
store's own settings file, which the import hands to the preset store.

Policy notes:

- The expected value is one the test wrote itself, never one the app chose, and
  it differs from both the setting's second value and the engine fake's default.
- The browser lane is the point: the download link and the upload input are
  what is under test, together with the stores behind them.
- Controls are found by `data-testid`. The download and the upload's response
  are waited on as events, each under a ceiling.
- Both settings are ones `clean_slate` puts back before the next test: a live
  snapshot the session did not start with is deleted, and autosave is reset.
"""

from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import Page

from e2e.support import stack as stack_support

#: The live snapshot the test saves, a name the session does not start with.
SNAPSHOT = "backup-roundtrip"

#: A live snapshot setting whose value the save takes from the request: a 0/1 flag.
FLAG_FIELD = "adaptive_volume"

#: The flag's value when the state file is downloaded; not the engine fake's default.
FLAG_EXPORTED = "1"

#: The flag's value between the download and the upload.
FLAG_CHANGED = "0"

#: Autosave when the state file is downloaded, and between the download and the upload.
AUTOSAVE_EXPORTED = True
AUTOSAVE_CHANGED = False

#: Ceiling on a control appearing, the download arriving, and the upload answering.
#: A ceiling on a condition, never a duration anything is expected to take.
SETTLE_TIMEOUT = 10_000


class _SetupRefusedError(RuntimeError):
    """A write the test makes to put a setting in place was refused, so the test cannot say anything."""

    def __init__(self, *, route: str, status: int, body: str) -> None:
        super().__init__(f"{route} refused the setup write: {status} {body}")


def _save_flag(page: Page, base_url: str, value: str) -> None:
    """Save the test's live snapshot holding only the flag, at `value`. Raises when the save is refused.

    A refused second save would leave the downloaded value in place and let the test pass with no upload at all.
    """
    route = f"/api/livepresets/{quote(SNAPSHOT, safe='')}"
    response = page.request.put(f"{base_url}{route}", data={"fields": [FLAG_FIELD], "values": {FLAG_FIELD: value}})
    if not response.ok:
        raise _SetupRefusedError(route=route, status=response.status, body=response.text())


def _loaded_station(page: Page, base_url: str) -> str:
    """The station the server has loaded, which a snapshot saved with no station named is filed under."""
    return str(page.request.get(f"{base_url}/api/livepresets").json()["station"])


def _saved_flag(page: Page, base_url: str, station: str) -> str | None:
    """The flag as the test's live snapshot under `station` holds it, or None when no such snapshot or flag."""
    book = page.request.get(f"{base_url}/api/livepresets").json()["stations"]
    record = book.get(station, {}).get(SNAPSHOT)
    if record is None:
        return None
    value = record["fields"].get(FLAG_FIELD)
    return None if value is None else str(value)


def _set_autosave(page: Page, base_url: str, *, enabled: bool) -> None:
    """Turn autosave on or off. Raises when the switch is refused, for the reason `_save_flag` does."""
    route = "/api/autosave"
    response = page.request.post(f"{base_url}{route}", data={"enabled": enabled})
    if not response.ok:
        raise _SetupRefusedError(route=route, status=response.status, body=response.text())


def _autosave(page: Page, base_url: str) -> bool:
    """Autosave as the server reports it in the config the page loads."""
    return bool(page.request.get(f"{base_url}/api/config").json()["data"]["autosave"])


def _download_state(page: Page, base_url: str, into: Path) -> Path:
    """Open the settings page, download the state file through its link, and return where it was saved."""
    page.goto(base_url)
    page.locator('[data-testid="settings"]').click(timeout=SETTLE_TIMEOUT)
    link = page.locator('[data-testid="state-export"]')
    with page.expect_download(timeout=SETTLE_TIMEOUT) as pending:
        link.click(timeout=SETTLE_TIMEOUT)
    target = into / pending.value.suggested_filename
    pending.value.save_as(target)
    return target


def _upload_state(page: Page, archive: Path) -> None:
    """Upload `archive` through the settings page's state input and wait for the import's answer, whatever it is."""
    picker = page.locator('[data-testid="state-import"]')
    with page.expect_response(
        lambda r: r.url.endswith("/api/state-import") and r.request.method == "POST", timeout=SETTLE_TIMEOUT
    ):
        picker.set_input_files(archive, timeout=SETTLE_TIMEOUT)


def test_uploading_a_downloaded_state_file_gives_a_live_snapshot_setting_back_as_downloaded(
    page: Page, stack: stack_support.Stack, tmp_path: Path
) -> None:
    """A live snapshot setting moved after the download reads back at its downloaded value once the file is uploaded."""
    base = stack.base_url
    station = _loaded_station(page, base)
    _save_flag(page, base, FLAG_EXPORTED)
    archive = _download_state(page, base, tmp_path)
    _save_flag(page, base, FLAG_CHANGED)
    _upload_state(page, archive)
    assert _saved_flag(page, base, station) == FLAG_EXPORTED


def test_uploading_a_downloaded_state_file_gives_the_autosave_flag_back_as_downloaded(
    page: Page, stack: stack_support.Stack, tmp_path: Path
) -> None:
    """Autosave switched after the download reads back as it was downloaded once the file is uploaded."""
    base = stack.base_url
    _set_autosave(page, base, enabled=AUTOSAVE_EXPORTED)
    archive = _download_state(page, base, tmp_path)
    _set_autosave(page, base, enabled=AUTOSAVE_CHANGED)
    _upload_state(page, archive)
    assert _autosave(page, base) is AUTOSAVE_EXPORTED
