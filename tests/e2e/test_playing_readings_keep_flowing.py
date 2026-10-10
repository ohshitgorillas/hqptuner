"""With music playing, the status and the meters keep updating in the browser.

The engine's readings reach the page over two lanes: the control lane's Status
frame, polled by the app and pushed to the page, and the metering side channel
(port 4322), reduced by the app and streamed to the page's meters. Each test
makes the fake engine report a sequence of readings while it plays and counts
how many of them the page went on to show. A page that shows the first reading
and then freezes follows one of them; a working page follows every one.

Policy notes (docs/testing.md):

- Characterization of existing behavior (rule 8 exemption): these pin what the
  page does now, as regression cover; there is no pre-change state to go red on.
- One assertion per test; the helpers return what the page showed.
- Every value the tests look for is one they put on the wire: the bit depth on
  the Status frame's `<metadata>` child, and the levels on the metering frames.
  The page is read by wire identity only: the rail stage (`data-stage`), and
  the level bar's painted height.
- Waits are bounded condition-polls; nothing sleeps.

Both tests play on the session stack and put the engine's transport, track and
metering stream back as they found them. The meter test plays one short
passage per reading, a clump of frames the way the daemon sends them, and plays
it again until the page shows it before moving to the next.
"""

import struct
from collections.abc import Iterator

import pytest
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page

from e2e.support import stack as stack_support

#: State's transport value for playing (protocol.md, State).
PLAYING = "2"

#: The source the status test plays: a stereo 44.1 kHz PCM stream.
SOURCE_RATE = "44100"
SOURCE_CHANNELS = "2"

#: The bit depths the source reports in turn. Each differs from the one before
#: it, and none is a substring of anything else the stage prints for this source.
BIT_DEPTHS = ["16", "24", "32", "20", "18"]

#: The rail's Source stage, whose value is the incoming stream the Status frame describes.
SOURCE_STAGE = "nav.rail button[data-stage='source'] .v"

#: Ceiling on the page following one change, ms. The app polls the fake every
#: 0.1 s and pushes what moved, so a working page is far inside it.
FOLLOW_TIMEOUT_MS = 5000.0

#: Ceiling on the page loading and opening its meter feed, ms.
LOAD_TIMEOUT_MS = 15000.0

#: Metering frame layout (protocol.md section 7).
HEADER = struct.Struct("<4I3fI")
VERSION = 1
METER_CHANNELS = 2
#: A narrow transform keeps each frame small: the meters' level bars read the
#: frame's own peak and rms fields, not its bins.
BINS = 17
TRANSFORM_BITS = 16
BANDWIDTH = 22050.0
#: One frame's span of music, s: a 1024-sample hop at 44.1 kHz.
TRANSFORM_TIME = 1024 / 44100
GAIN = 2.0
RESERVED = 0

#: (peakMax, peak, rms, rmsMax) in dBFS: a loud passage near full scale, and a
#: quiet one far below the deepest floor the level bars can be set to.
LOUD = (-1.0, -1.0, -3.0, -3.0)
QUIET = (-100.0, -100.0, -100.0, -100.0)

#: Frames per passage, about a quarter second of music: one clump of the
#: stream, well short of the backlog the page drops as lag.
PASSAGE_FRAMES = 11

