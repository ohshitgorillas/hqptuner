// Painter suite for hqptuner/static/components/faceplate/page/spectrumfx.js: how big the page spectrum's canvas is
// drawn for a box and a pixel ratio, and what one paint draws on it under each spectrum style. "trace" and "aurora"
// leave the canvas clear for the SVG under it; "bars" clears and fills one rect per band, adding a peak cap per band;
// "ridges" clears and strokes one line per ridge row, a row more every RIDGE_EVERY paints; "fade" draws a halo where the
// trace has been and strokes the live trace over it. A change of style starts the new style's state afresh, and under
// "fade" so does a paint with no spectrum. Whether a halo carried over is read by comparing what the last paint draws
// after one history against what it draws after another, since the fake keeps no pixels.
//
// Under "fade", a change of style starting the halo afresh has no case here: a change of style already clears the
// canvas under every style, so a paint after one differs from a paint after none with or without a halo.
//
// The canvas is a fake whose 2D context records every method called on it by name and arguments; every property write
// is kept and read back, and `createImageData` hands back a plain image of the asked size. Only the drawing calls are
// read back (`DRAWS`), so how the painter sets up a path or a colour is never asserted. The canvas is 480 by 170, a
// width unlike the 600 columns the spectrum carries.
//
// A colour suite reaches a paint as its fourth argument, the suite's identifier as the store holds it. Whether a suite
// changes what a style draws is read by comparing what a paint draws under it against what the same paint draws under
// Mono: each drawing call is kept with the fill and stroke in force when it was made, and a gradient keeps its
// stops, so two paints compare by their colours without any one colour being asserted.
//
// Under the Accent palette a paint draws in shades of the accent in force, read from the theme store's signals; which
// shades is the painter's. Whether a change of accent reaches the next paint is read by comparing two painters with
// one history, every paint the same, except that the accent changes before the last paint of one of them. A fade
// paint's live trace is its last call, and its halo every call with that last call's own stroke taken out.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/spectrumfx-paint.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { fitCanvas, fxPainter } from "../../../../hqptuner/static/components/faceplate/page/spectrumfx.js";
import { BANDS, RIDGE_EVERY } from "../../../../hqptuner/static/model/gauges/meter/spectrumfx.js";
import { accent, accentHex } from "../../../../hqptuner/static/store/ui/theme.js";

/** @typedef {{ name: string, args: unknown[] }} Call */
/** @typedef {{ name: string, args: unknown[], fill: unknown, stroke: unknown, shadow?: unknown, blur?: unknown }} Ink */
/** @typedef {{ width: number, height: number, calls: Call[], inks: Ink[], getContext: (kind: string) => unknown }} FakeCanvas */
/** @typedef {import("../../../../hqptuner/static/model/gauges/meter/meter.js").SpectrumHold} SpectrumHold */

//: The canvas, in device pixels.
const W = 480;
const H = 170;
//: The meter loop's column count.
const COLS = 600;
//: A 60 dB plot.
const RANGE = 60;
//: Half way down a 60 dB plot.
const MID_DB = -RANGE / 2;
//: Three quarters of the way down a 60 dB plot, where the trace moves to from `MID_DB`.
const LOW_DB = (-3 * RANGE) / 4;
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

/** A gradient that keeps the stops added to it, so two gradients compare by their colours. */
class Gradient {
  constructor() {
    /** @type {[number, string][]} */
    this.stops = [];
  }

  /**
   * @param {number} at
   * @param {string} colour
   */
  addColorStop(at, colour) {
    this.stops.push([at, colour]);
  }
}

const gradient = () => new Gradient();

/**
 * A W by H canvas whose 2D context records each method called on it, and with each drawing call the fill and stroke
 * in force when it was made.
 *
 * @returns {FakeCanvas}
 */
