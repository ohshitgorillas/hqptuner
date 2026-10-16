// Mounted suite for useMeterPaint in hqptuner/static/components/faceplate/drawers/source/paint.js: what the Source
// meter's two canvases are painted with as the history grows and the playhead moves. The first paint covers the
// spectrogram's full width; a move of the playhead moves the canvas's pixels left as far for the playback it covers
// however that move is split, and paints only the columns it uncovered and the seam column before them; a slice
// closing while the playhead stands still scrolls nothing; a change of range repaints the full width; and the apodizing
// strip repaints when the playhead moves and never when a slice closes. While the Source drawer is closed neither
// canvas is painted however far the playhead moves, and reopening it paints the
// spectrogram's full width once. A change of the spectrogram's span repaints the full width, and at a half span a source
// whose content all sits above three quarters of its band paints the newest column one flat color, since none of that
// content is in view.
//
// The hook is mounted through preact's own client render on a container with no children, since server rendering
// runs no effects; the render compares its container against the document tests/js/support/domseam.js installs. Effects after paint are run through preact's `options.requestAnimationFrame` seam, which the test
// flushes by hand once the render returns, so no frame timer runs. The canvases are fakes whose 2D context records
// each `putImageData` (its x and the image's width, and the image itself) and each `drawImage` (whether it draws the canvas onto itself,
// and how far it moves the pixels). Frames arrive at the wire, through the EventSource fake and `openMeterFeed`, on a
// clock that never moves, and each is handed to the history as the meter loop hands its frames out. The apodizing
// history and the spectrogram's clearing rule are registered once for the file; a case that needs a bin under the
// strip polls for one through the poll seam (tests/js/support/apodpolls.js). The playhead is the exported signal the
// meter loop publishes, written directly by the cases that stand or move it: no loop runs, so nothing else moves it,
// and each such case sets it back to null when it ends.
//
// The window is 60 s unless a case says otherwise, so one of the spectrogram's columns is 50 ms of frame time; at
// 300 s a column is 250 ms. `getComputedStyle` answers no token, so the colors are paint.js's fallbacks; no case
// reads which color a pixel takes, only whether two pixels take the same one. The span is set through the store's
// setter, reached through the module namespace so a store without one leaves the span where it was; the spans are the
// store's own identifiers. A case that needs only its own frames in the history clears it with a track change through
// the poll seam.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-source-paint.test.js

import "../../support/domseam.js";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { h, options, render } from "preact";

import { SPEC_SIZE, useMeterPaint } from "../../../../hqptuner/static/components/faceplate/drawers/source/paint.js";
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
import { useStorage } from "../../support/storage.js";
import { fakeClock } from "../../support/clock.js";
import { newTrack, poll } from "../../support/apodpolls.js";
import * as sourceStore from "../../../../hqptuner/static/store/faceplate/drawers/source.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { initSpectrogram } from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { playhead } from "../../../../hqptuner/static/store/meter/playhead.js";

/** @typedef {{ x: number, width: number }} Put */
/** @typedef {{ self: boolean, offset: number }} Draw */
/** @typedef {{ width: number, height: number, data: Uint8ClampedArray }} Image */
/**
 * @typedef {{ width: number, height: number, puts: Put[], images: Image[], draws: Draw[], getContext: () => unknown }}
 *   FakeCanvas
 */

const STRIP_WIDTH = 600;
//: Feed frame lengths, samples at RATE_44K: 200 and 100 ms.
const N_200_MS = 8820;
const N_100_MS = 4410;

// The Ranges the switch offers are the owner's: the cases pick by place in the offered set, never by value.
const [FIRST_RANGE = ""] = METER_RANGES;
const LAST_RANGE = METER_RANGES.at(-1) ?? "";

/**
 * The global paint.js reads the stylesheet's tokens through, viewed as an optional member.
 *
 * @type {{ getComputedStyle?: unknown }}
 */
