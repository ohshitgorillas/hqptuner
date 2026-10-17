// Painter suite for hqptuner/static/components/faceplate/page/spectrumfx.js: the page spectrum's effects canvas, laid
// over the SVG trace. A paint is handed the shown columns in dBFS, the range in dB, the picked style, and its color
// suite, the seconds since the last paint and whether it restarts. The bars, ridges, fade and fire styles draw here;
// the trace and aurora styles leave this canvas clear. A restart, a change of style or a paint with no spectrum starts
// the style afresh. Motion keeps to the time a paint is told has passed, so late paints and steady ones over the same
// stretch leave the same picture.
//
// The canvas is tests/js/support/raster.js, wrapped so that every color the painter draws in is also kept: each string
// set as a fill, stroke or shadow style, each gradient stop, and the color of each inked pixel an image writes. Pictures
// are read from its ink, never from which calls made it. Colors are compared as sets, so no one color is asserted. A
// canvas the painter makes for itself with OffscreenCanvas, which plain node lacks, is a raster canvas too, and the
// colors drawn on it are kept with those of the canvas the painter under test was made on.
//
// How far a picture moves between two moments is its travel: the ink in each row summed across the canvas, then the
// running total of those row sums from the top, and the sum over rows of how far apart the two running totals stand. A
// cap of ink moved down by d rows travels its ink times d; ink that fades travels its lost ink times its rows from the
// floor. Whether two runs move alike is the travel between them at every shared moment, as a share of the travel
// their steady run makes from its first picture to each of those moments.
//
// The fire style draws from Math.random. This suite replaces it with one that always answers the same number, so every
// run is deterministic and a picture never depends on which draw came when.
//
// A paint with no spectrum is a paint of no columns. A canvas box is the `{ width, height }` its element measures, in
// CSS pixels.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/spectrumfx-fx.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { fitCanvas, fxPainter } from "../../../../hqptuner/static/components/faceplate/page/spectrumfx.js";
import { accent, accentHex } from "../../../../hqptuner/static/store/ui/theme.js";
import { near } from "../../support/near.js";
import { rasterCanvas } from "../../support/raster.js";

/** @typedef {{ width: number, height: number, ink: Float32Array, colors: Set<string>, getContext: () => unknown }} Paper */
/** @typedef {ReturnType<typeof fxPainter>} Painter */
/** @typedef {{ add: (color: string) => unknown }} Keeper */

//: The canvas, in device pixels, and the columns one paint is handed: one per pixel across.
const W = 128;
const H = 48;
const COLS = W;
//: A 60 dB plot, and a wider one.
const RANGE = 60;
const WIDE_RANGE = 90;
//: Near the top, half way down and well under the floor of a 60 dB plot, dBFS.
const LOUD_DB = -6;
const MID_DB = -RANGE / 2;
const QUIET_DB = -RANGE - 30;
//: One steady paint, s, and a late one four steady paints long; both exact in binary.
const STEP_S = 1 / 32;
const LATE_S = 1 / 8;
const STEADY_PER_LATE = 4;
//: Moments compared along a run, one late paint apart: two seconds in all.
const MOMENTS = 16;
//: Paints laid down before the paint a test reads.
const HISTORY = 3;
//: How far two runs over the same time may move apart, as a share of how far the steady run moves: rounding and
//: one step's carry, not a paint rate's whole difference.
const TRAVEL_TOL = 0.2;
//: How much of an earlier picture may survive a fresh start: none, up to float noise.
const NONE_TOL = 1e-6;
//: The fill under each ridge.
const GLASS = "#101418";
//: What the replaced Math.random always answers.
const DRAW = 0.5;

