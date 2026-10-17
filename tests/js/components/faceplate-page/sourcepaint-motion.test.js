// Painter suite for hqptuner/static/components/faceplate/page/sourcepaint.js, the canvases and time half: which effects
// painter `paintSourceScene` hands the shown spectrum under each picked style, how its moving parts keep to the wall
// time a paint is told has passed, and what starts them afresh. Under a canvas style (bars, ridges, fade, fire) the fx
// painter is handed the shown columns in dBFS as the trace shows them, the range, the style and the suite, the time and
// whether it restarts, and the aurora painter no spectrum; under aurora the aurora painter is handed the columns, the
// range, the suite, the time and whether it restarts, and the effects canvas is cleared; under trace neither is handed a
// spectrum. The same stretch of wall time moves the bars, held marks, needles, trace and shadow the same distance in one
// paint as in many. A restart, or a change in the number of channels, starts every moving part afresh and restarts the
// effects painters. A paint with no section still paints the canvases.
//
// The section and the scenes are tests/js/support/rendered/sourcesection.js. The effects canvas is tests/js/support/raster.js
// under the real fxPainter, read by its ink. The aurora painter needs WebGL2, which node lacks, so where a case asks
// what a painter was handed it is a recorder that keeps each call's arguments and draws nothing.
//
// How far a run moves is the sum, over moments, of how far each reading stands from where the run began; two runs
// move alike when the sum of how far they stand apart at each moment is a small share of that.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/sourcepaint-motion.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { meterFloor } from "../../../../hqptuner/static/store/ui/prefs.js";
import { near } from "../../support/near.js";
import { rasterCanvas } from "../../support/raster.js";
import {
  LOUD_DB,
  MID_DB,
  QUIET_DB,
  RANGE,
  STEP_S,
  TRACE,
  apart,
  channel,
  fxCanvas,
  hold,
  holds,
  inkOf,
  level,
  lineYs,
  needles,
  paint,
  peaks,
  recorder,
  rmses,
  sceneOf,
  section,
  shadowYs,
} from "../../support/rendered/sourcesection.js";

/** @typedef {import("../../support/rendered/sourcesection.js").Reader} Reader */
/** @typedef {import("../../support/rendered/sourcesection.js").Scene} Scene */

//: A trace twice as deep as RANGE.
const WIDE_RANGE = 2 * RANGE;
//: The Levels floor, as the prefs store holds it.
const FLOOR_60 = "-60";
//: Spectrum styles, as the store holds them.
const AURORA = "aurora";
const BARS = "bars";
const RIDGES = "ridges";
const CANVAS_STYLES = [BARS, RIDGES, "fade", "fire"];
//: A color suite, as the store holds it.
const INFERNO = "inferno";
//: Two channels, at -20 and -40 dBFS, and their power average per bin: 10·log10((0.01 + 0.0001) / 2).
const PAIR_HOT_DB = -20;
const PAIR_SOFT_DB = -40;
const PAIR_AVERAGE_DB = -22.97;
//: A late paint, s, four steady paints long.
const LATE_S = 1 / 8;
const STEADY_PER_LATE = 4;
//: Moments compared along a run, one late paint apart: four seconds in all.
const MOMENTS = 32;
//: Paints of a canvas style before its canvas is read.
const WARM_S = 4 * STEP_S;
//: How far two runs over the same time may move apart, as a share of how far the steady run moves.
const TRAVEL_TOL = 0.2;
//: How much of a history may survive a fresh start: none, up to float noise.
const NONE_TOL = 1e-6;
//: How far a handed column may stand from the trace's level, dB.
const DB_TOL = 0.5;

const START = { floor: meterFloor.value };

Math.random = () => 0.5;

/** @type {{ OffscreenCanvas?: unknown }} */
const env = globalThis;
env.OffscreenCanvas = function OffscreenCanvas(/** @type {number} */ w, /** @type {number} */ h) {
  return rasterCanvas(w, h);
};

afterEach(() => {
  meterFloor.value = START.floor;
});

// ── the effects canvases ───────────────────────────────────────────────

/**
 * Whether the effects canvas holds ink after a short loud run in `style`, painted with the section `root`.
 *
 * @param {string} style
 * @param {ReturnType<typeof section> | null} root
 */
function inked(style, root) {
  const { canvas, fx } = fxCanvas();
  const painters = { fx, aurora: null };
  paint(root, level(LOUD_DB, true), STEP_S, { painters, picked: style });
  hold(root, () => level(LOUD_DB), WARM_S, { painters, picked: style });
  return inkOf(canvas) > 0;
}

for (const style of CANVAS_STYLES) {
  test(`test_the_${style}_style_draws_on_the_effects_canvas`, () => {
    assert.equal(inked(style, section(2)), true);
  });
}

