"""At the Compact format, the Source drawer's spectrogram header shows no horizontal scroll bar at the quarter span.

With a source playing and the Source drawer open on its spectrogram, picking the
quarter of the band on the span switch leaves the header within its drawer: no
box in the header, no box around it and not the page shows a horizontal scroll
bar on its account.

The case lays the plate out for a window exactly the size of the Compact format
(1133x744), so the window picks that format at a scale of 1, makes the fake
engine play and stream metering frames, opens the Source drawer, taps the span
switch's quarter option, and measures how far the header's extent runs past
the edge each box that can scroll across scrolls at, beside the span option
that is lit once the page has settled, so the layout measured is the quarter
span's.

Policy notes:

- Geometry exists only in a real layout engine, so this is the browser lane.
- A scroll bar shows when a box's scrollable extent outruns it, and that extent
  counts empty space (a gap, a margin, a padding edge) as well as drawn
  content, so the header is measured by its scroll width, not by what it draws.
- The spectrogram and its header show only while metering frames keep
  arriving, so the passage is played again, and the tap tried again, with each
  step that waits on the page. Every frame value is one the test put on the
  wire.
- Controls are found by machine identity: the rail stage (`data-stage`), the
  Source drawer (`#drawer-source`), the header's switches (`data-testid`) and
  the span's option value (`data-v`), lit by its state class. The header is
  the nearest box holding all four switches.
- Waits are bounded condition-polls: the quarter option on show and lit, fonts
  loaded and every finite animation settled.
"""

import struct
from collections.abc import Iterator

import pytest
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page

from e2e.support import fit
from e2e.support import stack as stack_support

#: The format the case lays the plate out at.
COMPACT = "compact"

#: State's transport value for playing, and the source it plays: stereo 44.1 kHz PCM.
PLAYING = "2"
METADATA = '<metadata samplerate="44100" bits="16" channels="2"/>'

#: Metering frame layout (protocol.md section 7), for a stereo 44.1 kHz source.
HEADER = struct.Struct("<4I3fI")
VERSION = 1
METER_CHANNELS = 2
BINS = 17
TRANSFORM_BITS = 16
BANDWIDTH = 22050.0
TRANSFORM_TIME = 1024 / 44100
GAIN = 2.0
RESERVED = 0

#: (peakMax, peak, rms, rmsMax) in dBFS, and one bin's (re, im): a moderate passage with energy in every bin.
LEVELS = (-6.0, -6.0, -12.0, -12.0)
BIN = (0.1, 0.1)

#: Frames per passage, about a quarter second of music: one clump of the stream.
PASSAGE_FRAMES = 11

