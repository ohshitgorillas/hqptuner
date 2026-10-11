// Behavioral suite for the page spectrum's per-frame style decisions (hqptuner/static/model/gauges/spectrumfx.js):
// dBFS to plot fractions, columns to bands, falling peak caps, gravity bars and ridge rows, how strongly the Fade
// style's halo glows where the trace has been, and the style a page draws when the picked one needs WebGL2 it lacks.
// Every height is a fraction of the plot, 0 on the floor and 1 at full scale.
//
// The halo's strength is read off the module namespace with optional access, so a module without it fails the halo
// cases on their assertions.
//
// Run: node --test tests/js/model/gauges/spectrumfx.test.js

import test from "node:test";
import assert from "node:assert/strict";

import * as gauges from "../../../../hqptuner/static/model/gauges/spectrumfx.js";
import {
  BANDS,
  CAP_HOLD_S,
  RIDGE_EVERY,
  RIDGE_ROWS,
  bandsOf,
  effectiveStyle,
  fractionsOf,
  stepCaps,
  stepGravity,
  stepRidges,
} from "../../../../hqptuner/static/model/gauges/spectrumfx.js";

//: A 60 dB plot.
const RANGE = 60;
//: The meter loop's column count.
const COLUMNS = 600;
//: A step length float32 holds exactly, so sums of steps compare exactly.
const DT = 0.125;
//: A level above full scale.
const HOT_DB = 6;
//: A cap or bar height the tests start from.
const HIGH = 0.5;
//: A band below `HIGH`.
const LOW = 0.25;
//: A band above `HIGH`.
const RISEN = 0.75;
//: A falling bar's speed before the step, in fractions per second.
const FALLING_V = 1;
//: One frame of a 60 Hz display, in seconds.
const FRAME = 1 / 60;
//: One step of an 8-bit canvas channel: a glow weaker than this shows nothing.
const INVISIBLE = 1 / 255;
//: How long ago the trace left a spot whose glow has faded to nothing, in seconds.
const GONE_S = 1.2;

/**
 * The halo's surface on the gauges module: the strength of the glow, as a share of the trace's, at a spot the trace
 * left `age` seconds ago.
 *
 * @type {{ BANDS: number, haloStrength?: (age: number) => number }}
 */
const halo = gauges;

/**
 * @param {number[]} xs
 * @returns {Float32Array}
 */
const f32 = (...xs) => Float32Array.from(xs);

/**
 * @param {ArrayLike<number>} xs
 * @returns {number[]}
 */
const list = (xs) => Array.from(xs);

/**
 * The ridge state after `calls` steps from none, call `k` handing in a one-column row holding `k`.
 *
 * @param {number} calls
 * @returns {{ rows: Float32Array[], tick: number }}
 */
function drive(calls) {
  let state = stepRidges(null, f32(0));
  for (let k = 1; k < calls; k += 1) state = stepRidges(state, f32(k));
  return state;
}

// ── fractionsOf ──────────────────────────────────────────────────────────

test("test_a_level_maps_to_its_share_of_the_range", () => {
  assert.equal(fractionsOf(f32(-RANGE / 4), RANGE)[0], 0.75);
});

test("test_the_same_level_sits_lower_on_a_narrower_range", () => {
  assert.equal(fractionsOf(f32(-RANGE / 4), RANGE / 2)[0], 0.5);
});

test("test_a_level_above_full_scale_clamps_to_one", () => {
  assert.equal(fractionsOf(f32(HOT_DB), RANGE)[0], 1);
});

// ── bandsOf ──────────────────────────────────────────────────────────────

test("test_a_band_holds_the_largest_value_in_its_span", () => {
  assert.deepEqual(list(bandsOf(f32(0.25, 0.5, 0.75, 0.125), 2)), [0.5, 0.75]);
});

test("test_an_uneven_split_floors_each_band_edge", () => {
  assert.deepEqual(list(bandsOf(f32(LOW, LOW, 1, LOW, LOW), 2)), [LOW, 1]);
});

test("test_the_last_band_reaches_the_last_column", () => {
  const fracs = new Float32Array(COLUMNS).fill(LOW);
  fracs[COLUMNS - 1] = 1;
  assert.equal(bandsOf(fracs, BANDS)[BANDS - 1], 1);
});

// ── stepCaps ─────────────────────────────────────────────────────────────

test("test_caps_without_a_prior_state_sit_on_their_bands", () => {
  assert.deepEqual(list(stepCaps(null, f32(HIGH, LOW), DT).lvl), [HIGH, LOW]);
});