#: How long one passage stands before the test plays it again, ms, and how many
#: times it is played before the swing counts as missed: the follow ceiling in
#: all. The daemon goes on streaming while the music holds; the fake sends a
#: passage once, so a page that dropped its queue after a stalled frame would
#: otherwise never be sent that passage again.
REPLAY_MS = 300.0
REPLAYS = int(FOLLOW_TIMEOUT_MS // REPLAY_MS)

#: Where a level bar's rms fill must reach, as a percentage of the bar, to read
#: as a loud passage, and where it must fall to, to read as a quiet one.
LOUD_HEIGHT = 75.0
QUIET_HEIGHT = 25.0

#: The swings the meter test waits for in turn: up into a loud passage, down
#: into a quiet one, twice. Each one needs a passage the one before it did not.
SWINGS = ["loud", "quiet", "loud", "quiet"]

#: The levels of the passage each swing plays.
PASSAGES = {"loud": LOUD, "quiet": QUIET}

#: The first channel's rms fill, as a percentage of its bar; -1 while no bar is painted.
RMS_HEIGHT_JS = """
() => {
  const fill = document.querySelector("section[data-stage='source'] .lvb .rm");
  const height = fill ? parseFloat(fill.style.height) : NaN;
  return Number.isFinite(height) ? height : -1;
}
"""

#: Whether the first channel's rms fill has reached the swing's mark.
SWING_JS = """
([swing, loud, quiet]) => {
  const fill = document.querySelector("section[data-stage='source'] .lvb .rm");
  const height = fill ? parseFloat(fill.style.height) : NaN;
  if (!Number.isFinite(height)) return false;
  return swing === "loud" ? height >= loud : height <= quiet;
}
"""

FEED_PATH = "/api/meter/feed"


def _metadata(bits: str) -> str:
    """The Status frame's `<metadata>` child for the playing source at `bits`."""
    return f'<metadata samplerate="{SOURCE_RATE}" bits="{bits}" channels="{SOURCE_CHANNELS}"/>'


@pytest.fixture
def playing(stack: stack_support.Stack) -> Iterator[stack_support.Stack]:
    """The session stack with the engine playing; its transport and track are put back afterwards."""
    state = stack.control_state
    was_state, was_metadata = state["state"], state["_metadata"]
    state["_metadata"] = _metadata(BIT_DEPTHS[0])
    state["state"] = PLAYING
    try:
        yield stack
    finally:
        state["state"] = was_state
        state["_metadata"] = was_metadata


def _source_shows(page: Page, bits: str) -> bool:
    """Whether the Source stage comes to show `bits` within the follow ceiling."""
    try:
        page.wait_for_function(
            "([selector, bits]) => (document.querySelector(selector)?.textContent ?? '').includes(bits)",
            arg=[SOURCE_STAGE, bits],
            timeout=FOLLOW_TIMEOUT_MS,
        )
    except PlaywrightError:
        return False
    return True


def _bit_depths_followed(page: Page, stack: stack_support.Stack) -> list[str]:
    """Report each bit depth in turn while playing, and return those the page showed, up to the first it missed."""
    page.goto(stack.base_url)
    followed: list[str] = []
    for bits in BIT_DEPTHS:
        stack.control_state["_metadata"] = _metadata(bits)
        if not _source_shows(page, bits):
            break
        followed.append(bits)
    return followed


def test_the_source_stage_follows_every_change_the_status_frame_reports_while_playing(
    page: Page, playing: stack_support.Stack
) -> None:
    """Each new bit depth the playing engine reports reaches the rail, not only the first."""
    assert _bit_depths_followed(page, playing) == BIT_DEPTHS


def _frame(levels: tuple[float, float, float, float]) -> bytes:
    """One metering frame with every channel at `levels` over a silent transform."""
    header = HEADER.pack(VERSION, METER_CHANNELS, BINS, TRANSFORM_BITS, BANDWIDTH, TRANSFORM_TIME, GAIN, RESERVED)
    channel = struct.pack("<4f", *levels) + struct.pack(f"<{2 * BINS}f", *([0.0] * (2 * BINS)))
    return header + channel * METER_CHANNELS


@pytest.fixture
def metered(playing: stack_support.Stack) -> Iterator[stack_support.Stack]:
    """The playing session stack; its metering stream goes back to sending nothing, as the session starts it."""
    try:
        yield playing
    finally:
        playing.metering.play(b"", 0)


def _open_meters(page: Page, stack: stack_support.Stack) -> None:
    """Load the page and return once its meter feed has answered."""
    with page.expect_response(lambda response: FEED_PATH in response.url, timeout=LOAD_TIMEOUT_MS):
        page.goto(stack.base_url)


def _swing_shown(page: Page, stack: stack_support.Stack, swing: str) -> bool:
    """Play the swing's passage, again every REPLAY_MS, until the level bar reaches the swing's mark.

    Return whether it did within REPLAYS plays.
    """
    passage = _frame(PASSAGES[swing])
    for _ in range(REPLAYS):
        stack.metering.play(passage, PASSAGE_FRAMES)
        try:
            page.wait_for_function(SWING_JS, arg=[swing, LOUD_HEIGHT, QUIET_HEIGHT], timeout=REPLAY_MS)
        except PlaywrightError:
            continue
        return True
    return False


def _swings_followed(page: Page, stack: stack_support.Stack) -> list[str]:
    """Play each swing's passage in turn under an open meter page.

    Return the swings the level bar made, up to the first it missed.
    """
    _open_meters(page, stack)
    followed: list[str] = []
    for swing in SWINGS:
        if not _swing_shown(page, stack, swing):
            followed.append(f"stuck at {page.evaluate(RMS_HEIGHT_JS)}% waiting for {swing}")
            break
        followed.append(swing)
    return followed


def test_the_level_bar_keeps_moving_with_the_music_while_playing(page: Page, metered: stack_support.Stack) -> None:
    """The level bar rises into each loud passage and falls into each quiet one, not only the first."""
    assert _swings_followed(page, metered) == SWINGS