const env = globalThis;
env.getComputedStyle = () => ({ getPropertyValue: () => "" });

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
    /** @param {Image} img @param {number} x */
    putImageData: (img, x) => {
      canvas.puts.push({ x, width: img.width });
      canvas.images.push(img);
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
let unmount = null;

/**
 * Mount useMeterPaint on the two canvases and run its effects, as the browser does after the first paint.
 *
 * @param {FakeCanvas} spec
 * @param {FakeCanvas} strip
 */
function mount(spec, strip) {
  const refs = { spec: { current: spec }, strip: { current: strip } };
  const Painted = () => {
    useMeterPaint(
      /** @type {{ current: HTMLCanvasElement }} */ (/** @type {unknown} */ (refs.spec)),
      /** @type {{ current: HTMLCanvasElement }} */ (/** @type {unknown} */ (refs.strip)),
    );
    return null;
  };
  const root = { firstChild: null, childNodes: [] };
  /** @type {Array<() => void>} */
  const queued = [];
  const previous = options.requestAnimationFrame;
  options.requestAnimationFrame = (/** @type {() => void} */ flush) => {
    queued.push(flush);
  };
  try {
    render(h(Painted, {}), root);
  } finally {
    options.requestAnimationFrame = previous;
  }
  queued.forEach((flush) => flush());
  unmount = () => render(null, root);
}

/**
 * Send one feed frame `n` samples long, contiguous with the one before it.
 *
 * @param {number} n
 */
function frame(n) {
  follow([{ peak: -3.1, rms: -9.4, bins: MONO_BINS }], n);
  toSpectrogram(takeMeterFrames());
}

/**
 * Mount on fresh canvases and hand them back.
 *
 * @returns {{ spec: FakeCanvas, strip: FakeCanvas }}
 */
function mounted() {
  const spec = fakeCanvas(SPEC_SIZE.width, SPEC_SIZE.height);
  const strip = fakeCanvas(STRIP_WIDTH, 1);
  mount(spec, strip);
  return { spec, strip };
}

// The spans, as the store holds them: the whole band and its lower half.
const FULL = "full";
const HALF = "half";

/**
 * Set the spectrogram's span through the store's setter.
 *
 * @param {string} span
 */
const setSpan = (span) => sourceStore.setSpectrogramSpan?.(span);

beforeEach(() => {
  openStage.value = "source";
  setSpan(FULL);
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
  if (unmount) unmount();
  unmount = null;
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
  frame(N_200_MS);
  frame(N_100_MS);
  assert.deepEqual(spec.draws, []);
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
  frame(N_200_MS);
  frame(N_100_MS);
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
  frame(N_200_MS);
  frame(N_100_MS);
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
  assert.deepEqual(spec.puts, []);
});

test("test_reopening_the_drawer_after_closes_puts_one_full_width_image", () => {
  const { spec } = mounted();
  openStage.value = null;
  frame(N_200_MS);
  frame(N_100_MS);
  openStage.value = "source";
  assert.deepEqual(spec.puts[1], { x: 0, width: SPEC_SIZE.width });
});

test("test_a_change_of_the_spectrograms_span_repaints_the_full_width", () => {
  const { spec } = mounted();
  setSpan(HALF);
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

//: Where the first of that case's two 200 ms frames ends, playback ms, the stream's first frame starting at 0: with the
//: playhead there the newest columns hold that frame's slice, which the second frame has closed.
const FIRST_HIGH_ONLY_END_MS = 200;

test("test_at_the_half_span_content_above_three_quarters_of_the_band_leaves_the_newest_column_one_flat_color", (t) => {
  lastStream()?.emit("geometry", geometry(RATE_44K, 1, HIGH_ONLY_BINS));
  newTrack();
  poll();
  for (const n of [N_200_MS, N_200_MS]) {
    follow([{ peak: -10, rms: -20, bins: highOnly() }], n);
    toSpectrogram(takeMeterFrames());
  }
  setSpan(HALF);
  standAt(t, FIRST_HIGH_ONLY_END_MS);
  const { spec } = mounted();
  const [first] = spec.images;
  assert.equal(first ? colorsDown(first, first.width - 2) : NaN, 1);
});
