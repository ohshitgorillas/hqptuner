// Behavioral suite for the page spectrum's per-frame style decisions (hqptuner/static/model/gauges/spectrumfx.js):
// dBFS to plot fractions, columns to bands, falling peak caps, soft bars, gravity bars and ridge rows,
// and the style a page draws when the picked one needs WebGL2 it lacks. Every height is a fraction of the plot, 0 on the
// floor and 1 at full scale.
//
// Run: node --test tests/js/model/gauges/spectrumfx.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  BANDS,
  CAP_GRAVITY,
  CAP_HOLD_S,
  GRAVITY,
  RIDGE_EVERY,
  RIDGE_ROWS,
  SPILL,
  bandsOf,
  effectiveStyle,
  fractionsOf,
  softBars,
  stepCaps,
  stepGravity,
  stepRidges,
} from "../../../../hqptuner/static/model/gauges/spectrumfx.js";
import { near } from "../../support/near.js";

//: A 60 dB plot.
const RANGE = 60;
//: The meter loop's column count.
const COLUMNS = 600;
//: A step length float32 holds exactly, so sums of steps compare exactly.
const DT = 0.125;
//: Tolerance for float32 rounding in the last place.
const EPS = 1e-6;
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

test("test_the_floor_and_full_scale_map_to_zero_and_one", () => {
  assert.deepEqual(list(fractionsOf(f32(-RANGE, 0), RANGE)), [0, 1]);
});

test("test_a_level_maps_to_its_share_of_the_range", () => {
  assert.equal(fractionsOf(f32(-RANGE / 4), RANGE)[0], 0.75);
});

test("test_the_same_level_sits_lower_on_a_narrower_range", () => {
  assert.equal(fractionsOf(f32(-RANGE / 4), RANGE / 2)[0], 0.5);
});

test("test_a_level_above_full_scale_clamps_to_one", () => {
  assert.equal(fractionsOf(f32(HOT_DB), RANGE)[0], 1);
});

test("test_a_level_below_the_range_clamps_to_zero", () => {
  assert.deepEqual(list(fractionsOf(f32(-5 * RANGE, -RANGE / 4), RANGE)), [0, 0.75]);
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

test("test_a_fresh_cap_has_aged_one_step_after_its_next_step", () => {
  const fresh = stepCaps(null, f32(HIGH), DT);
  assert.equal(stepCaps(fresh, f32(LOW), DT).age[0], DT);
});

test("test_a_band_above_its_cap_lifts_the_cap", () => {
  const prev = { lvl: f32(HIGH), age: f32(CAP_HOLD_S) };
  assert.equal(stepCaps(prev, f32(RISEN), DT).lvl[0], RISEN);
});

test("test_a_band_touching_its_cap_restarts_the_hold", () => {
  const touched = stepCaps({ lvl: f32(HIGH), age: f32(CAP_HOLD_S) }, f32(HIGH), DT);
  assert.equal(stepCaps(touched, f32(LOW), DT).age[0], DT);
});

test("test_a_cap_inside_its_hold_stays_put", () => {
  // The step leaves the cap half a step short of the hold.
  const prev = { lvl: f32(HIGH), age: f32(CAP_HOLD_S - DT - DT / 2) };
  assert.equal(stepCaps(prev, f32(LOW), DT).lvl[0], HIGH);
});

test("test_a_cap_past_its_hold_falls_by_gravity_times_its_overrun_times_the_step", () => {
  // The step takes the cap's age one DT past the hold.
  const prev = { lvl: f32(HIGH), age: f32(CAP_HOLD_S) };
  assert.ok(...near(stepCaps(prev, f32(0), DT).lvl[0], HIGH - CAP_GRAVITY * DT * DT, EPS));
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

// ── softBars ─────────────────────────────────────────────────────────────

test("test_a_lone_band_spills_onto_its_neighbour_shrunk_by_the_spill", () => {
  assert.ok(...near(softBars(f32(0, 0, 0, 1, 0, 0, 0))[2], 1 / SPILL, EPS));
});

test("test_a_lone_band_spills_two_steps_out_shrunk_twice", () => {
  assert.ok(...near(softBars(f32(0, 0, 0, 1, 0, 0, 0))[1], 1 / SPILL ** 2, EPS));
});

test("test_a_band_above_its_neighbours_spill_keeps_its_own_value", () => {
  const bands = f32(1, 0.9);
  assert.equal(softBars(bands)[1], bands[1]);
});

test("test_overlapping_spills_take_the_larger_not_the_sum", () => {
  // Index 1 takes HIGH spilled one step and 1 spilled two steps; the second is larger.
  assert.ok(...near(softBars(f32(HIGH, 0, 0, 1))[1], 1 / SPILL ** 2, EPS));
});

// ── stepGravity ──────────────────────────────────────────────────────────

test("test_gravity_bars_without_a_prior_state_sit_on_their_bands", () => {
  assert.deepEqual(list(stepGravity(null, f32(HIGH, LOW), DT).lvl), [HIGH, LOW]);
});

test("test_gravity_bars_from_a_state_of_another_length_sit_on_their_bands", () => {
  const prev = { lvl: f32(RISEN), v: f32(0) };
  assert.deepEqual(list(stepGravity(prev, f32(HIGH, LOW), DT).lvl), [HIGH, LOW]);
});

test("test_a_fresh_gravity_bar_falls_from_rest", () => {
  const fresh = stepGravity(null, f32(HIGH), DT);
  assert.equal(stepGravity(fresh, f32(0), DT).v[0], GRAVITY * DT);
});

test("test_a_falling_bar_gains_gravity_times_the_step_in_speed", () => {
  const prev = { lvl: f32(HIGH), v: f32(FALLING_V) };
  assert.equal(stepGravity(prev, f32(0), DT).v[0], FALLING_V + GRAVITY * DT);
});

test("test_a_falling_bar_drops_by_its_new_speed_times_the_step", () => {
  const prev = { lvl: f32(HIGH), v: f32(FALLING_V) };
  assert.equal(stepGravity(prev, f32(0), DT).lvl[0], HIGH - (FALLING_V + GRAVITY * DT) * DT);
});

test("test_a_band_above_its_gravity_bar_lifts_the_bar", () => {
  const prev = { lvl: f32(HIGH), v: f32(FALLING_V) };
  assert.equal(stepGravity(prev, f32(RISEN), DT).lvl[0], RISEN);
});

test("test_a_band_touching_its_gravity_bar_stops_the_fall", () => {
  const touched = stepGravity({ lvl: f32(HIGH), v: f32(FALLING_V) }, f32(HIGH), DT);
  assert.equal(stepGravity(touched, f32(0), DT).v[0], GRAVITY * DT);
});

test("test_a_falling_gravity_bar_never_drops_below_its_band", () => {
  const prev = { lvl: f32(HIGH), v: f32(100 * FALLING_V) };
  assert.equal(stepGravity(prev, f32(LOW), DT).lvl[0], LOW);
});

// ── stepRidges ───────────────────────────────────────────────────────────

test("test_ridges_without_a_prior_state_hold_the_first_row", () => {
  assert.deepEqual(stepRidges(null, f32(HIGH, LOW)).rows.map(list), [[HIGH, LOW]]);
});

test("test_ridges_without_a_prior_state_start_at_tick_one", () => {
  assert.equal(stepRidges(null, f32(HIGH)).tick, 1);
});

test("test_each_ridge_step_advances_the_tick", () => {
  assert.equal(drive(3).tick, 3);
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
