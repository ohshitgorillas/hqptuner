// Painter suite for hqptuner/static/components/faceplate/page/spectrumfx.js: how big the page spectrum's canvas is
// drawn for a box and a pixel ratio, and what one paint draws on it under each spectrum style. "trace" and "aurora"
// leave the canvas clear for the SVG under it; "bars" and "soft" clear and fill one rect per band, bars adding a peak
// cap per band; "ridges" clears and strokes one line per ridge row, a row more every RIDGE_EVERY paints. A change of
// style starts the new style's state afresh.
//
// The canvas is a fake whose 2D context records every method called on it by name and arguments; every property write
// is kept and read back, and `createImageData` hands back a plain image of the asked size. Only the drawing calls are
// read back (`DRAWS`), so how the painter sets up a path or a colour is never asserted. The canvas is 480 by 170, a
// width unlike the 600 columns the spectrum carries.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/spectrumfx-paint.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { fitCanvas, fxPainter } from "../../../../hqptuner/static/components/faceplate/page/spectrumfx.js";
import { BANDS, RIDGE_EVERY } from "../../../../hqptuner/static/model/gauges/spectrumfx.js";

/** @typedef {{ name: string, args: unknown[] }} Call */
/** @typedef {{ width: number, height: number, calls: Call[], getContext: (kind: string) => unknown }} FakeCanvas */
/** @typedef {import("../../../../hqptuner/static/model/gauges/meter.js").SpectrumHold} SpectrumHold */

//: The canvas, in device pixels.
const W = 480;
const H = 170;
//: The meter loop's column count.
const COLS = 600;
//: A 60 dB plot.
const RANGE = 60;
//: Half way down a 60 dB plot.
const MID_DB = -RANGE / 2;
//: The calls that put pixels on the canvas or take them off.
const DRAWS = new Set([
  "clearRect",
  "fillRect",
  "strokeRect",
  "fill",
  "stroke",
  "putImageData",
  "drawImage",
  "fillText",
  "strokeText",
]);

/** The colours a painter is built with: five CSS colours. */
const COLOURS = {
  lo: "#2a8",
  mid: "#cc4",
  hi: "#d43",
  meter: "#999",
  glass: "#fff",
};

/**
 * An image of `w` by `hh` pixels.
 *
 * @param {number} w
 * @param {number} hh
 */
const image = (w, hh) => ({ width: w, height: hh, data: new Uint8ClampedArray(w * hh * 4) });

/**
 * A W by H canvas whose 2D context records each method called on it.
 *
 * @returns {FakeCanvas}
 */
function fakeCanvas() {
  /** @type {FakeCanvas} */
  const canvas = { width: W, height: H, calls: [], getContext: () => ctx };
  /** @type {Record<string | symbol, unknown>} */
  const props = { canvas };
  /** @type {Record<string, (...args: any[]) => unknown>} */
  const made = {
    createImageData: (/** @type {number | { width: number, height: number }} */ w, /** @type {number} */ hh) =>
      typeof w === "number" ? image(w, hh) : image(w.width, w.height),
    getImageData: (
      /** @type {number} */ _x,
      /** @type {number} */ _y,
      /** @type {number} */ w,
      /** @type {number} */ hh,
    ) => image(w, hh),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    measureText: () => ({ width: 0 }),
  };
  const ctx = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key in props) return props[key];
        return (/** @type {unknown[]} */ ...args) => {
          canvas.calls.push({ name: String(key), args });
          const make = made[String(key)];
          return make ? make(...args) : undefined;
        };
      },
      set: (_t, key, value) => {
        props[key] = value;
        return true;
      },
    },
  );
  return canvas;
}

/**
 * A spectrum hold with every column at `db`.
 *
 * @param {number} db
 * @returns {SpectrumHold}
 */
function hold(db) {
  const disp = new Float32Array(COLS).fill(db);
  return { disp, peak: new Float32Array(COLS).fill(db), peakAt: new Float32Array(COLS) };
}

/**
 * A painter on a fresh fake canvas.
 *
 * @returns {{ canvas: FakeCanvas, fx: { paint: (s: SpectrumHold | null, r: number, style: string) => void, clear: () => void } }}
 */