#: How long one passage stands before the test plays it again, ms, and how many times it is played
#: before the page counts as never showing what the step waits for: the settle ceiling in all.
REPLAY_MS = 300.0
REPLAYS = int(fit.SETTLE_TIMEOUT // REPLAY_MS)

#: The Source drawer's rail stage.
SOURCE_STAGE = "source"

#: The span switch, its quarter-of-the-band option value and selector, and the class that lights an option.
SPAN = "meter-span"
QUARTER_SPAN = "quarter"
QUARTER = f'#drawer-source [data-testid="{SPAN}"] [data-v="{QUARTER_SPAN}"]'
LIT = "on"

#: The header's switches; the header is the nearest box holding them all.
HEADER_SWITCHES = ["meter-range", "meter-channel", "meter-window", SPAN]

#: Settles the page, then returns the span options lit (`lit`, by `data-v`) and each box that shows
#: a horizontal scroll bar because of the spectrogram header (`scroll_bars`), as "<box> x <px>", the
#: header's own extent past the edge the box scrolls at, worst first. A box in the header scrolls
#: when its own content is wider than it; a box around the header, or the page, scrolls when the
#: header's extent runs past its content edge. Only boxes that can show a scroll bar (`overflow-x`
#: auto or scroll, or the page) count; a box that hides its overflow shows none.
MEASURE_JS = "async ({ switches, span, lit, rounding, ceiling }) => {" + fit.PRELUDE_JS + """
  await settle(ceiling);
  const drawer = document.getElementById("drawer-source");
  const all = switches.map((id) => drawer.querySelector(`[data-testid="${id}"]`));
  if (all.some((el) => el === null)) throw new Error("the spectrogram header is not on show");
  let header = all[0].parentElement;
  while (!all.every((el) => header.contains(el))) header = header.parentElement;
  const scrolls = (el) => ["auto", "scroll"].includes(getComputedStyle(el).overflowX);
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}`
    + (el.classList.length > 0 ? "." + [...el.classList].join(".") : "");
  const reach = header.getBoundingClientRect().left + header.clientLeft + header.scrollWidth;
  const found = [];
  for (const el of [header, ...header.querySelectorAll("*")]) {
    if (el instanceof HTMLElement && scrolls(el)) found.push([name(el), el.scrollWidth - el.clientWidth]);
  }
  const page = document.documentElement;
  for (let up = header.parentElement; up !== null && up !== page && up !== document.body; up = up.parentElement) {
    if (!scrolls(up)) continue;
    const edge = up.getBoundingClientRect().left + up.clientLeft + up.clientWidth
      - parseFloat(getComputedStyle(up).paddingRight);
    found.push([`${name(up)} (around the spectrogram header)`, reach - edge]);
  }
  found.push(["the page", reach - page.clientWidth]);
  const scrollBars = found.filter(([, px]) => px > rounding).sort((x, y) => y[1] - x[1])
    .map(([box, px]) => `${box} x ${Math.round(px)}px`);
  const options = drawer.querySelectorAll(`[data-testid="${span}"] [data-v]`);
  const lighted = [...options].filter((el) => el.classList.contains(lit)).map((el) => el.dataset.v);
  return { lit: lighted, scroll_bars: scrollBars };
}
"""


def _frame() -> bytes:
    """One metering frame with every channel at LEVELS over a transform with BIN in every bin."""
    header = HEADER.pack(VERSION, METER_CHANNELS, BINS, TRANSFORM_BITS, BANDWIDTH, TRANSFORM_TIME, GAIN, RESERVED)
    channel = struct.pack("<4f", *LEVELS) + struct.pack(f"<{2 * BINS}f", *(BIN * BINS))
    return header + channel * METER_CHANNELS


@pytest.fixture
def metered(stack: stack_support.Stack) -> Iterator[stack_support.Stack]:
    """The session stack playing; its transport, track and metering stream are put back afterwards."""
    state = stack.control_state
    was_state, was_metadata = state["state"], state["_metadata"]
    state["_metadata"] = METADATA
    state["state"] = PLAYING
    try:
        yield stack
    finally:
        state["state"] = was_state
        state["_metadata"] = was_metadata
        stack.metering.play(b"", 0)


class _NeverShownError(RuntimeError):
    """The page never showed what a step waits for while the passage kept playing, so nothing was measured."""

    def __init__(self, selector: str) -> None:
        super().__init__(f"{selector} never showed while the passage played {REPLAYS} times")


def _play_until_shown(page: Page, stack: stack_support.Stack, passage: bytes, selector: str, tap: str = "") -> None:
    """Play the passage, again every REPLAY_MS, tapping `tap` each time, until `selector` is on show; raise if never.

    The header comes and goes with the frames, so a tap is tried again with each passage until it takes.
    """
    for _ in range(REPLAYS):
        stack.metering.play(passage, PASSAGE_FRAMES)
        try:
            if tap:
                page.locator(tap).click(timeout=REPLAY_MS)
            page.locator(selector).wait_for(state="visible", timeout=REPLAY_MS)
        except PlaywrightError:
            continue
        return
    raise _NeverShownError(selector)


def _header_at_quarter(page: Page, stack: stack_support.Stack) -> dict[str, list[str]]:
    """Open the Source drawer at Compact while playing, pick the quarter span, return the lit span and scroll bars."""
    passage = _frame()
    fit.load_plate(page, stack, fit.FORMATS[COMPACT])
    stack.metering.play(passage, PASSAGE_FRAMES)
    page.locator(f'button[data-stage="{SOURCE_STAGE}"]').click(timeout=fit.SETTLE_TIMEOUT)
    _play_until_shown(page, stack, passage, f"{QUARTER}.{LIT}", tap=QUARTER)
    measure = {
        "switches": HEADER_SWITCHES,
        "span": SPAN,
        "lit": LIT,
        "rounding": fit.ROUNDING,
        "ceiling": fit.SETTLE_TIMEOUT,
    }
    found = page.evaluate(MEASURE_JS, measure)
    return {key: [str(line) for line in found[key]] for key in ("lit", "scroll_bars")}


def test_at_compact_the_spectrogram_header_shows_no_horizontal_scroll_bar_at_the_quarter_span(
    page: Page, metered: stack_support.Stack
) -> None:
    """At the Compact format with the quarter span lit, no box in or around the spectrogram header scrolls across."""
    assert _header_at_quarter(page, metered) == {"lit": [QUARTER_SPAN], "scroll_bars": []}
