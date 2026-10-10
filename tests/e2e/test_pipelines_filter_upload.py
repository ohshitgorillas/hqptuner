"""Uploading a convolution filter from the DSP pipelines drawer's Overview tab.

A filter the user picks goes to the app's filter route; one the app takes is
listed in the drawer by its file name, and one it refuses is not listed and
the drawer tells the user something other than what it says for a stored one.

Policy notes:

- The Overview's file picker hands its files to the upload through an event
  handler, which server rendering never fires, so this is the browser lane.
- Controls are found by wire identity: the rail stage (`data-stage`), the drawer
  id and the tab id (`data-tab`). The picker is the Overview's one multi-file
  input; the listed names and the note have no `data-testid`, so they are
  reached by the classes the drawer renders them with.
- The listed name is the file name this test handed in, so it is wire data and
  is asserted verbatim. The refusal is pinned only as a note that differs from
  the one a stored filter gets.
"""

import struct

from playwright.sync_api import FilePayload, Locator, Page
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from e2e.support import stack as stack_support

#: The DSP pipelines drawer's rail stage, and so its drawer id suffix.
PIPELINES_STAGE = "pipelines"

#: The tab the filter upload sits on.
OVERVIEW_TAB = "overview"

#: The app's filter upload route, which every pick posts to.
FILTER_ROUTE = "/api/matrix/filter"

#: Ceiling on the drawer answering an upload, in ms.
ANSWER_TIMEOUT = 10_000

#: A WAV's format: PCM, stereo, 352.8 kHz, 16-bit, and how many frames it holds.
PCM_FORMAT = 1
CHANNELS = 2
RATE = 352_800
BITS = 16
FRAMES = 64


def _wav(frames: int) -> bytes:
    """A well-formed PCM RIFF/WAVE file of `frames` frames: one unit impulse, then silence."""
    block = CHANNELS * BITS // 8
    fmt = struct.pack("<HHIIHH", PCM_FORMAT, CHANNELS, RATE, RATE * block, block, BITS)
    impulse = struct.pack("<" + "h" * CHANNELS, *([1] * CHANNELS))
    samples = impulse + bytes(block * (frames - 1))
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(samples)) + samples
    return b"RIFF" + struct.pack("<I", len(body)) + body


def _stored(name: str) -> FilePayload:
    """A filter the app takes: a real WAV named `name`."""
    return FilePayload(name=name, mimeType="audio/wav", buffer=_wav(FRAMES))


def _refused(name: str) -> FilePayload:
    """A filter the app refuses: named `name`, a `.wav`, but not a RIFF/WAVE container."""
    return FilePayload(name=name, mimeType="audio/wav", buffer=b"this is not a wave file at all")


def _overview(page: Page, stack: stack_support.Stack) -> Locator:
    """Load the app, open the DSP pipelines drawer on its Overview tab, and return that tab's panel."""
    page.goto(f"{stack.base_url}/")
    page.locator(f'button[data-stage="{PIPELINES_STAGE}"]').click()
    drawer = page.locator(f"#drawer-{PIPELINES_STAGE}")
    drawer.locator(f'[role="tab"][data-tab="{OVERVIEW_TAB}"]').click()
    panel = drawer.locator(f'.dpanel[data-tab="{OVERVIEW_TAB}"]')
    panel.wait_for(state="visible")
    return panel


def _upload(page: Page, panel: Locator, payload: FilePayload) -> str:
    """Pick `payload` in the Overview's filter picker and return the note the drawer shows once it has answered.

    The note is written in the same render as the listing, so once the note
    reads anything other than what it read before the pick, the listing is final.
    """
    note = panel.locator("p.phint")
    before = note.inner_text() if note.count() else ""
    with page.expect_response(lambda r: r.url.endswith(FILTER_ROUTE), timeout=ANSWER_TIMEOUT):
        panel.locator('input[type="file"][multiple]').set_input_files(payload)
    try:
        page.wait_for_function(
            "([el, before]) => el !== null && el.innerText !== before",
            arg=[note.element_handle(timeout=ANSWER_TIMEOUT), before],
            timeout=ANSWER_TIMEOUT,
        )
    except PlaywrightTimeoutError:
        return before
    return note.inner_text()


def _listed(panel: Locator) -> list[str]:
    """The file names the Overview lists as uploaded, in the order it lists them."""
    return panel.locator(".ofiles .pfile").all_text_contents()


def test_an_uploaded_filter_is_listed_in_the_drawer_by_its_file_name(page: Page, stack: stack_support.Stack) -> None:
    """A WAV the app stores shows up under the picker, named as the user's file was named."""
    name = "e2e-room-left.wav"
    panel = _overview(page, stack)
    _upload(page, panel, _stored(name))
    assert _listed(panel) == [name]


def test_a_refused_filter_upload_adds_nothing_to_the_listed_files(page: Page, stack: stack_support.Stack) -> None:
    """Beside a filter already listed, a file the app refuses leaves the list exactly as it was."""
    panel = _overview(page, stack)
    _upload(page, panel, _stored("e2e-room-centre.wav"))
    listed_before = _listed(panel)
    _upload(page, panel, _refused("e2e-not-a-wave.wav"))
    assert _listed(panel) == listed_before


def test_a_refused_filter_upload_tells_the_user_something_other_than_a_stored_one(
    page: Page, stack: stack_support.Stack
) -> None:
    """After a stored upload, a refused one replaces the drawer's note: the user is not left reading the success."""
    panel = _overview(page, stack)
    stored = _upload(page, panel, _stored("e2e-room-right.wav"))
    refused = _upload(page, panel, _refused("e2e-garbled.wav"))
    assert refused != stored
