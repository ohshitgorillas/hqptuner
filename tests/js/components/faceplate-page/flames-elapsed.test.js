// Suite for the Flames spectrum style's pace: the flames advance on the time elapsed between paints, not on the count of
// paints. The same time drawn at another paint rate, or with some paints late, draws the same flames; a long gap
// catches the flames up a bounded way, so a longer gap draws what a shorter long gap does.
//
// Each case paints one steady full-scale spectrum under Flames through paintSourceScene, the page Source meter's own
// paint, each paint told the seconds since the last one and the style the one before it drew, on an effects canvas
// painter and no shader canvas. `Math.random` hands back a fixed table from its start in every case, so two cases that
// take the same steps draw the same flames.
//
// What a case draws is read from the last image the effects canvas was drawn from: how many cells of each row are not
// fully clear, top row first. The effects canvas is a fake whose context keeps, at each `drawImage`, the pixels its
// source was last put. A canvas the painter builds through `OffscreenCanvas` is a fake whose context hands back blank
// images and keeps a copy of the pixels last put on it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/flames-elapsed.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { paintSourceScene } from "../../../../hqptuner/static/components/faceplate/page/sourcepaint.js";
import { fxPainter } from "../../../../hqptuner/static/components/faceplate/page/spectrumfx.js";
import { ACCENT } from "../../../../hqptuner/static/model/gauges/meter/spectrumfx.js";

/** @typedef {{ width: number, height: number, data: Uint8ClampedArray }} Picture */

//: The effects canvas, in device pixels.
const W = 480;
const H = 170;
//: The meter loop's column count.
const COLS = 600;
//: A 60 dB plot.
const RANGE = 60;
//: The picked style, as the spectrum style setter takes it.
const FLAMES = "fire";
//: One meter loop step, s: the loop paints thirty times a second.
const STEP_S = 1 / 30;
//: A paint a whole 0.1 s after the last, three loop steps late.
const LATE_S = 0.1;
//: A paint 0.05 s after the last: twenty paints a second, a step and a half each.
const SLOW_S = 0.05;
//: Gaps long enough to be a hidden tab coming back, s.
const TEN_S = 10;
const MINUTE_S = 60;
//: What `Math.random` hands back, in turn: 89 fractions spread evenly over [0, 1), shuffled.
const DRAWS = Array.from({ length: 89 }, (_, i) => ((i * 29) % 89) / 89);

/**
 * A canvas the painter builds off the page: its context hands back blank images and keeps the pixels last put on it.
 */
class SheetCanvas {
  /**
   * @param {number} width
   * @param {number} height
   */
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(0);
  }

  getContext() {
    return {
      createImageData: (/** @type {number} */ w, /** @type {number} */ h) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4),
      }),
      putImageData: (/** @type {Picture} */ img) => {
        this.pixels = img.data.slice();
      },
    };
  }
}

/** @type {{ OffscreenCanvas?: unknown }} */ (globalThis).OffscreenCanvas = SheetCanvas;

/**
 * A W by H effects canvas whose context keeps, at each `drawImage`, the pixels its source was last put, and the
 * source's width.
 */
function effectsCanvas() {
  /** @type {{ pixels: Uint8ClampedArray, width: number }[]} */
  const drawn = [];
  const ctx = {
    clearRect: () => {},
    drawImage: (/** @type {SheetCanvas} */ src) => drawn.push({ pixels: src.pixels.slice(), width: src.width }),
  };
  return { width: W, height: H, drawn, getContext: () => ctx };
}

/**
 * How many cells of each row of a drawn sheet are not fully clear, top row first.
 *
 * @param {{ pixels: Uint8ClampedArray, width: number } | undefined} sheet
 * @returns {number[]}
 */
function litPerRow(sheet) {
  if (!sheet) return [];
  /** @type {number[]} */
  const rows = [];
  for (let i = 3; i < sheet.pixels.length; i += 4) {
    const row = Math.floor((i - 3) / 4 / sheet.width);
    rows[row] = (rows[row] ?? 0) + (sheet.pixels[i] > 0 ? 1 : 0);
  }
  return rows;
}

/**
 * The flames the last of a run of paints draws, one paint per entry of `gaps`, each that many seconds after the last,
 * every column of the spectrum at full scale.
 *
 * @param {number[]} gaps  s
 * @returns {number[]}  cells lit per row, top row first
 */
function flamesAfter(gaps) {
  const disp = new Float32Array(COLS).fill(0);
  const scene = { levels: [], vu: [], spectrum: { disp, ghost: disp }, raw: disp };
  const canvas = effectsCanvas();
  const fx = fxPainter(/** @type {any} */ (canvas), { glass: "#000" });
  const own = Math.random;
  let at = 0;
  Math.random = () => DRAWS[at++ % DRAWS.length];
  try {
    let last = "";
    for (const dt of gaps) {
      const look = { range: RANGE, picked: FLAMES, suite: ACCENT, last, dt };
      last = paintSourceScene(null, scene, { fx, aurora: null }, look);
    }
  } finally {
    Math.random = own;
  }
  return litPerRow(canvas.drawn.at(-1));
}

/**
 * `n` paints each `dt` seconds after the last.
 *
 * @param {number} n
 * @param {number} dt  s
 * @returns {number[]}
 */
const paints = (n, dt) => new Array(n).fill(dt);

test("test_flames_with_some_paints_late_draw_what_steady_paints_over_the_same_time_draw", () => {
  const late = [...paints(6, STEP_S), ...paints(2, LATE_S)];
  assert.deepEqual(flamesAfter(late), flamesAfter(paints(12, STEP_S)));
});

test("test_flames_painted_twenty_times_a_second_draw_what_thirty_a_second_draw_over_the_same_time", () => {
  assert.deepEqual(flamesAfter(paints(8, SLOW_S)), flamesAfter(paints(12, STEP_S)));
});

test("test_a_minute_gap_catches_the_flames_up_no_further_than_a_ten_second_gap", () => {
  const steady = paints(6, STEP_S);
  assert.deepEqual(flamesAfter([...steady, MINUTE_S]), flamesAfter([...steady, TEN_S]));
});