//: The spectrum styles as the store holds them.
const TRACE = "trace";
const AURORA = "aurora";
const BARS = "bars";
const RIDGES = "ridges";
const FADE = "fade";
const FIRE = "fire";
//: The styles drawn on this canvas.
const DRAWN = [BARS, RIDGES, FADE, FIRE];
//: Color suites the owner offers, as the store holds them.
const MONO = "mono";
const INFERNO = "inferno";
const ACCENT = "accent";
//: Two custom accents, unlike each other, under an accent preset as the theme store holds it.
const FIRST_HEX = "#4f9dde";
const SECOND_HEX = "#c03a9b";
const PRESET = "violet";

Math.random = () => DRAW;

/**
 * A color as kept: trimmed and lower case; anything but a string is not a color and is not kept.
 *
 * @param {Keeper} colors
 * @param {unknown} value
 */
function keep(colors, value) {
  if (typeof value === "string") colors.add(value.trim().toLowerCase());
}

/**
 * Keep the color of every pixel of `img` that holds ink.
 *
 * @param {Keeper} colors
 * @param {{ data: Uint8ClampedArray }} img
 */
function keepPixels(colors, img) {
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3]) colors.add(`rgb(${img.data[i]},${img.data[i + 1]},${img.data[i + 2]})`);
  }
}

/**
 * A gradient made by `make` whose stops' colors are kept.
 *
 * @param {Keeper} colors
 * @param {(...a: unknown[]) => any} make
 */
const keptGradient =
  (colors, make) =>
  (/** @type {unknown[]} */ ...args) => {
    const g = make(...args);
    return {
      addColorStop(/** @type {number} */ at, /** @type {string} */ color) {
        keep(colors, color);
        g.addColorStop(at, color);
      },
    };
  };

/** The context properties whose value is a color. */
const COLOR_PROPS = new Set(["fillStyle", "strokeStyle", "shadowColor"]);

/**
 * The context of `raster`, wrapped so that it also keeps, in `colors`, every color drawn in.
 *
 * @param {ReturnType<typeof rasterCanvas>} raster
 * @param {Keeper} colors
 */
function keeping(raster, colors) {
  const ctx = /** @type {any} */ (raster.getContext());
  /** @type {Record<string, unknown>} */
  const kept = {
    createLinearGradient: keptGradient(colors, ctx.createLinearGradient),
    createRadialGradient: keptGradient(colors, ctx.createRadialGradient),
    putImageData: (/** @type {any} */ img, /** @type {number[]} */ ...args) => {
      keepPixels(colors, img);
      return ctx.putImageData(img, ...args);
    },
  };
  return new Proxy(
    {},
    {
      get: (_t, key) => (typeof key === "string" && key in kept ? kept[key] : ctx[key]),
      set: (_t, key, value) => {
        if (typeof key === "string" && COLOR_PROPS.has(key)) keep(colors, value);
        ctx[key] = value;
        return true;
      },
    },
  );
}

/**
 * The colors of the canvas made last for a painter under test, which its own offscreen canvases keep into too.
 *
 * @type {Set<string>}
 */
let current = new Set();

/** Keeps each color into the colors current when it is drawn. */
const toCurrent = { add: (/** @type {string} */ color) => current.add(color) };

/**
 * A W by H raster canvas whose context also keeps, in `colors`, every color drawn in.
 *
 * @returns {Paper}
 */
function paper() {
  const raster = rasterCanvas(W, H);
  /** @type {Set<string>} */
  const colors = new Set();
  current = colors;
  const wrapped = keeping(raster, colors);
  return { width: W, height: H, ink: raster.ink, colors, getContext: () => wrapped };
}

/**
 * The global the canvas constructor is installed on, viewed as an optional member: plain node has none.
 *
 * @type {{ OffscreenCanvas?: unknown }}
 */
const env = globalThis;

env.OffscreenCanvas = function OffscreenCanvas(/** @type {number} */ w, /** @type {number} */ h) {
  const raster = rasterCanvas(w, h);
  const wrapped = keeping(raster, toCurrent);
  return { width: w, height: h, ink: raster.ink, getContext: () => wrapped };
};