test("test_caps_from_a_state_of_another_length_sit_on_their_bands", () => {
  const prev = { lvl: f32(RISEN), age: f32(0) };
  assert.deepEqual(list(stepCaps(prev, f32(HIGH, LOW), DT).lvl), [HIGH, LOW]);
});

test("test_a_band_above_its_cap_lifts_the_cap", () => {
  const prev = { lvl: f32(HIGH), age: f32(CAP_HOLD_S) };
  assert.equal(stepCaps(prev, f32(RISEN), DT).lvl[0], RISEN);
});

test("test_a_cap_inside_its_hold_stays_put", () => {
  // The step leaves the cap half a step short of the hold.
  const prev = { lvl: f32(HIGH), age: f32(CAP_HOLD_S - DT - DT / 2) };
  assert.equal(stepCaps(prev, f32(LOW), DT).lvl[0], HIGH);
});

test("test_a_falling_cap_drops_further_on_its_second_step_than_its_first", () => {
  const first = stepCaps({ lvl: f32(HIGH), age: f32(CAP_HOLD_S) }, f32(0), DT);
  const second = stepCaps(first, f32(0), DT);
  const firstDrop = HIGH - first.lvl[0];
  const secondDrop = first.lvl[0] - second.lvl[0];
  assert.ok(secondDrop > firstDrop, `second drop ${secondDrop} not larger than first ${firstDrop}`);
});

test("test_a_falling_cap_never_drops_below_its_band", () => {
  const prev = { lvl: f32(HIGH), age: f32(20 * CAP_HOLD_S) };
  assert.equal(stepCaps(prev, f32(LOW), DT).lvl[0], LOW);
});

// ── stepGravity ──────────────────────────────────────────────────────────

test("test_gravity_bars_without_a_prior_state_sit_on_their_bands", () => {
  assert.deepEqual(list(stepGravity(null, f32(HIGH, LOW), DT).lvl), [HIGH, LOW]);
});

test("test_gravity_bars_from_a_state_of_another_length_sit_on_their_bands", () => {
  const prev = { lvl: f32(RISEN), v: f32(0) };
  assert.deepEqual(list(stepGravity(prev, f32(HIGH, LOW), DT).lvl), [HIGH, LOW]);
});

test("test_a_band_above_its_gravity_bar_lifts_the_bar", () => {
  const prev = { lvl: f32(HIGH), v: f32(FALLING_V) };
  assert.equal(stepGravity(prev, f32(RISEN), DT).lvl[0], RISEN);
});

test("test_a_falling_gravity_bar_never_drops_below_its_band", () => {
  const prev = { lvl: f32(HIGH), v: f32(100 * FALLING_V) };
  assert.equal(stepGravity(prev, f32(LOW), DT).lvl[0], LOW);
});

// ── stepRidges ───────────────────────────────────────────────────────────

test("test_ridges_without_a_prior_state_hold_the_first_row", () => {
  assert.deepEqual(stepRidges(null, f32(HIGH, LOW)).rows.map(list), [[HIGH, LOW]]);
});

test("test_the_first_ridge_row_is_a_copy_of_the_input", () => {
  const row = f32(HIGH);
  const state = stepRidges(null, row);
  row[0] = LOW;
  assert.equal(state.rows[0][0], HIGH);
});

test("test_no_ridge_row_is_pushed_until_the_tick_reaches_the_cadence", () => {
  assert.equal(drive(RIDGE_EVERY).rows.length, 1);
});

test("test_a_ridge_row_is_pushed_when_the_prior_tick_reaches_the_cadence", () => {
  assert.equal(drive(RIDGE_EVERY + 1).rows.length, 2);
});

test("test_a_pushed_ridge_row_goes_first", () => {
  assert.equal(drive(RIDGE_EVERY + 1).rows[0][0], RIDGE_EVERY);
});

test("test_a_pushed_ridge_row_is_a_copy_of_the_input", () => {
  const row = f32(HIGH);
  const state = stepRidges(drive(RIDGE_EVERY), row);
  row[0] = LOW;
  assert.equal(state.rows[0][0], HIGH);
});

test("test_a_ridge_push_leaves_the_prior_state_rows_alone", () => {
  const prev = drive(RIDGE_EVERY);
  stepRidges(prev, f32(HIGH));
  assert.equal(prev.rows.length, 1);
});

