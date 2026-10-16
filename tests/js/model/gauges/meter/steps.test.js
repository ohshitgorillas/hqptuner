// Behavioral suite for the Source meter page's animation steps (hqptuner/static/model/gauges/meter/steps.js): the level
// meter's peak, held peak and RMS, the spectrum's shown level and its ghost, the bars' peak caps, the aurora bands'
// gravity, the ridge rows and the Fade halo, each moved only by the paint intervals a test hands it, and the pace a
// stepped style takes whole steps by.
//
// Every step joins the same invariants: a stretch of time moves a state as far whether it
// arrives as one paint or as many; a fresh state after a break carries nothing of the music before it; a quiet input
// held long enough is where every state settles. The two holding steps also hold: a paint after their input drops still
// shows where it was.
//
// Time is a table: each paint is an interval in seconds, the intervals of one stretch differ, and nothing here reads a
// clock or waits on one. The halo step says whether a paint starts on a clear canvas and how much of the last paint's
// halo it dims away; the canvas it acts on is modeled here as the painter composes it, the old halo dimmed by that
// share under the trace the paint draws.
//
// Run: node --test tests/js/model/gauges/meter/steps.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  freshCaps,
  freshGravity,
  freshHalo,
  freshLevels,
  freshPace,
  freshRidges,
  freshSpectrum,
  ridgeRow,
  stepCaps,
  stepGravity,
  stepHalo,
  stepLevels,
  stepPace,
  stepRidges,
  stepSpectrum,
} from "../../../../../hqptuner/static/model/gauges/meter/steps.js";
import { near } from "../../../support/near.js";

//: Paint intervals, s, at and above a 30 Hz paint, changing from paint to paint.
const PAINTS = [0.0333, 0.05, 0.0417, 0.1, 0.0667, 0.0333];
//: One paint at 30 Hz, s.
const PAINT = 0.0333;
//: How long the music plays loud before it drops, s.
const LOUD_S = 5;
//: How many times over the paint table a quiet stretch runs for a state to settle.
const SETTLE_REPEAT = 100;
//: How close two ways of cutting one stretch must agree, as a ratio of the distances moved.
const SAME = 1e-9;
//: How close a settled state must sit on its input.
const SETTLED = 1e-6;
//: A loud and a quiet level, dBFS.
const LOUD_DB = -6;
const QUIET_DB = -40;
//: A loud and a quiet band, plot fractions.
const LOUD_FRAC = 0.9;
const QUIET_FRAC = 0.2;

/**
 * One step as the invariants drive it: a fresh state, a step with one input over one interval, and the one number the
 * state reads, in the input's units. `repeat` is how many times over the paint table a stretch runs so the state is
 * still moving at its end.
 *
 * @typedef {object} Driven
 * @property {string} name
 * @property {() => any} fresh
 * @property {(state: any, input: number, dt: number) => any} step
 * @property {(state: any) => number} read
 * @property {number} loud
 * @property {number} quiet
 * @property {number} repeat
 */

/**
 * @param {number} x
 * @returns {{ peak: number, rms: number }[]}
 */
const target = (x) => [{ peak: x, rms: x }];

/** @type {Pick<Driven, "fresh" | "step" | "loud" | "quiet">} */
const LEVELS = {
  fresh: () => freshLevels(1),
  step: (s, x, dt) => stepLevels(s, target(x), dt),
  loud: LOUD_DB,
  quiet: QUIET_DB,
};

/** @type {Pick<Driven, "fresh" | "step" | "loud" | "quiet">} */
const SPECTRUM = {
  fresh: () => freshSpectrum(1),
  step: (s, x, dt) => stepSpectrum(s, [x], dt),
  loud: LOUD_DB,
  quiet: QUIET_DB,
};

/**
 * The mean of the first column over the ridge rows kept.
 *
 * @param {ReturnType<typeof freshRidges>} s
 */
function ridgeMean(s) {
  let sum = 0;
  for (let k = 0; k < s.count; k++) sum += ridgeRow(s, k)[0];
  return sum / s.count;
}

/**
 * The halo with the canvas it dims: a paint the step says starts clear draws the trace at the input alone; any other
 * dims the old halo by the share the step says and draws the trace over it, so the canvas reads the brighter of the
 * two.
 *
 * @param {{ halo: ReturnType<typeof freshHalo>, canvas: number }} w
 * @param {number} x
 * @param {number} dt
 */
function paintHalo(w, x, dt) {
  const halo = stepHalo(w.halo, dt);
  return { halo, canvas: halo.clear ? x : Math.max(w.canvas * (1 - halo.dim), x) };
}