/**
 * A painter on a fresh canvas, and the canvas.
 *
 * @returns {{ canvas: Paper, fx: Painter }}
 */
function fresh() {
  const canvas = paper();
  const fx = fxPainter(/** @type {HTMLCanvasElement} */ (/** @type {unknown} */ (canvas)), { glass: GLASS });
  return { canvas, fx };
}

/**
 * Every column at `db`.
 *
 * @param {number} db
 */
const flat = (db) => new Float32Array(COLS).fill(db);

/** No columns: a paint with no spectrum. */
const NO_SPECTRUM = new Float32Array(0);

/**
 * One paint of `fx` in `style` under Mono, `dt` seconds after the last.
 *
 * @param {Painter} fx
 * @param {string} style
 * @param {ArrayLike<number>} columns
 * @param {{ dt?: number, restart?: boolean, range?: number, suite?: string }} [o]
 */
function paintOnce(fx, style, columns, o = {}) {
  const { dt = STEP_S, restart = false, range = RANGE, suite = MONO } = o;
  fx.paint(columns, range, style, { suite, dt, restart });
}

/**
 * `n` steady paints of `fx` in `style`, every column at `db`.
 *
 * @param {Painter} fx
 * @param {string} style
 * @param {number} db
 * @param {number} [n]
 */
function paintRun(fx, style, db, n = HISTORY) {
  for (let i = 0; i < n; i++) paintOnce(fx, style, flat(db));
}

/**
 * A copy of what `canvas` shows now.
 *
 * @param {Paper} canvas
 */
const shot = (canvas) => Float32Array.from(canvas.ink);

/**
 * All the ink in `pic`, or in its columns from `x0` up to, not including, `x1`.
 *
 * @param {Float32Array} pic
 * @param {number} [x0]
 * @param {number} [x1]
 */
function inkIn(pic, x0 = 0, x1 = W) {
  let sum = 0;
  for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) sum += pic[y * W + x];
  return sum;
}

/**
 * How far apart two pictures stand, pixel by pixel.
 *
 * @param {Float32Array} a
 * @param {Float32Array} b
 */
function difference(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum;
}

/**
 * The travel between two pictures, as the suite's header defines it.
 *
 * @param {Float32Array} a
 * @param {Float32Array} b
 */
function travel(a, b) {
  let runA = 0;
  let runB = 0;
  let sum = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      runA += a[y * W + x];
      runB += b[y * W + x];
    }
    sum += Math.abs(runA - runB);
  }
  return sum;
}

// ── the canvas size ─────────────────────────────────────────────────────

test("test_a_canvas_is_its_box_times_the_pixel_ratio_rounded_to_the_nearest_pixel", () => {
  assert.deepEqual(fitCanvas({ width: 100.4, height: 50.1 }, 2), { width: 201, height: 100 });
});

test("test_a_canvas_is_never_under_one_pixel_a_side", () => {
  assert.deepEqual(fitCanvas({ width: 0.2, height: 30 }, 2), { width: 1, height: 60 });
});

// ── what a paint is handed ──────────────────────────────────────────────

test("test_a_paint_told_no_time_is_an_error", () => {
  const { fx } = fresh();
  const untimed = /** @type {any} */ ({ suite: MONO, restart: false });
  assert.throws(() => fx.paint(flat(MID_DB), RANGE, BARS, untimed));
});

test("test_a_paint_draws_the_columns_it_is_handed", () => {
  const { canvas, fx } = fresh();
  const columns = flat(QUIET_DB).fill(LOUD_DB, 0, COLS / 2);
  paintOnce(fx, BARS, columns);
  const pic = shot(canvas);
  assert.ok(inkIn(pic, W / 2, W) < inkIn(pic, 0, W / 2), "the loud left half inks no more than the floor-level right");
});

/**
 * The ink one bars paint of every column half way down a 60 dB plot leaves on a plot `range` dB deep.
 *
 * @param {number} range
 */