test("test_ridge_rows_never_exceed_the_ridge_count", () => {
  assert.equal(drive((RIDGE_ROWS + 1) * RIDGE_EVERY + 1).rows.length, RIDGE_ROWS);
});

test("test_a_full_ridge_stack_drops_its_oldest_rows", () => {
  // Rows 0, E, … (ROWS + 1)·E were pushed; the two oldest fell off, so 2·E is the last kept.
  assert.equal(drive((RIDGE_ROWS + 1) * RIDGE_EVERY + 1).rows[RIDGE_ROWS - 1][0], 2 * RIDGE_EVERY);
});

// ── effectiveStyle ───────────────────────────────────────────────────────

test("test_aurora_without_webgl2_falls_back_to_the_trace", () => {
  assert.equal(effectiveStyle("aurora", false), "trace");
});

test("test_aurora_with_webgl2_stays_aurora", () => {
  assert.equal(effectiveStyle("aurora", true), "aurora");
});

for (const style of ["bars", "ridges"]) {
  test(`test_${style}_without_webgl2_stays_${style}`, () => {
    assert.equal(effectiveStyle(style, false), style);
  });
}

// ── haloStrength ─────────────────────────────────────────────────────────

test("test_a_spot_the_trace_has_just_left_glows_at_half_the_trace_strength", () => {
  assert.equal(halo.haloStrength?.(0), 0.5);
});

for (const age of [0, GONE_S / 4, GONE_S / 2, (3 * GONE_S) / 4]) {
  test(`test_a_halo_${Math.round(age * 1000)}_ms_old_is_dimmer_one_frame_later`, () => {
    const now = halo.haloStrength?.(age) ?? Number.NaN;
    const later = halo.haloStrength?.(age + FRAME) ?? Number.NaN;
    assert.ok(later < now, `strength ${later} one frame after ${age} s is not below ${now}`);
  });
}

test("test_a_spot_the_trace_left_half_the_fade_ago_still_glows", () => {
  const strength = halo.haloStrength?.(GONE_S / 2) ?? Number.NaN;
  assert.ok(strength >= INVISIBLE, `strength ${strength} at ${GONE_S / 2} s is below one 8-bit step`);
});

test("test_a_spot_the_trace_left_1_2_s_ago_has_faded_to_nothing_visible", () => {
  const strength = halo.haloStrength?.(GONE_S) ?? Number.NaN;
  assert.ok(strength < INVISIBLE, `strength ${strength} at ${GONE_S} s is not below one 8-bit step`);
});

// ── stepHalo ─────────────────────────────────────────────────────────────

//: Frames a halo is dimmed for before its glow is compared, half a second at 60 Hz.
const DIMMED_FRAMES = 30;
//: How far two floating-point strengths may differ and still be the same.
const EPS = 1e-9;

/**
 * The painter's surface on the gauges module: the halo after a reset, and the halo after a paint `dt` seconds after
 * the last, with the share of the canvas that paint dims.
 *
 * @type {{
 *   HALO_FRESH?: { drawn: boolean, dim: number },
 *   stepHalo?: (prev: { drawn: boolean, dim: number }, dt: number) => { drawn: boolean, dim: number },
 * }}
 */
const painter = gauges;

/**
 * The glow left on a spot the first paint after a reset stroked, after `frames` more paints a frame apart, each dimming
 * it by the share its step returns.
 *
 * @param {number} frames
 * @returns {number}
 */
function dimmedGlow(frames) {
  const { HALO_FRESH: fresh, stepHalo: step } = painter;
  if (!fresh || !step) return Number.NaN;
  let state = step(fresh, FRAME);
  let glow = halo.haloStrength?.(0) ?? Number.NaN;
  for (let k = 0; k < frames; k += 1) {
    state = step(state, FRAME);
    glow *= 1 - state.dim;
  }
  return glow;
}

test("test_the_first_paint_after_a_reset_dims_nothing", () => {
  const fresh = painter.HALO_FRESH;
  const dim = fresh ? painter.stepHalo?.(fresh, FRAME).dim : Number.NaN;
  assert.equal(dim, 0);
});

test("test_a_halo_dimmed_frame_by_frame_glows_as_its_age_says", () => {
  const glow = dimmedGlow(DIMMED_FRAMES);
  const law = halo.haloStrength?.(DIMMED_FRAMES * FRAME) ?? Number.NaN;
  assert.ok(Math.abs(glow - law) < EPS, `glow ${glow} after ${DIMMED_FRAMES} frames is not the law's ${law}`);
});