function painter() {
  const canvas = fakeCanvas();
  const fx = fxPainter(/** @type {HTMLCanvasElement} */ (/** @type {unknown} */ (canvas)), COLOURS);
  return { canvas, fx };
}

/**
 * The drawing calls of the last of `times` paints of `style` with every column at `db`, earlier paints forgotten.
 *
 * @param {string} style
 * @param {number} [times]
 * @param {SpectrumHold | null} [spectrum]
 * @returns {Call[]}
 */
function lastPaint(style, times = 1, spectrum = hold(MID_DB)) {
  const { canvas, fx } = painter();
  for (let k = 1; k < times; k += 1) fx.paint(spectrum, RANGE, style);
  canvas.calls = [];
  fx.paint(spectrum, RANGE, style);
  return canvas.calls.filter((c) => DRAWS.has(c.name));
}

/**
 * How many of `calls` are to `name`.
 *
 * @param {Call[]} calls
 * @param {string} name
 */
const count = (calls, name) => calls.filter((c) => c.name === name).length;

/** The one whole-canvas clear, as a recorded call. */
const CLEAR_ALL = { name: "clearRect", args: [0, 0, W, H] };

// ── fitCanvas ────────────────────────────────────────────────────────────

test("test_a_canvas_is_its_box_times_the_pixel_ratio_rounded_to_the_nearest_pixel", () => {
  assert.deepEqual(fitCanvas({ width: 300.4, height: 170.2 }, 2), { width: 601, height: 340 });
});

test("test_a_canvas_is_never_narrower_or_shorter_than_one_pixel", () => {
  assert.deepEqual(fitCanvas({ width: 0, height: 0.1 }, 1), { width: 1, height: 1 });
});

// ── nothing to draw ──────────────────────────────────────────────────────

test("test_a_paint_with_no_spectrum_only_clears_the_whole_canvas", () => {
  assert.deepEqual(lastPaint("bars", 1, null), [CLEAR_ALL]);
});

for (const style of ["trace", "aurora"]) {
  test(`test_a_${style}_paint_only_clears_the_whole_canvas`, () => {
    assert.deepEqual(lastPaint(style), [CLEAR_ALL]);
  });
}

test("test_clear_clears_the_whole_canvas_once", () => {
  const { canvas, fx } = painter();
  fx.clear();
  assert.deepEqual(
    canvas.calls.filter((c) => DRAWS.has(c.name)),
    [CLEAR_ALL],
  );
});

// ── bars and soft ────────────────────────────────────────────────────────

for (const style of ["bars", "soft", "ridges"]) {
  test(`test_a_${style}_paint_starts_by_clearing_the_whole_canvas`, () => {
    assert.deepEqual(lastPaint(style)[0], CLEAR_ALL);
  });
}

test("test_a_bars_paint_fills_a_bar_and_a_peak_cap_for_every_band", () => {
  assert.equal(count(lastPaint("bars"), "fillRect"), 2 * BANDS);
});

test("test_a_soft_paint_fills_one_bar_for_every_band_and_no_caps", () => {
  assert.equal(count(lastPaint("soft"), "fillRect"), BANDS);
});

// ── ridges ───────────────────────────────────────────────────────────────

test("test_the_first_ridges_paint_strokes_one_ridge", () => {
  assert.equal(count(lastPaint("ridges"), "stroke"), 1);
});

test("test_a_ridges_paint_after_ridge_every_more_strokes_two_ridges", () => {
  assert.equal(count(lastPaint("ridges", RIDGE_EVERY + 1), "stroke"), 2);
});

test("test_ridges_picked_again_after_another_style_start_over_at_one_ridge", () => {
  const { canvas, fx } = painter();
  for (let k = 0; k < RIDGE_EVERY + 1; k += 1) fx.paint(hold(MID_DB), RANGE, "ridges");
  fx.paint(hold(MID_DB), RANGE, "bars");
  canvas.calls = [];
  fx.paint(hold(MID_DB), RANGE, "ridges");
  assert.equal(count(canvas.calls, "stroke"), 1);
});
