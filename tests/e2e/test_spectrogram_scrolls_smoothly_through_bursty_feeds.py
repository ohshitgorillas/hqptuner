"""While bursty arrivals reach the page and stay inside the buffer, the spectrogram scrolls smoothly.

The meter feed reaches the page in bursts: the real capture of the dev container's feed
(`tests/support/fixtures/meter_feed_capture.json`) and generated feeds whose bursts, gaps and landings
vary. The Source drawer's spectrogram scrolls by the playhead's movement, so three things are read
from its painted pixels, once per paint: it never stands still while music plays, its speed never
changes in a step, and on the capture it never scrolls further than its wall time covers.

Policy notes:

- The painted canvas is a browser-only fact, and the page's own animation frames, its delay and its
  scroll plan are what compose it, so this is the browser lane. The playhead's arithmetic, the loop's
  wiring and the meters' and the spectrum's input are held at the model and store lanes.
- The page's clock is Playwright's: `requestAnimationFrame`, `performance.now` and every page timer
  run on time the test advances, one paint (16 ms) at a time, so no test sleeps and its wall time does
  not grow with a feed's length beyond the paint work.
- The feed is the wire's own events at their arrival times on that clock. Only the page's
  `EventSource` for `/api/meter/feed` is replaced; the push channel stays the browser's own. Every
  event's type and data text reach the page unmodified.
- The engine's delay and the apodizing history reach the page the way the owner's page gets them: the
  fake engine's Status reply carries `output_delay`, `position` and `apod`, and the user's offset is
  stored where the page keeps it. Each feed runs at one delay from start to end.
- Every frame value is one the test put on the wire or took from the capture. The scroll is found in
  the painted pixels: how many whole columns the image moved left since the paint before.
- Waits are bounded condition-polls; none is a fixed sleep.
"""

import itertools
import json
import math
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from playwright.sync_api import Browser, Page

from e2e.support import stack as stack_support

#: The committed capture of the dev container's feed, read, never written.
CAPTURE_FILE = Path(__file__).resolve().parents[1] / "support" / "fixtures" / "meter_feed_capture.json"

#: State's transport value for playing, and the source it plays.
PLAYING = "2"
METADATA = '<metadata samplerate="192000" bits="24" channels="2"/>'

#: The spectrogram's window, s, the page's shortest, and the raster's columns across it (`W` in `lib/spectroraster.js`).
WINDOW_S = 30
COLUMNS = 1200
#: Wall time one column of the spectrogram covers, ms.
COLUMN_MS = WINDOW_S * 1000 / COLUMNS

#: Where the page keeps the window and the user's offset (`store/ui/prefs.js`, `store/meter/delay.js`).
WINDOW_KEY = "hqptuner.apodWindow"
OFFSET_KEY = "hqptuner.spectrumOffset"

#: One paint of Playwright's page clock: its animation frames fall every 16 ms.
PAINT_MS = 16

#: Ceiling on the page loading and opening its meter feed, ms, and on the wait for the spectrogram's pixels.
LOAD_TIMEOUT_MS = 15000.0

#: Fewest painted paints a feed is read over before the readings count as evidence.
MIN_PAINTS = 100

#: The rail's Source stage and the spectrogram canvas.
SOURCE_STAGE = "nav.rail button[data-stage='source']"

#: The generated feeds: the capture's metering rate, the frame lengths in samples in turn (17.7 to 22.9 ms, inside the
#: measured feed event range of 17.3 to 23.2 ms), how many frames each burst holds in turn, and how far each burst
#: lands off the schedule its music sets in turn, ms, early and late. The three turns have lengths with no common
#: factor, so the bursts differ along a feed and each feed starts its turns at its own place.
RATE = 192000
LENGTHS = (3400, 3800, 4096, 4400, 3600)
BURST_FRAMES = (3, 5, 2, 6, 4, 7)
LANDS_OFF_MS = (0.0, -35.0, 40.0, -15.0, 25.0, -40.0, 10.0)
#: Bursts per generated feed.
BURSTS = 60

#: What the reader looks at: columns just left of the right edge, rows sampled, and the most columns one paint scrolls
#: that it looks for.
PROBE_COLUMNS = 40
ROW_STRIDE = 8
MOST_COLUMNS = 8
SEAM_COLUMNS = 3

