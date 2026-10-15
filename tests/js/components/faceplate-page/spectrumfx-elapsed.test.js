// Suite for the pace of the page spectrum's Bars peak caps, Ridges rows and Fade halo: each moves on the time elapsed
// between paints, not on the count of paints, so a run with some paints late leaves it where steady paints over the
// same time do.
//
// Each case paints through fxPainter, each paint told the seconds since the last one. Bars paints one loud spectrum,
// then a quiet one that the caps hold over and later fall toward; the late paints all land inside the caps' hold, where
// a cap stays put however its time is cut up, so the two runs leave the caps at one place. Ridges paints one spectrum
// throughout, so the two runs differ only in how many rows they have stacked. Fade paints the same
// spectrum throughout, on a canvas whose glow under the trace is full on the first paint and clear after it, so all
// the later halo is the first paint's, dimming; each paint rounds the halo to a whole step of alpha, so the two runs
// agree to within a step per paint.
//
// The canvas is a fake whose context records each method called on it by name and arguments and keeps property
// writes. `getImageData` answers from a table: the first call an image fully opaque, every later one fully clear.
// Where a cap sits is read from the last rect the paint fills, the last band's cap; how many ridge rows stand, from the
// lines the last paint strokes; how strong the halo is, from the alpha of the first pixel of the last image put on the
// canvas.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/spectrumfx-elapsed.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { fxPainter } from "../../../../hqptuner/static/components/faceplate/page/spectrumfx.js";
import { near } from "../../support/near.js";

/** @typedef {{ name: string, args: any[] }} Call */
/** @typedef {{ width: number, height: number, data: Uint8ClampedArray }} Picture */

//: The canvas, in device pixels: small, so each image is cheap.
const W = 8;
const H = 100;
//: The meter loop's column count.
const COLS = 600;
//: A 60 dB plot.
const RANGE = 60;
//: Three quarters of the way up a 60 dB plot, and a quarter of the way up.
const LOUD_DB = -15;
const QUIET_DB = -45;
//: One meter loop step, s.
const STEP_S = 1 / 30;
//: A paint a whole 0.1 s after the last, three loop steps late.
const LATE_S = 0.1;
//: Steady paints making up 0.4 s, inside the caps' half-second hold, and late paints making up the same.
const STEADY_HOLD = 12;
const LATE_HOLD = 4;
//: Steady paints after the hold, long enough for the caps to fall a good way.
const FALLING = 15;
//: How far apart two cap places may be, canvas pixels: float rounding only.
const CAP_TOL_PX = 1e-3;
//: How far apart two halo strengths may be, alpha steps: half a step for each paint's rounding.
const HALO_TOL = (STEADY_HOLD + FALLING) / 2;
//: The most alpha a pixel holds.
const OPAQUE = 255;

/**
 * An image `w` by `h` pixels, every pixel's alpha `alpha`.
 *
 * @param {number} w
 * @param {number} h
 * @param {number} alpha
 * @returns {Picture}
 */
function picture(w, h, alpha) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = alpha;
  return { width: w, height: h, data };
}

/** A W by H canvas whose context records its calls; `getImageData` hands back one opaque image, then clear ones. */
function recordingCanvas() {
  /** @type {Call[]} */
  const calls = [];
  /** @type {Record<string | symbol, unknown>} */
  const props = {};
  let reads = 0;
  /** @type {Record<string, (...args: any[]) => unknown>} */
  const made = {
    getImageData: (
      /** @type {number} */ _x,
      /** @type {number} */ _y,
      /** @type {number} */ w,
      /** @type {number} */ h,
    ) => picture(w, h, reads++ === 0 ? OPAQUE : 0),
    createLinearGradient: () => ({ addColorStop: () => {} }),
  };
  const ctx = new Proxy(
    {},
    {
      get: (_t, key) =>
        key in props
          ? props[key]
          : (/** @type {any[]} */ ...args) => {
              calls.push({ name: String(key), args });
              return made[String(key)]?.(...args);
            },
      set: (_t, key, value) => {
        props[key] = value;
        return true;
      },
    },
  );
  return { width: W, height: H, calls, getContext: () => ctx };
}