test("test_with_no_section_the_canvases_still_paint", () => {
  assert.equal(inked(BARS, null), true);
});

/**
 * The ink the effects canvas holds after a second of loud bars paints and then a few in `then`, as a share of the ink
 * the bars paints had laid.
 *
 * @param {string} then
 */
function fxLeftAfter(then) {
  const { canvas, fx } = fxCanvas();
  const painters = { fx, aurora: recorder() };
  const root = section(2);
  paint(root, level(LOUD_DB, true), STEP_S, { painters, picked: BARS });
  hold(root, () => level(LOUD_DB), 1, { painters, picked: BARS });
  const before = inkOf(canvas);
  hold(root, () => level(LOUD_DB), WARM_S, { painters, picked: then });
  return inkOf(canvas) / before;
}

test("test_under_aurora_the_effects_canvas_is_cleared", () => {
  assert.ok(...near(fxLeftAfter(AURORA), 0, NONE_TOL));
});

test("test_under_trace_the_effects_canvas_is_left_clear", () => {
  assert.ok(...near(fxLeftAfter(TRACE), 0, NONE_TOL));
});

/**
 * What recording painters were handed over a restarting paint and one late paint after it, `picked` at `range` under
 * Inferno, of the pair of channels whose power average per bin is PAIR_AVERAGE_DB.
 *
 * @param {string} picked
 * @param {number} [range]
 */
function handed(picked, range = RANGE) {
  const fx = recorder();
  const aurora = recorder();
  const look = { painters: { fx, aurora }, picked, range, suite: INFERNO };
  const pair = (/** @type {boolean} */ restart) =>
    sceneOf(
      [channel(PAIR_HOT_DB, PAIR_HOT_DB, PAIR_HOT_DB), channel(PAIR_SOFT_DB, PAIR_SOFT_DB, PAIR_SOFT_DB)],
      restart,
    );
  const root = section(2);
  paint(root, pair(true), STEP_S, look);
  paint(root, pair(false), LATE_S, look);
  return { fx: fx.paints, aurora: aurora.paints };
}

/**
 * The widest distance of the last paint's columns from PAIR_AVERAGE_DB; NaN with no paint or no columns.
 *
 * @param {unknown[][]} paints
 */
function columnsOff(paints) {
  const cols = /** @type {ArrayLike<number> | null | undefined} */ (paints.at(-1)?.[0]);
  if (!cols || !cols.length) return Number.NaN;
  return Math.max(...Array.from(cols, (c) => Math.abs(c - PAIR_AVERAGE_DB)));
}

/**
 * Whether the last paint was handed no spectrum: no columns, or none in them. False with no paint at all.
 *
 * @param {unknown[][]} paints
 */
function noSpectrum(paints) {
  const last = paints.at(-1);
  if (last === undefined) return false;
  const cols = /** @type {ArrayLike<number> | null | undefined} */ (last[0]);
  return cols === null || cols === undefined || cols.length === 0;
}

test("test_under_a_canvas_style_the_fx_painter_is_handed_the_columns_as_the_trace_shows_them", () => {
  assert.ok(...near(columnsOff(handed(BARS).fx), 0, DB_TOL));
});

test("test_under_a_canvas_style_the_fx_painter_is_handed_the_range_and_the_style", () => {
  assert.deepEqual(handed(RIDGES, WIDE_RANGE).fx.at(-1)?.slice(1, 3), [WIDE_RANGE, RIDGES]);
});

test("test_under_a_canvas_style_the_fx_painter_is_handed_the_suite_the_time_and_no_restart", () => {
  assert.deepEqual(handed(BARS).fx.at(-1)?.[3], { suite: INFERNO, dt: LATE_S, restart: false });
});

test("test_under_a_canvas_style_the_aurora_painter_is_handed_no_spectrum", () => {
  assert.equal(noSpectrum(handed(BARS).aurora), true);
});

test("test_under_trace_the_aurora_painter_is_handed_no_spectrum", () => {
  assert.equal(noSpectrum(handed(TRACE).aurora), true);
});

test("test_under_aurora_the_aurora_painter_is_handed_the_columns_as_the_trace_shows_them", () => {
  assert.ok(...near(columnsOff(handed(AURORA).aurora), 0, DB_TOL));
});

test("test_under_aurora_the_aurora_painter_is_handed_the_range_and_the_suite", () => {
  assert.deepEqual(handed(AURORA, WIDE_RANGE).aurora.at(-1)?.slice(1, 3), [WIDE_RANGE, INFERNO]);
});

test("test_under_aurora_the_aurora_painter_is_handed_the_time_and_no_restart", () => {
  assert.deepEqual(handed(AURORA).aurora.at(-1)?.[3], { dt: LATE_S, restart: false });
});

// ── equal motion over equal time ───────────────────────────────────────

