// Suite for meterPainter in hqptuner/static/components/faceplate/drawers/source/paint.js: what the Source meter's two
// canvases are painted with as the history grows and the playhead moves. The first paint covers the spectrogram's full
// width; a move of the playhead moves the canvas's pixels left as far for the playback it covers however that move is
// split, and paints only the columns it uncovered and the seam column before them; a slice closing while the playhead
// stands still scrolls nothing; a change of range repaints the full width; and the apodizing strip repaints when the
// playhead moves and never when a slice closes. While the Source drawer is closed neither canvas is painted however far
// the playhead moves, and reopening it paints the spectrogram's full width once. A change of the spectrogram's span
// repaints the full width, and at a half span a source whose content all sits above three quarters of its band paints
// the newest column one flat color, since none of that content is in view.
//
// The painter is a factory: a case creates one on its two canvases and the token reader, which paints its first image
// before it returns, and the disposer it hands back is called when the case ends. No document and no animation frame
// is involved. The canvases are fakes whose 2D context records each `putImageData` that writes any column: the region
// of the canvas it writes, the dirty rectangle's columns when one is given and the whole image at its x when not, and
// the image with its x. It also records each `drawImage`: whether it draws the canvas onto itself, and how far it moves
// the pixels. The token reader answers no token, so the colors are the painter's fallbacks; no case reads which color a
// pixel takes, only whether two pixels take the same one.
//
// Frames arrive at the wire, through the EventSource fake and `openMeterFeed`, on a clock that never moves, and each is
// handed to the history as the meter loop hands its frames out. Their lengths come from FEED_N, a table inside the
// measured 17.3 to 23.2 ms whose length changes mid-feed. The apodizing history and the spectrogram's clearing rule are
// registered once for the file; a case that needs a bin under the strip polls for one through the poll seam
// (tests/js/support/apodpolls.js). The playhead is the exported signal the meter loop publishes, written directly by
// the cases that stand or move it: no loop runs, so nothing else moves it, and each such case sets it back to null when
// it ends. The EventSource and localStorage fakes are installed before each case and taken away after it.
//
// The window is 60 s unless a case says otherwise. The spans are the store's own identifiers. A case that needs only
// its own frames in the history clears it with a track change through the poll seam.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-source-paint.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { SPEC_SIZE, meterPainter } from "../../../../hqptuner/static/components/faceplate/drawers/source/paint.js";
import { openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import {
  closeMeterFeed,
  openMeterFeed,
  takeMeterFrames,
  toSpectrogram,
} from "../../../../hqptuner/static/store/meter/feed.js";
import {
  METER_RANGES,
  setApodWindow,
  setMeterChannel,
  setMeterRange,
} from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { MONO_BINS, RATE_44K, follow, geometry } from "../../support/meterfeed.js";
import { dropStorage, useStorage } from "../../support/storage.js";
import { fakeClock } from "../../support/clock.js";
import { newTrack, poll } from "../../support/apodpolls.js";
import { setSpectrogramSpan } from "../../../../hqptuner/static/store/faceplate/drawers/source.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { initSpectrogram } from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { playhead } from "../../../../hqptuner/static/store/meter/playhead.js";

/** @typedef {{ x: number, width: number }} Put */
/** @typedef {{ self: boolean, offset: number }} Draw */
/** @typedef {{ width: number, height: number, data: Uint8ClampedArray }} Image */
/** @typedef {{ image: Image, x: number }} Placed */
/**
 * @typedef {{ width: number, height: number, puts: Put[], images: Placed[], draws: Draw[], getContext: () => unknown }}
 *   FakeCanvas
 */
/** @typedef {{ getPropertyValue: (name: string) => string }} Tokens */

const STRIP_WIDTH = 600;

//: Feed event lengths, samples at RATE_44K, oldest first: six of 768 (17.4 ms), then six of 1020 (23.1 ms).
const FEED_N = [768, 768, 768, 768, 768, 768, 1020, 1020, 1020, 1020, 1020, 1020];

// The Ranges the switch offers are the owner's: the cases pick by place in the offered set, never by value.
const [FIRST_RANGE = ""] = METER_RANGES;
const LAST_RANGE = METER_RANGES.at(-1) ?? "";

/** The token reader the painter is handed: it answers no token. @type {Tokens} */
const NO_TOKENS = { getPropertyValue: () => "" };

/**
 * The globals the wire fakes are installed on, viewed as optional members: neither exists in this process.
 *
 * @type {{ EventSource?: unknown }}
 */
const env = globalThis;

/**
 * The part of an image a dirty rectangle's side selects, as `putImageData` reads it: a negative length counts back from
 * its start, and the part is cut to the image.
 *
 * @param {number} start
 * @param {number} length
 * @param {number} size  the image's extent on that side
 * @returns {{ start: number, length: number }}
 */
function dirtySpan(start, length, size) {
  const from = Math.max(0, length < 0 ? start + length : start);
  const to = Math.min(size, length < 0 ? start : start + length);
  return { start: from, length: to - from };
}

/**
 * A canvas whose 2D context records what is painted on it.
 *
 * @param {number} width
 * @param {number} height
 * @returns {FakeCanvas}
 */
function fakeCanvas(width, height) {
  /** @type {FakeCanvas} */
  const canvas = { width, height, puts: [], images: [], draws: [], getContext: () => ctx };
  const ctx = {
    /** @param {number} w @param {number} hh */
    createImageData: (w, hh) => ({ width: w, height: hh, data: new Uint8ClampedArray(w * hh * 4) }),
    /**
     * @param {Image} img
     * @param {number} x
     * @param {number} _y
     * @param {number[]} dirty  the dirty rectangle's x, y, width and height, each optional
     */
    putImageData: (img, x, _y, ...dirty) => {
      const [dirtyX = 0, dirtyY = 0, dirtyWidth = img.width, dirtyHeight = img.height] = dirty;
      const cols = dirtySpan(dirtyX, dirtyWidth, img.width);
      const rows = dirtySpan(dirtyY, dirtyHeight, img.height);
      if (cols.length <= 0 || rows.length <= 0) return;
      canvas.puts.push({ x: x + cols.start, width: cols.length });
      canvas.images.push({ image: img, x });
    },
    /** @param {unknown} src @param {number[]} args */
    drawImage: (src, ...args) =>
      canvas.draws.push({ self: src === canvas, offset: args.length === 8 ? args[4] - args[0] : args[0] }),
  };
  return canvas;
}

initApodHistory();
initSpectrogram();

/** @type {(() => void) | null} */
let dispose = null;

/**
 * Create the painter on fresh canvases and hand them back.
 *
 * @returns {{ spec: FakeCanvas, strip: FakeCanvas }}
 */
function mounted() {
  const spec = fakeCanvas(SPEC_SIZE.width, SPEC_SIZE.height);
  const strip = fakeCanvas(STRIP_WIDTH, 1);
  dispose = meterPainter(
    /** @type {HTMLCanvasElement} */ (/** @type {unknown} */ (spec)),
    /** @type {HTMLCanvasElement} */ (/** @type {unknown} */ (strip)),
    /** @type {CSSStyleDeclaration} */ (/** @type {unknown} */ (NO_TOKENS)),
  );
  return { spec, strip };
}

/**
 * Send one feed event per row of FEED_N carrying `bins`, each contiguous with the one before it, and hand each to the
 * history as it arrives.
 *
 * @param {string} [bins]
 */
function feed(bins = MONO_BINS) {
  for (const n of FEED_N) {
    follow([{ peak: -10, rms: -20, bins }], n);
    toSpectrogram(takeMeterFrames());
  }
}

// The spans, as the store holds them: the whole band and its lower half.
const FULL = "full";
const HALF = "half";

beforeEach(() => {
  openStage.value = "source";
  setSpectrogramSpan(FULL);
  useStorage();
  setApodWindow("60");
  setMeterChannel("sum");
  setMeterRange(FIRST_RANGE);
  closeMeterFeed();
  useEventSource();
  engineStatus.value = { status: { state: "2" }, metering: true, metadata: { samplerate: "44100" } };
  openMeterFeed(fakeClock().clock);
  lastStream()?.emit("geometry", geometry(RATE_44K));
});

afterEach(() => {
  if (dispose) dispose();
  dispose = null;
  closeMeterFeed();
  delete env.EventSource;
  dropStorage();
});

test("test_the_first_paint_puts_a_full_width_image_at_the_left_edge", () => {
  const { spec } = mounted();
  assert.deepEqual(spec.puts, [{ x: 0, width: SPEC_SIZE.width }]);
});

//: Where the playhead stands when a case mounts, playback ms: past the frames the cases send, so their slices are in
//: the 60 s window ending there.
const STANDING_MS = 1000;
//: One move of the playhead, playback ms: not a whole number of the 60 s window's columns, so a move leaves a part
//: column over.
const MOVE_MS = 175;
//: The column a scroll repaints before the ones it uncovered.
const SEAM = 1;

/**
 * Stand the playhead at `ms` for the rest of case `t`, and set it back to null when the case ends.
 *
 * @param {{ after: (fn: () => void) => void }} t
 * @param {number} ms  playback, ms
 */
function standAt(t, ms) {
  t.after(() => {
    playhead.value = null;
  });
  playhead.value = ms;
}

test("test_two_playhead_moves_scroll_the_canvas_as_far_as_one_move_over_the_same_playback", (t) => {
  standAt(t, STANDING_MS);
  const { spec } = mounted();
  playhead.value = STANDING_MS + MOVE_MS;
  playhead.value = STANDING_MS + 2 * MOVE_MS;
  playhead.value = STANDING_MS + 4 * MOVE_MS;
  const [first, second, both] = spec.draws.map((d) => d.offset);
  assert.equal((first ?? NaN) + (second ?? NaN), both);
});

test("test_a_slice_closing_while_the_playhead_stands_still_does_not_scroll_the_canvas", (t) => {
  standAt(t, STANDING_MS);
  const { spec } = mounted();
  feed();
  playhead.value = STANDING_MS + MOVE_MS;
  // The one scroll is the move's: the closed slices added none before it.
  assert.deepEqual(
    spec.draws.map((d) => d.self),
    [true],
  );
});

test("test_a_playhead_move_puts_only_the_columns_its_scroll_uncovered_and_the_seam_before_them", (t) => {
  standAt(t, STANDING_MS);
  const { spec } = mounted();
  playhead.value = STANDING_MS + MOVE_MS;
  const uncovered = -(spec.draws[0]?.offset ?? NaN);
  assert.deepEqual(spec.puts[1], { x: SPEC_SIZE.width - uncovered - SEAM, width: uncovered + SEAM });
});

test("test_a_change_of_range_repaints_the_full_width", () => {
  const { spec } = mounted();
  setMeterRange(LAST_RANGE);
  assert.deepEqual(spec.puts[1], { x: 0, width: SPEC_SIZE.width });
});

test("test_the_first_paint_puts_the_strip_at_full_width", () => {
  poll();
  poll();
  const { strip } = mounted();
  feed();
  assert.deepEqual(strip.puts[0], { x: 0, width: STRIP_WIDTH });
});

test("test_a_playhead_move_repaints_the_strip", (t) => {
  poll();
  poll();
  standAt(t, STANDING_MS);
  const { strip } = mounted();
  playhead.value = STANDING_MS + MOVE_MS;
  assert.deepEqual(strip.puts[1], { x: 0, width: STRIP_WIDTH });
});

test("test_a_slice_closing_while_the_playhead_stands_still_leaves_the_strip_as_painted", (t) => {
  poll();
  poll();
  standAt(t, STANDING_MS);
  const { strip } = mounted();
  feed();
  assert.deepEqual(strip.puts, [{ x: 0, width: STRIP_WIDTH }]);
});

//: A move of the playhead four of the 60 s window's columns long: playback ms.
const WHOLE_COLUMNS_MS = 200;

test("test_playhead_moves_that_would_scroll_whole_columns_put_nothing_while_the_drawer_is_closed", (t) => {
  openStage.value = null;
  standAt(t, STANDING_MS);
  const { spec } = mounted();
  playhead.value = STANDING_MS + WHOLE_COLUMNS_MS;
  playhead.value = STANDING_MS + 2 * WHOLE_COLUMNS_MS;
  openStage.value = "source";
  // The one image put is the reopening's: the moves while closed put none.
  assert.deepEqual(spec.puts, [{ x: 0, width: SPEC_SIZE.width }]);
});

test("test_reopening_the_drawer_after_closes_puts_one_full_width_image", () => {
  const { spec } = mounted();
  openStage.value = null;
  feed();
  openStage.value = "source";
  assert.deepEqual(spec.puts[1], { x: 0, width: SPEC_SIZE.width });
});

test("test_a_change_of_the_spectrograms_span_repaints_the_full_width", () => {
  const { spec } = mounted();
  setSpectrogramSpan(HALF);
  assert.deepEqual(spec.puts[1], { x: 0, width: SPEC_SIZE.width });
});

// --- what a span shows ---------------------------------------------------------------------------------------------

//: Eight bins over the band, the top two loud and the rest quiet: every bin at or below 5/7 of the Nyquist is quiet.
const HIGH_ONLY_BINS = 8;
const LOUD_FROM_BIN = 6;
//: A loud and a quiet bin's bytes: dB = -byte * 0.5, so -10 and -60 dBFS.
const LOUD_BYTE = 20;
const QUIET_BYTE = 120;

/** One feed frame's bins, quiet below LOUD_FROM_BIN and loud from it, two bytes a bin with the low one first. */
const highOnly = () =>
  btoa(
    String.fromCharCode(
      ...Array.from({ length: HIGH_ONLY_BINS }, (_, k) => [k >= LOUD_FROM_BIN ? LOUD_BYTE : QUIET_BYTE, 0]).flat(),
    ),
  );

/**
 * How many distinct colors the pixels down column `x` of `img` take.
 *
 * @param {Image} img
 * @param {number} x
 */
function colorsDown(img, x) {
  const seen = new Set();
  for (let y = 0; y < img.height; y++) {
    const at = (y * img.width + x) * 4;
    seen.add(Array.from(img.data.subarray(at, at + 4)).join(","));
  }
  return seen.size;
}

//: Where the playhead stands for the span case, playback ms, the stream's first event starting at 0: inside the 243 ms
//: FEED_N covers, with events after it, so the newest columns hold slices those later events have closed.
const INSIDE_FEED_MS = 200;
//: The newest column the case reads, counted from the painted region's right edge.
const NEWEST_FROM_RIGHT = 2;

test("test_at_the_half_span_content_above_three_quarters_of_the_band_leaves_the_newest_column_one_flat_color", (t) => {
  lastStream()?.emit("geometry", geometry(RATE_44K, 1, HIGH_ONLY_BINS));
  newTrack();
  poll();
  feed(highOnly());
  setSpectrogramSpan(HALF);
  standAt(t, INSIDE_FEED_MS);
  const { spec } = mounted();
  const [region] = spec.puts;
  const [first] = spec.images;
  const newest = region && first ? region.x + region.width - NEWEST_FROM_RIGHT - first.x : NaN;
  assert.equal(first ? colorsDown(first.image, newest) : NaN, 1);
});

// --- the puts and draws each step owes -----------------------------------------------------------------------------

/**
 * How many image puts and how many draws the spectrogram canvas has made.
 *
 * @param {FakeCanvas} spec
 */
const made = (spec) => ({ puts: spec.puts.length, draws: spec.draws.length });

// Each step is taken after the first paint, which is one put and no draw. A move of the playhead while open scrolls
// once and puts the seam and the uncovered columns. A change of range and a reopen repaint the full width once and
// scroll none. A close, and the moves while closed, make none.
for (const { step, owes, run } of [
  {
    step: "a_playhead_move_while_open",
    owes: { puts: 2, draws: 1 },
    run: () => {
      playhead.value = STANDING_MS + MOVE_MS;
    },
  },
  {
    step: "a_change_of_range",
    owes: { puts: 2, draws: 0 },
    run: () => setMeterRange(LAST_RANGE),
  },
  {
    step: "a_close_and_the_moves_while_closed",
    owes: { puts: 1, draws: 0 },
    run: () => {
      openStage.value = null;
      playhead.value = STANDING_MS + WHOLE_COLUMNS_MS;
      playhead.value = STANDING_MS + 2 * WHOLE_COLUMNS_MS;
    },
  },
  {
    step: "a_reopen_after_moves_while_closed",
    owes: { puts: 2, draws: 0 },
    run: () => {
      openStage.value = null;
      playhead.value = STANDING_MS + WHOLE_COLUMNS_MS;
      playhead.value = STANDING_MS + 2 * WHOLE_COLUMNS_MS;
      openStage.value = "source";
    },
  },
]) {
  test(`test_the_spectrogram_makes_exactly_the_puts_and_draws_${step}_owes`, (t) => {
    standAt(t, STANDING_MS);
    const { spec } = mounted();
    run();
    assert.deepEqual(made(spec), owes);
  });
}