/** @type {Driven[]} */
const STEPS = [
  { name: "level_peak", ...LEVELS, read: (s) => s[0].peak, repeat: 4 },
  { name: "level_hold", ...LEVELS, read: (s) => s[0].hold, repeat: 10 },
  { name: "level_rms", ...LEVELS, read: (s) => s[0].rms, repeat: 2 },
  { name: "spectrum_shown", ...SPECTRUM, read: (s) => s.disp[0], repeat: 1 },
  { name: "spectrum_ghost", ...SPECTRUM, read: (s) => s.ghost[0], repeat: 2 },
  {
    name: "bar_caps",
    fresh: () => freshCaps(1),
    step: (s, x, dt) => stepCaps(s, [x], dt),
    read: (s) => s.lvl[0],
    loud: LOUD_FRAC,
    quiet: QUIET_FRAC,
    repeat: 3,
  },
  {
    name: "aurora_gravity",
    fresh: () => freshGravity(1),
    step: (s, x, dt) => stepGravity(s, [x], dt),
    read: (s) => s.lvl[0],
    loud: LOUD_FRAC,
    quiet: QUIET_FRAC,
    repeat: 2,
  },
  {
    name: "ridges",
    fresh: () => freshRidges(1),
    step: (s, x, dt) => stepRidges(s, [x], dt),
    read: ridgeMean,
    loud: LOUD_FRAC,
    quiet: QUIET_FRAC,
    repeat: 3,
  },
  {
    name: "fade_halo",
    fresh: () => ({ halo: freshHalo(), canvas: 0 }),
    step: paintHalo,
    read: (w) => w.canvas,
    loud: LOUD_FRAC,
    quiet: QUIET_FRAC,
    repeat: 2,
  },
];

//: The steps that hold a peak before it falls.
const HOLDING = new Set(["level_hold", "bar_caps"]);

/**
 * The paint table run `repeat` times over.
 *
 * @param {number} repeat
 * @returns {number[]}
 */
const stretch = (repeat) => Array.from({ length: repeat }, () => PAINTS).flat();

/**
 * @param {number[]} dts
 * @returns {number}
 */
const total = (dts) => dts.reduce((sum, dt) => sum + dt, 0);

/**
 * A state that has heard the loud input for LOUD_S.
 *
 * @param {Driven} d
 */
const afterLoud = (d) => d.step(d.fresh(), d.loud, LOUD_S);

/**
 * How far a state that heard the loud input moves over the quiet paints `dts`.
 *
 * @param {Driven} d
 * @param {number[]} dts
 */
function moved(d, dts) {
  const from = d.read(afterLoud(d));
  return from - d.read(dts.reduce((s, dt) => d.step(s, d.quiet, dt), afterLoud(d)));
}

for (const d of STEPS) {
  test(`test_${d.name}_moves_as_far_over_a_stretch_whether_it_comes_as_one_paint_or_many`, () => {
    const paints = stretch(d.repeat);
    assert.ok(...near(moved(d, paints) / moved(d, [total(paints)]), 1, SAME));
  });

  test(`test_${d.name}_settles_on_a_quiet_input_held_long_enough`, () => {
    const settled = stretch(SETTLE_REPEAT).reduce((s, dt) => d.step(s, d.quiet, dt), afterLoud(d));
    assert.ok(...near(d.read(settled), d.quiet, SETTLED));
  });

  test(`test_${d.name}_fresh_after_a_break_shows_nothing_of_the_music_before_it`, () => {
    const old = afterLoud(d);
    const restarted = d.read(d.step(d.fresh(), d.quiet, PAINT));
    const carried = d.read(d.step(old, d.quiet, PAINT));
    assert.ok(restarted < carried, `fresh ${restarted} should read below carried ${carried}`);
  });
}

for (const d of STEPS.filter((s) => HOLDING.has(s.name))) {
  test(`test_${d.name}_still_shows_the_loud_input_a_paint_after_it_drops`, () => {
    assert.equal(d.read(d.step(afterLoud(d), d.quiet, PAINT)), d.loud);
  });
}

test("test_a_pace_hands_out_as_many_whole_steps_over_a_stretch_whether_it_comes_as_one_paint_or_many", () => {
  const paints = stretch(3);
  const one = freshPace();
  const many = freshPace();
  const whole = stepPace(one, total(paints));
  const summed = paints.reduce((sum, dt) => sum + stepPace(many, dt), 0);
  assert.ok(...near(summed / whole, 1, SAME));
});