/**
 * The readings of a run: one loud restarting paint, then quiet paints `dt` apart, `per` of them to each of MOMENTS
 * moments; the reading after the loud paint, then one at each moment.
 *
 * @param {Reader} read
 * @param {number} dt
 * @param {number} per
 */
function momentsOf(read, dt, per) {
  meterFloor.value = FLOOR_60;
  const root = section(2);
  paint(root, level(LOUD_DB, true), STEP_S);
  const out = [read(root)];
  for (let k = 0; k < MOMENTS; k++) {
    for (let i = 0; i < per; i++) paint(root, level(QUIET_DB), dt);
    out.push(read(root));
  }
  return out;
}

/**
 * How far a late run's readings stand from a steady run's over the same moments, as a share of how far the steady run
 * moves from its first reading to those moments.
 *
 * @param {Reader} read
 */
function lateAgainstSteady(read) {
  const steadyRun = momentsOf(read, STEP_S, STEADY_PER_LATE);
  const late = momentsOf(read, LATE_S, 1);
  let off = 0;
  let moved = 0;
  for (let k = 1; k <= MOMENTS; k++) {
    off += apart(late[k], steadyRun[k]);
    moved += apart(steadyRun[0], steadyRun[k]);
  }
  return off / moved;
}

/** @type {[string, Reader][]} */
const PARTS = [
  ["peak_fills", peaks],
  ["rms_fills", rmses],
  ["held_marks", holds],
  ["needles", needles],
  ["trace_line", lineYs],
  ["shadow", shadowYs],
];

for (const [name, read] of PARTS) {
  test(`test_the_${name}_move_as_far_on_late_paints_as_on_steady_ones`, () => {
    assert.ok(...near(lateAgainstSteady(read), 0, TRAVEL_TOL));
  });
}

// ── starting afresh ────────────────────────────────────────────────────

/**
 * How much of a loud history survives a paint of `scene(restart)`: the distance of `read` from a fresh section's after
 * that scene, over that distance before it.
 *
 * @param {Reader} read
 * @param {(restart: boolean) => Scene} scene
 * @param {boolean} restart
 */
function survives(read, scene, restart) {
  meterFloor.value = FLOOR_60;
  const root = section(2);
  paint(root, level(LOUD_DB, true), STEP_S);
  hold(root, () => level(LOUD_DB), 1);
  paint(root, level(QUIET_DB), STEP_S);
  const before = read(root);
  paint(root, scene(restart), STEP_S);
  const clean = section(2);
  paint(clean, scene(true), STEP_S);
  return apart(read(root), read(clean)) / apart(before, read(clean));
}

for (const [name, read] of PARTS) {
  test(`test_a_restart_starts_the_${name}_afresh`, () => {
    assert.ok(
      ...near(
        survives(read, (r) => level(MID_DB, r), true),
        0,
        NONE_TOL,
      ),
    );
  });
}

test("test_a_change_in_the_number_of_channels_starts_the_held_marks_afresh", () => {
  const mono = (/** @type {boolean} */ r) => sceneOf([channel(MID_DB, MID_DB, MID_DB)], r);
  const first = (/** @type {ReturnType<typeof section>} */ root) => holds(root).slice(0, 1);
  assert.ok(...near(survives(first, mono, false), 0, NONE_TOL));
});

/**
 * The effects canvas after a loud bars paint, a second more of them where `history` holds, then a restarting mid paint.
 *
 * @param {boolean} history
 */
function restartedCanvas(history) {
  const { canvas, fx } = fxCanvas();
  const painters = { fx, aurora: null };
  const root = section(2);
  paint(root, level(LOUD_DB, true), STEP_S, { painters, picked: BARS });
  if (history) hold(root, () => level(LOUD_DB), 1, { painters, picked: BARS });
  paint(root, level(MID_DB, true), STEP_S, { painters, picked: BARS });
  return Float32Array.from(canvas.ink);
}

test("test_a_restart_starts_the_effects_canvas_afresh", () => {
  const fresh = restartedCanvas(false);
  const laid = fresh.reduce((a, b) => a + b, 0);
  const left = laid > 0 ? apart(restartedCanvas(true), fresh) / laid : Number.NaN;
  assert.ok(...near(left, 0, NONE_TOL));
});

test("test_a_restart_restarts_the_aurora_painter", () => {
  const aurora = recorder();
  const look = { painters: { fx: recorder(), aurora }, picked: AURORA };
  const root = section(2);
  paint(root, level(LOUD_DB, true), STEP_S, look);
  paint(root, level(LOUD_DB), STEP_S, look);
  paint(root, level(MID_DB, true), STEP_S, look);
  assert.equal(/** @type {{ restart?: boolean } | undefined} */ (aurora.paints.at(-1)?.[3])?.restart, true);
});