function midBarsOn(range) {
  const { canvas, fx } = fresh();
  paintOnce(fx, BARS, flat(MID_DB), { range });
  return inkIn(shot(canvas));
}

test("test_a_paint_draws_on_the_range_it_is_handed", () => {
  assert.ok(midBarsOn(WIDE_RANGE) > midBarsOn(RANGE), "the same levels stand no taller on a deeper plot");
});

/**
 * What a fresh canvas shows after a few paints in `style`, every column half way down.
 *
 * @param {string} style
 */
function pictureOf(style) {
  const { canvas, fx } = fresh();
  paintRun(fx, style, MID_DB);
  return shot(canvas).join(",");
}

test("test_each_drawn_style_paints_its_own_picture", () => {
  assert.equal(new Set(DRAWN.map(pictureOf)).size, DRAWN.length);
});

// ── color suites ────────────────────────────────────────────────────────

/**
 * Every color a few paints in `style` under `suite` draw in, sorted.
 *
 * @param {string} style
 * @param {string} suite
 */
function colorsUnder(style, suite) {
  const { canvas, fx } = fresh();
  for (let i = 0; i < HISTORY; i++) paintOnce(fx, style, flat(MID_DB), { suite });
  return [...canvas.colors].sort();
}

for (const style of DRAWN) {
  test(`test_a_change_of_suite_changes_what_a_${style}_paint_draws`, () => {
    assert.notDeepEqual(colorsUnder(style, INFERNO), colorsUnder(style, MONO));
  });
}

/**
 * Every color the second of two paints in `style` under Accent draws in, sorted, the accent being the custom
 * FIRST_HEX for the first paint and `then` for the second.
 *
 * @param {string} style
 * @param {string} then
 */
function secondUnderAccent(style, then) {
  accent.value = PRESET;
  accentHex.value = FIRST_HEX;
  const { canvas, fx } = fresh();
  paintOnce(fx, style, flat(MID_DB), { suite: ACCENT });
  accentHex.value = then;
  canvas.colors.clear();
  paintOnce(fx, style, flat(MID_DB), { suite: ACCENT });
  return [...canvas.colors].sort();
}

for (const style of DRAWN) {
  test(`test_under_accent_a_${style}_paint_follows_a_change_of_accent`, () => {
    assert.notDeepEqual(secondUnderAccent(style, SECOND_HEX), secondUnderAccent(style, FIRST_HEX));
  });
}

// ── trace and aurora ────────────────────────────────────────────────────

/**
 * The ink left after a few `style` paints, as a share of the ink a few bars paints had laid before them.
 *
 * @param {string} style
 */
function leftAfterBarsThen(style) {
  const { canvas, fx } = fresh();
  paintRun(fx, BARS, LOUD_DB);
  const before = inkIn(shot(canvas));
  paintRun(fx, style, LOUD_DB);
  return inkIn(shot(canvas)) / before;
}

for (const style of [TRACE, AURORA]) {
  test(`test_the_${style}_style_leaves_this_canvas_clear`, () => {
    assert.ok(...near(leftAfterBarsThen(style), 0, NONE_TOL));
  });
}

// ── starting afresh ─────────────────────────────────────────────────────

/**
 * What a fresh canvas shows after one paint in `style`, every column half way down, told to restart.
 *
 * @param {string} style
 */
function freshPicture(style) {
  const { canvas, fx } = fresh();
  paintOnce(fx, style, flat(MID_DB), { restart: true });
  return shot(canvas);
}

/**
 * How much of the picture before `trigger` survives it, as the difference from a fresh start after it over the
 * difference before it.
 *
 * @param {string} style
 * @param {(fx: Painter) => void} history
 * @param {(fx: Painter) => void} trigger
 */
function survives(style, history, trigger) {
  const { canvas, fx } = fresh();
  history(fx);
  const before = shot(canvas);
  trigger(fx);
  const clean = freshPicture(style);
  return difference(shot(canvas), clean) / difference(before, clean);
}