/**
 * A spectrum hold with every column at `db`.
 *
 * @param {number} db
 */
function hold(db) {
  const disp = new Float32Array(COLS).fill(db);
  return { disp, ghost: disp };
}

/**
 * The calls of a run of paints under `style`, one per entry of `paints`, each that many seconds after the last and
 * with every column at its level.
 *
 * @param {string} style
 * @param {[number, number][]} paints  [s, dBFS]
 * @returns {Call[]}
 */
function run(style, paints) {
  const canvas = recordingCanvas();
  const fx = fxPainter(/** @type {any} */ (canvas), { glass: "#000" });
  for (const [dt, db] of paints) fx.paint(hold(db), RANGE, style, { dt });
  return canvas.calls;
}

/**
 * `n` paints each `dt` seconds after the last, every column at `db`.
 *
 * @param {number} n
 * @param {number} dt  s
 * @param {number} db
 * @returns {[number, number][]}
 */
const paints = (n, dt, db) => new Array(n).fill([dt, db]);

/**
 * Where the last band's cap sits after a run of Bars paints: the top of the last rect filled, canvas pixels down.
 *
 * @param {[number, number][]} history
 * @returns {number}
 */
function capTop(history) {
  const rect = run("bars", history)
    .filter((c) => c.name === "fillRect")
    .at(-1);
  return rect ? rect.args[1] : NaN;
}

/**
 * How many ridge rows the last of a run of Ridges paints draws: the lines it strokes after it last clears.
 *
 * @param {[number, number][]} history
 * @returns {number}
 */
function ridgeRows(history) {
  const calls = run("ridges", history);
  const cleared = calls.map((c) => c.name).lastIndexOf("clearRect");
  return calls.slice(cleared).filter((c) => c.name === "stroke").length;
}

/**
 * How strong the halo is after a run of Fade paints: the alpha of the first pixel of the last image put.
 *
 * @param {[number, number][]} history
 * @returns {number}
 */
function haloAlpha(history) {
  const put = run("fade", history)
    .filter((c) => c.name === "putImageData")
    .at(-1);
  return put ? put.args[0].data[3] : NaN;
}

test("test_peak_caps_with_some_paints_late_sit_where_steady_paints_over_the_same_time_leave_them", () => {
  const loud = paints(1, STEP_S, LOUD_DB);
  const after = paints(FALLING, STEP_S, QUIET_DB);
  const late = capTop([...loud, ...paints(LATE_HOLD, LATE_S, QUIET_DB), ...after]);
  const steady = capTop([...loud, ...paints(STEADY_HOLD, STEP_S, QUIET_DB), ...after]);
  assert.ok(...near(late, steady, CAP_TOL_PX));
});

test("test_ridges_with_some_paints_late_stack_as_many_rows_as_steady_paints_over_the_same_time", () => {
  const first = paints(1, STEP_S, LOUD_DB);
  const late = ridgeRows([...first, ...paints(LATE_HOLD, LATE_S, LOUD_DB)]);
  assert.equal(late, ridgeRows([...first, ...paints(STEADY_HOLD, STEP_S, LOUD_DB)]));
});

test("test_the_fade_halo_with_some_paints_late_dims_as_far_as_steady_paints_over_the_same_time", () => {
  const first = paints(1, STEP_S, LOUD_DB);
  const after = paints(FALLING, STEP_S, LOUD_DB);
  const late = haloAlpha([...first, ...paints(LATE_HOLD, LATE_S, LOUD_DB), ...after]);
  const steady = haloAlpha([...first, ...paints(STEADY_HOLD, STEP_S, LOUD_DB), ...after]);
  assert.ok(...near(late, steady, HALO_TOL));
});