#: The reader the page carries. `window.__scroll()` returns null while no spectrogram is on show or on its first read;
#: else `[columns, distinct]`: how many columns the image moved left since the read before (-1 where no shift matches,
#: as when it was painted whole), and how many different columns the probed strip holds (a glass strip holds one).
READER_PARAMS = (
    f"const W = {COLUMNS}, P = {PROBE_COLUMNS}, S = {MOST_COLUMNS}, G = {SEAM_COLUMNS}, STRIDE = {ROW_STRIDE};"
)
READER_BODY = """
let before = null;
  window.__scroll = () => {
    const canvas = document.querySelector("canvas.spec");
    if (!canvas) return null;
    const x0 = W - P - S - G;
    const img = canvas.getContext("2d").getImageData(x0, 0, P + S, canvas.height);
    const hashes = [];
    for (let x = 0; x < P + S; x++) {
      let h = 2166136261;
      for (let y = 0; y < canvas.height; y += STRIDE) {
        const i = (y * (P + S) + x) * 4;
        for (let c = 0; c < 3; c++) h = Math.imul(h ^ img.data[i + c], 16777619) >>> 0;
      }
      hashes.push(h);
    }
    const prev = before;
    before = hashes;
    if (prev === null) return null;
    const distinct = new Set(hashes.slice(0, P)).size;
    for (let s = 0; s <= S; s++) {
      let same = true;
      for (let j = 0; j < P && same; j++) same = hashes[j] === prev[j + s];
      if (same) return [s, distinct];
    }
    return [-1, distinct];
  };
"""
READER_JS = f"(() => {{\n{READER_PARAMS}\n{READER_BODY}}})();"

#: The replaced `EventSource` for the meter feed. It holds the feed's events until `window.__feedGo()`, then delivers
#: each at its arrival time on the page's clock, as the wire's `event` type with the `data` text unmodified.
FEED_JS = """
(() => {
  const feed = %(feed)s;
  for (const [key, value] of Object.entries(%(stored)s)) localStorage.setItem(key, value);
  const Native = window.EventSource;
  class Replayed {
    constructor(url, init) {
      if (!String(url).includes("/api/meter/feed")) return new Native(url, init);
      this.url = url;
      this.closed = false;
      this.listeners = {};
      window.__feedOpened = true;
      window.__feedSource = this;
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    close() { this.closed = true; }
  }
  window.EventSource = Replayed;
  window.__feedGo = () => {
    const source = window.__feedSource;
    for (const event of feed) {
      setTimeout(() => {
        if (!source.closed) for (const fn of source.listeners[event.type] || []) fn({ data: event.data });
      }, event.t);
    }
  };
})();
"""


@dataclass(frozen=True)
class Feed:
    """A feed to replay: its events at their arrival times, and the delay it runs at."""

    name: str
    #: `[{"t": ms after the replay starts, "type": event name, "data": the wire's data text}]`.
    events: list[dict[str, object]]
    #: Wall ms after the replay starts at which the last frame lands.
    last: float
    #: The engine's `output_delay`, microseconds, and the user's offset, s: together the delay the feed runs at.
    engine_us: int
    offset_s: float


def _capture() -> dict[str, Any]:
    """The committed capture, parsed."""
    parsed: dict[str, Any] = json.loads(CAPTURE_FILE.read_text())
    return parsed


def _capture_feed() -> Feed:
    """The capture: each event at the time it was recorded, at the delay the owner watched."""
    raw = _capture()
    recorded = raw["events"]
    events: list[dict[str, object]] = [{"t": e["t_ms"], "type": e["event"], "data": e["data"]} for e in recorded]
    frames = [e for e in events if e["type"] == "frame"]
    return Feed(
        name="the_capture",
        events=events,
        last=float(str(frames[-1]["t"])),
        engine_us=int(str(raw["engine_output_delay"])),
        offset_s=float(str(raw["owner_spectrum_offset_s"])),
    )


def _generated_feed(name: str, seed: int, delay_ms: float) -> Feed:
    """A bursty feed at `delay_ms` inside the buffer: bursts of the capture's own spectra at lengths that change.

    Each burst lands where the music before it would have ended, off by up to LANDS_OFF_MS early or late, never
    before the burst before it. The delay outlasts a burst's music, its landing off schedule and a late paint.
    """
    recorded = _capture()["events"]
    spectra = [json.loads(e["data"])["channels"] for e in recorded if e["event"] == "frame"]
    geometry = next(e for e in recorded if e["event"] == "geometry")
    events: list[dict[str, object]] = [{"t": 0.0, "type": "geometry", "data": geometry["data"]}]
    lengths = itertools.cycle(LENGTHS[seed:] + LENGTHS[:seed])
    at = 0
    sent = 0
    landed = 0.0
    for burst in range(BURSTS):
        landed = max(landed, at * 1000 / RATE + LANDS_OFF_MS[(burst + seed) % len(LANDS_OFF_MS)] * bool(burst))
        for _ in range(BURST_FRAMES[(burst + seed) % len(BURST_FRAMES)]):
            n = next(lengths)
            frame = {"channels": spectra[sent * 37 % len(spectra)], "at": at, "n": n}
            events.append({"t": landed, "type": "frame", "data": json.dumps(frame)})
            at += n
            sent += 1
    return Feed(name=name, events=events, last=landed, engine_us=round(delay_ms * 1000), offset_s=0.0)


FEEDS = [
    _capture_feed(),
    _generated_feed("a_short_delay", 1, 300.0),
    _generated_feed("a_long_delay", 2, 600.0),
    _generated_feed("the_captures_delay", 3, 1247.682),
]