for (const style of DRAWN) {
  test(`test_a_restart_starts_${style}_afresh`, () => {
    const left = survives(
      style,
      (fx) => paintRun(fx, style, LOUD_DB),
      (fx) => paintOnce(fx, style, flat(MID_DB), { restart: true }),
    );
    assert.ok(...near(left, 0, NONE_TOL));
  });
}

for (const style of DRAWN) {
  const other = style === BARS ? RIDGES : BARS;
  test(`test_a_change_of_style_back_to_${style}_starts_it_afresh`, () => {
    const left = survives(
      style,
      (fx) => {
        paintRun(fx, style, LOUD_DB);
        paintRun(fx, other, LOUD_DB);
      },
      (fx) => paintOnce(fx, style, flat(MID_DB)),
    );
    assert.ok(...near(left, 0, NONE_TOL));
  });
}

for (const style of DRAWN) {
  test(`test_a_paint_after_one_with_no_spectrum_starts_${style}_afresh`, () => {
    const left = survives(
      style,
      (fx) => paintRun(fx, style, LOUD_DB),
      (fx) => {
        paintOnce(fx, style, NO_SPECTRUM);
        paintOnce(fx, style, flat(MID_DB));
      },
    );
    assert.ok(...near(left, 0, NONE_TOL));
  });
}

/**
 * The ink left after a paint with no spectrum in `style`, as a share of the ink a few loud paints had laid.
 *
 * @param {string} style
 */
function leftAfterNoSpectrum(style) {
  const { canvas, fx } = fresh();
  paintRun(fx, style, LOUD_DB);
  const before = inkIn(shot(canvas));
  paintOnce(fx, style, NO_SPECTRUM);
  return inkIn(shot(canvas)) / before;
}

for (const style of DRAWN) {
  test(`test_a_paint_with_no_spectrum_leaves_nothing_of_${style}_on_the_canvas`, () => {
    assert.ok(...near(leftAfterNoSpectrum(style), 0, NONE_TOL));
  });
}

// ── motion on the time between paints ───────────────────────────────────

/**
 * The pictures of a run in `style`: one loud paint, then paints `dt` apart of every column under the floor, `per` of
 * them to each of MOMENTS moments; the first picture after the loud paint, then one at each moment.
 *
 * @param {string} style
 * @param {number} dt
 * @param {number} per
 */
function momentsOf(style, dt, per) {
  const { canvas, fx } = fresh();
  paintOnce(fx, style, flat(LOUD_DB));
  const shots = [shot(canvas)];
  for (let k = 0; k < MOMENTS; k++) {
    for (let i = 0; i < per; i++) paintOnce(fx, style, flat(QUIET_DB), { dt });
    shots.push(shot(canvas));
  }
  return shots;
}

/**
 * The travel between a late run and a steady run in `style` over the same moments, as a share of the travel the
 * steady run makes from its first picture to those moments.
 *
 * @param {string} style
 */
function lateAgainstSteady(style) {
  const steady = momentsOf(style, STEP_S, STEADY_PER_LATE);
  const late = momentsOf(style, LATE_S, 1);
  let apart = 0;
  let moved = 0;
  for (let k = 1; k <= MOMENTS; k++) {
    apart += travel(late[k], steady[k]);
    moved += travel(steady[0], steady[k]);
  }
  return apart / moved;
}

//: The part of each drawn style that moves with time, as the owner names it.
/** @type {Record<string, string>} */
const MOVERS = { [BARS]: "peak caps", [RIDGES]: "ridge rows", [FADE]: "halo", [FIRE]: "flames" };

for (const style of DRAWN) {
  test(`test_the_${style}_${MOVERS[style].replace(" ", "_")}_move_as_far_on_late_paints_as_on_steady_ones`, () => {
    assert.ok(...near(lateAgainstSteady(style), 0, TRAVEL_TOL));
  });
}
