// Behavioral suite for store/matrix/loudness.js's `loudnessApplied`: the whole
// percent of the maximum loudness shelving the engine applies at the volume the
// page shows, from the loudness range the engine is running.
//
// The contract has two halves. The percent follows the shown volume across the
// running range: the volume under a dragged knob, never a range bound or a
// switch the user has edited but not applied. And it is nothing while loudness
// cannot reach the output: a bypassed matrix engine, loudness switched off, or a
// pinned volume each take the whole of it away.
//
// The wire is the seam: every case writes the daemon's own /config and /matrix
// form fields into `config` and `matrixConfig`, the engine's reported volume
// into `volume`, and a knob drag into `volumeDrag` or `liveOverride`, all
// exported store signals. Every source signal is reset on every case.
//
// The gate cases assert the drop from an open gate to a shut one, so the
// expected value is never the zero an absent feature would also return.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/loudness-applied.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  config,
  matrixConfig,
  volume,
  volumeDrag,
  liveOverride,
  staged,
} from "../../../hqptuner/static/store/signals.js";
import { loudnessApplied } from "../../../hqptuner/static/store/matrix/loudness.js";

/**
 * @typedef {{ matrix?: boolean, loudness?: boolean, fixedVolume?: boolean, low?: string, high?: string,
 *             at?: string, drag?: number | null, override?: Record<string, unknown> }} Running
 */

// A running chain with loudness audible: matrix engaged, loudness on, an
// adjustable -60..0 dB volume, the loudness range -60..-20 dB, the volume at -40.
/**
 * The applied percent for one running state.
 *
 * @param {Running} running
 * @returns {number}
 */
function appliedWith({
  matrix = true,
  loudness = true,
  fixedVolume = false,
  low = "-60",
  high = "-20",
  at = "-40",
  drag = null,
  override = {},
} = {}) {
  config.value = {
    fields: [
      { name: "fixed_volume_enabled", value: fixedVolume },
      { name: "volume_fixed", value: false },
      { name: "volume_min", value: "-60" },
      { name: "volume_max", value: "0" },
    ],
  };
  matrixConfig.value = {
    fields: [
      { name: "enabled", value: matrix },
      { name: "post_loudness_enabled", value: loudness },
      { name: "post_loudness_rangelow", value: low },
      { name: "post_loudness_rangehigh", value: high },
    ],
  };
  staged.value = { live: {}, http: {} };
  liveOverride.value = override;
  volume.value = at;
  volumeDrag.value = drag;
  return loudnessApplied();
}

// --- the percent follows the shown volume across the running range ---------------

test("test_a_volume_halfway_down_the_range_applies_half_the_shelving", () => {
  assert.equal(appliedWith({ at: "-40" }), 50);
});

test("test_a_volume_three_quarters_down_the_range_applies_three_quarters", () => {
  assert.equal(appliedWith({ at: "-50" }), 75);
});

test("test_a_dragged_volume_knob_moves_the_percent_before_the_engine_reports", () => {
  assert.equal(appliedWith({ at: "-40", drag: -30 }), 25);
});

test("test_a_range_bound_being_dragged_does_not_move_the_percent", () => {
  assert.equal(appliedWith({ override: { loudness_range_high: "0" } }), 50);
});

test("test_loudness_switched_off_but_not_applied_does_not_move_the_percent", () => {
  assert.equal(appliedWith({ override: { loudness_enabled: false } }), 50);
});

// --- nothing while loudness cannot reach the output ----------------------------------

test("test_a_bypassed_matrix_engine_takes_the_whole_percent_away", () => {
  assert.equal(appliedWith() - appliedWith({ matrix: false }), 50);
});

test("test_loudness_switched_off_takes_the_whole_percent_away", () => {
  assert.equal(appliedWith() - appliedWith({ loudness: false }), 50);
});

test("test_a_pinned_volume_takes_the_whole_percent_away", () => {
  assert.equal(appliedWith() - appliedWith({ fixedVolume: true }), 50);
});