def _read(page: Page) -> tuple[int, int] | None:
    """The page's reader: columns scrolled since its last read and how textured the strip is; None before it can say."""
    got = page.evaluate("window.__scroll()")
    return None if got is None else (int(got[0]), int(got[1]))


class Replays:
    """The painted scroll of each feed, replayed once and kept for every test that reads it."""

    def __init__(self, browser: Browser, stack: stack_support.Stack) -> None:
        """Hold the browser and the stack; nothing is replayed until a feed is asked for."""
        self._browser = browser
        self._stack = stack
        self._scrolls: dict[str, list[int]] = {}

    def of(self, feed: Feed) -> list[int]:
        """The columns each paint scrolled the spectrogram while the feed's music played, in paint order."""
        if feed.name not in self._scrolls:
            self._scrolls[feed.name] = self._replay(feed)
        return self._scrolls[feed.name]

    def _replay(self, feed: Feed) -> list[int]:
        """Replay `feed` in a fresh page, one 16 ms paint at a time, reading the scroll after each."""
        state = self._stack.control_state
        knobs = ("state", "_metadata", "_output_delay", "_position", "_apod")
        was = {knob: state[knob] for knob in knobs}
        state.update(state=PLAYING, _metadata=METADATA, _output_delay=str(feed.engine_us), _position="0", _apod="0")
        stored = {WINDOW_KEY: str(WINDOW_S), OFFSET_KEY: str(feed.offset_s)}
        context = self._browser.new_context()
        try:
            page = context.new_page()
            page.add_init_script(READER_JS)
            page.add_init_script(FEED_JS % {"feed": json.dumps(feed.events), "stored": json.dumps(stored)})
            page.clock.install(time=0)
            page.goto(self._stack.base_url)
            page.locator(SOURCE_STAGE).click(timeout=LOAD_TIMEOUT_MS)
            page.wait_for_function("window.__feedOpened === true", timeout=LOAD_TIMEOUT_MS)
            page.clock.pause_at(int(page.evaluate("Date.now()")) + PAINT_MS)
            page.evaluate("window.__feedGo()")
            return self._paints(page, feed)
        finally:
            context.close()
            state.update(was)

    def _paints(self, page: Page, feed: Feed) -> list[int]:
        """Run the page's clock through the feed's music; return each paint's scroll once the strip has content."""
        state = self._stack.control_state
        scrolls: list[int] = []
        textured = False  # whether the paint before had content in the strip
        for paint in range(math.ceil(feed.last / PAINT_MS) + 1):
            state.update(_position=str(paint + 1), _apod=str(paint + 1))
            page.clock.run_for(PAINT_MS)
            read = _read(page)
            if read is None:
                continue
            columns, distinct = read
            if textured:
                scrolls.append(COLUMNS if columns < 0 else columns)
            textured = textured or distinct >= PROBE_COLUMNS * 3 // 4
        if len(scrolls) < MIN_PAINTS:
            raise ShortReplayError(feed.name, len(scrolls))
        return scrolls


class ShortReplayError(RuntimeError):
    """A replay painted too few readable paints to say anything about the scroll."""

    def __init__(self, name: str, painted: int) -> None:
        """Name the feed and how many paints it was read over."""
        super().__init__(f"{name} was read over {painted} paints, fewer than the {MIN_PAINTS} that count as evidence")


@pytest.fixture(scope="module")
def replays(browser: Browser, stack: stack_support.Stack) -> Iterator[Replays]:
    """The painted scroll of each feed, replayed on first use."""
    yield Replays(browser, stack)


def _longest_stand_ms(scrolls: list[int]) -> float:
    """The wall time of the longest run of paints that left the scroll where it was."""
    longest = run = 0
    for columns in scrolls:
        run = run + 1 if columns == 0 else 0
        longest = max(longest, run)
    return longest * PAINT_MS


def _largest_step(scrolls: list[int]) -> int:
    """The most one paint's scroll differs from the paint before it, in columns."""
    return max(abs(now - before) for before, now in itertools.pairwise(scrolls))


@pytest.mark.parametrize("feed", FEEDS, ids=lambda feed: feed.name)
def test_the_spectrogram_never_stands_still_for_longer_than_one_column_takes(feed: Feed, replays: Replays) -> None:
    """No run of paints longer than one column of playback leaves the scroll unmoved."""
    assert _longest_stand_ms(replays.of(feed)) <= COLUMN_MS


@pytest.mark.parametrize("feed", FEEDS, ids=lambda feed: feed.name)
def test_the_spectrogram_scroll_never_changes_by_more_than_one_column_between_paints(
    feed: Feed, replays: Replays
) -> None:
    """No paint scrolls the spectrogram more than one column further or shorter than the paint before it."""
    assert _largest_step(replays.of(feed)) <= 1


def test_no_paint_scrolls_the_captures_spectrogram_further_than_its_wall_time_covers(replays: Replays) -> None:
    """On the real capture each paint scrolls at most its wall time, rounded up to a whole column."""
    assert max(replays.of(FEEDS[0])) <= math.ceil(PAINT_MS / COLUMN_MS)