function fakeCanvas() {
  /** @type {FakeCanvas} */
  const canvas = { width: W, height: H, calls: [], inks: [], getContext: () => ctx };
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
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    measureText: () => ({ width: 0 }),
  };
  const ctx = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key in props) return props[key];
        return (/** @type {unknown[]} */ ...args) => {
          canvas.calls.push({ name: String(key), args });
          if (DRAWS.has(String(key))) {
            canvas.inks.push({
              name: String(key),
              args,
              fill: props.fillStyle,
              stroke: props.strokeStyle,
              shadow: props.shadowColor,
              blur: props.shadowBlur,
            });
          }
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
 * A spectrum hold with every column at `db`, its ghost sitting on the shown level.
 *
 * @param {number} db
 * @returns {SpectrumHold}
 */
function hold(db) {
  const disp = new Float32Array(COLS).fill(db);
  return { disp, ghost: disp };
}

/**
 * A painter on a fresh fake canvas.
 *
 * @returns {{ canvas: FakeCanvas, fx: { paint: (s: SpectrumHold | null, r: number, style: string, suite?: string) => void, clear: () => void } }}
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

// ── bars ─────────────────────────────────────────────────────────────────

for (const style of ["bars", "ridges"]) {
  test(`test_a_${style}_paint_starts_by_clearing_the_whole_canvas`, () => {
    assert.deepEqual(lastPaint(style)[0], CLEAR_ALL);
  });
}

test("test_a_bars_paint_fills_a_bar_and_a_peak_cap_for_every_band", () => {
  assert.equal(count(lastPaint("bars"), "fillRect"), 2 * BANDS);
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

// ── fade ─────────────────────────────────────────────────────────────────

/**
 * The drawing calls of the last of `steps` paints on one fresh painter, each step a spectrum (or none) and a style.
 *
 * @param {[SpectrumHold | null, string][]} steps
 * @returns {Call[]}
 */
function lastOf(steps) {
  const { canvas, fx } = painter();
  for (const [spectrum, style] of steps) {
    canvas.calls = [];
    fx.paint(spectrum, RANGE, style);
  }
  return canvas.calls.filter((c) => DRAWS.has(c.name));
}

/** Three fade paints with the trace half way down, then one with it moved lower: the halo of the first three lingers. */
const KEPT_FADE = /** @type {[SpectrumHold | null, string][]} */ ([
  [hold(MID_DB), "fade"],
  [hold(MID_DB), "fade"],
  [hold(MID_DB), "fade"],
  [hold(LOW_DB), "fade"],
]);

test("test_a_fade_paint_strokes_the_live_trace_last", () => {
  assert.equal(lastPaint("fade", 3).at(-1)?.name, "stroke");
});

test("test_a_fade_paint_after_one_with_no_spectrum_starts_without_the_old_halo", () => {
  const blanked = lastOf([
    [hold(MID_DB), "fade"],
    [hold(MID_DB), "fade"],
    [null, "fade"],
    [hold(LOW_DB), "fade"],
  ]);
  assert.notDeepEqual(blanked, lastOf(KEPT_FADE));
});

// ── colour suites ────────────────────────────────────────────────────────

//: Two suites the owner offers, as the store holds them.
const MONO = "mono";
const INFERNO = "inferno";
//: Paints enough for a ridge row and a lingering halo to be on the canvas.
const PAINTS = RIDGE_EVERY + 1;

/**
 * What the last of PAINTS paints of `style` under colour suite `suite` draws, with the fill and stroke of each drawing
 * call; the trace runs from `LOW_DB` at the low end to `MID_DB` above it, so louder and quieter parts are both drawn.
 *
 * @param {string} style
 * @param {string} suite
 * @returns {Ink[]}
 */
function inked(style, suite) {
  const { canvas, fx } = painter();
  const disp = new Float32Array(COLS).fill(LOW_DB).fill(MID_DB, COLS / 2);
  for (let k = 1; k < PAINTS; k += 1) fx.paint({ disp, ghost: disp }, RANGE, style, suite);
  canvas.inks = [];
  fx.paint({ disp, ghost: disp }, RANGE, style, suite);
  return canvas.inks;
}

for (const style of ["bars", "ridges", "fade"]) {
  test(`test_a_change_of_suite_changes_what_a_${style}_paint_draws`, () => {
    assert.notDeepEqual(inked(style, INFERNO), inked(style, MONO));
  });
}

// ── the Accent palette ───────────────────────────────────────────────────

//: The palette that draws in the user's accent, as the store holds it.
const ACCENT = "accent";
//: Two custom accents, unlike each other and unlike every colour the painter is built with.
const FIRST_HEX = "#4f9dde";
const SECOND_HEX = "#c03a9b";
//: An accent preset, as the theme store holds it.
const PRESET = "violet";

/**
 * What the last paint of `style` under Accent draws: PAINTS paints under the custom accent FIRST_HEX, then the accent
 * becomes `then` and the same painter paints once more.
 *
 * @param {string} style
 * @param {string} [then]
 * @returns {Ink[]}
 */
function afterAccentChange(style, then = SECOND_HEX) {
  accent.value = PRESET;
  accentHex.value = FIRST_HEX;
  const { canvas, fx } = painter();
  const disp = new Float32Array(COLS).fill(LOW_DB).fill(MID_DB, COLS / 2);
  for (let k = 0; k < PAINTS; k += 1) fx.paint({ disp, ghost: disp }, RANGE, style, ACCENT);
  accentHex.value = then;
  canvas.inks = [];
  fx.paint({ disp, ghost: disp }, RANGE, style, ACCENT);
  return canvas.inks;
}

/**
 * The halo of a fade paint: every drawing call it makes, with the last call's own stroke, the live trace's, taken out.
 *
 * @param {Ink[]} inks
 * @returns {Ink[]}
 */
const haloOf = (inks) => inks.map((ink, i) => (i === inks.length - 1 ? { ...ink, stroke: undefined } : ink));

for (const style of ["bars", "ridges"]) {
  test(`test_under_accent_a_${style}_paint_follows_a_change_of_accent`, () => {
    assert.notDeepEqual(afterAccentChange(style, SECOND_HEX), afterAccentChange(style, FIRST_HEX));
  });
}

test("test_under_accent_the_fade_live_trace_follows_a_change_of_accent", () => {
  assert.notDeepEqual(afterAccentChange("fade", SECOND_HEX).at(-1), afterAccentChange("fade", FIRST_HEX).at(-1));
});

test("test_under_accent_the_fade_halo_follows_a_change_of_accent", () => {
  assert.notDeepEqual(haloOf(afterAccentChange("fade", SECOND_HEX)), haloOf(afterAccentChange("fade", FIRST_HEX)));
});
