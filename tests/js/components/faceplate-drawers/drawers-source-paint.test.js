// Mounted suite for useMeterPaint in hqptuner/static/components/faceplate/drawers/source/paint.js: what the Source
// meter's two canvases are painted with as the history grows. The first paint covers the spectrogram's full width; a
// close that moves the window by whole columns moves the canvas's pixels left by that many and paints only the new
// columns and the seam column before them; a close too short to move a column paints nothing; a change of range
// repaints the full width; and no spectrogram close repaints the apodizing strip. While the Source drawer is closed
// neither canvas is painted, and reopening it paints the spectrogram's full width once.
//
// The hook is mounted through preact's own client render on a container with no children, since server rendering
// runs no effects; the render compares its container against the document tests/js/support/domseam.js installs. Effects after paint are run through preact's `options.requestAnimationFrame` seam, which the test
// flushes by hand once the render returns, so no frame timer runs. The canvases are fakes whose 2D context records
// each `putImageData` (its x and the image's width) and each `drawImage` (whether it draws the canvas onto itself,
// and how far it moves the pixels). Frames arrive at the wire, through the EventSource fake and `openMeterFeed`, on a
// clock that never moves, and each is handed to the history as the meter loop hands its frames out.
//
// The window is 60 s unless a case says otherwise, so one of the spectrogram's columns is 50 ms of frame time; at
// 300 s a column is 250 ms. `getComputedStyle` answers no token, so the colours are paint.js's fallbacks; no case
// reads a pixel's colour.
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
import { useStorage } from "../../support/storage.js";

/** @typedef {{ x: number, width: number }} Put */
/** @typedef {{ self: boolean, offset: number }} Draw */
/** @typedef {{ width: number, height: number, puts: Put[], draws: Draw[], getContext: () => unknown }} FakeCanvas */

const STRIP_WIDTH = 600;
const BINS = "AQAGADwAWAI=";

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
  const canvas = { width, height, puts: [], draws: [], getContext: () => ctx };
  const ctx = {
    /** @param {number} w @param {number} hh */
    createImageData: (w, hh) => ({ width: w, height: hh, data: new Uint8ClampedArray(w * hh * 4) }),
    /** @param {{ width: number }} img @param {number} x */
    putImageData: (img, x) => canvas.puts.push({ x, width: img.width }),
    /** @param {unknown} src @param {number[]} args */
    drawImage: (src, ...args) =>
      canvas.draws.push({ self: src === canvas, offset: args.length === 8 ? args[4] - args[0] : args[0] }),
  };
  return canvas;
}

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
 * Send one feed frame covering `ms` of frame time.
 *
 * @param {number} ms
 */
function frame(ms) {
  lastStream()?.emit("frame", { channels: [{ peak: -3.1, rms: -9.4, bins: BINS }], ms });
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

beforeEach(() => {
  openStage.value = "source";
  useStorage();
  setApodWindow("60");
  setMeterChannel("sum");
  setMeterRange(FIRST_RANGE);
  closeMeterFeed();
  useEventSource();
  engineStatus.value = { status: { state: "2" }, metering: true, metadata: { samplerate: "44100" } };
  openMeterFeed(() => 0);
  lastStream()?.emit("geometry", { nyquist: 22050, channels: 1, bins: 4 });
});

afterEach(() => {
  if (unmount) unmount();
  unmount = null;
});

test("test_the_first_paint_puts_a_full_width_image_at_the_left_edge", () => {
  const { spec } = mounted();
  assert.deepEqual(spec.puts, [{ x: 0, width: SPEC_SIZE.width }]);
});

test("test_a_close_moving_the_window_by_whole_columns_shifts_the_canvas_left_by_that_many", () => {
  const { spec } = mounted();
  frame(200);
  frame(100);
  assert.deepEqual(spec.draws, [
    { self: true, offset: -4 },
    { self: true, offset: -2 },
  ]);
});

test("test_a_close_moving_the_window_by_whole_columns_puts_only_the_new_columns_and_the_seam_before_them", () => {
  const { spec } = mounted();
  frame(200);
  frame(100);
  assert.deepEqual(spec.puts, [
    { x: 0, width: SPEC_SIZE.width },
    { x: SPEC_SIZE.width - 5, width: 5 },
    { x: SPEC_SIZE.width - 3, width: 3 },
  ]);
});

test("test_closes_too_short_to_move_a_column_put_nothing_after_the_first_paint", () => {
  setApodWindow("300");
  const { spec } = mounted();
  [50, 50, 50, 50].forEach(frame);
  assert.deepEqual(spec.puts, [{ x: 0, width: SPEC_SIZE.width }]);
});

test("test_a_change_of_range_repaints_the_full_width", () => {
  const { spec } = mounted();
  setMeterRange(LAST_RANGE);
  assert.deepEqual(spec.puts, [
    { x: 0, width: SPEC_SIZE.width },
    { x: 0, width: SPEC_SIZE.width },
  ]);
});

test("test_a_spectrogram_close_never_repaints_the_strip", () => {
  const { strip } = mounted();
  frame(200);
  frame(100);
  assert.deepEqual(strip.puts, [{ x: 0, width: STRIP_WIDTH }]);
});

test("test_closes_that_would_move_whole_columns_put_nothing_while_the_drawer_is_closed", () => {
  openStage.value = null;
  const { spec } = mounted();
  frame(200);
  frame(100);
  assert.deepEqual(spec.puts, []);
});

test("test_reopening_the_drawer_after_closes_puts_one_full_width_image", () => {
  const { spec } = mounted();
  openStage.value = null;
  frame(200);
  frame(100);
  openStage.value = "source";
  assert.deepEqual(spec.puts, [
    { x: 0, width: SPEC_SIZE.width },
    { x: 0, width: SPEC_SIZE.width },
  ]);
});

test("test_a_change_of_window_never_repaints_the_strip_while_the_drawer_is_closed", () => {
  const { strip } = mounted();
  openStage.value = null;
  setApodWindow("300");
  assert.deepEqual(strip.puts, [{ x: 0, width: STRIP_WIDTH }]);
});
