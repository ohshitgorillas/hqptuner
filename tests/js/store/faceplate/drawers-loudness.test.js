// Behavioral suite for store/faceplate/drawers/loudness.js, the Loudness drawer's store half: the range bar's marks
// (`loudnessBar`: both bounds, the playback needle and the bound being dragged), how a dragged or typed bound is
// clamped and when it stages, which side of the Bass | Treble switch carries a dot, and what a plot handle does to the
// switch and the staged band.
//
// The store is driven at the wire: the staging fake answers the real REST paths, the daemon's /matrix form fields go
// into `matrixConfig`, the engine's reported volume into `volume`. Every source signal is reset on every case.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/drawers-loudness.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { config, liveOverride, matrixConfig, volume, volumeDrag } from "../../../../hqptuner/static/store/signals.js";
import { effective, isDirty } from "../../../../hqptuner/static/store/resolve.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { loudnessSide } from "../../../../hqptuner/static/store/ui/ui.js";
import {
  dropBound,
  dropHandle,
  grabHandle,
  loudnessBar,
  moveBound,
  sideDots,
  typeBound,
} from "../../../../hqptuner/static/store/faceplate/drawers/loudness.js";
import { ok, quiesce, stagingWire } from "../../support/wire/wire.js";

/** @type {import("../../support/wire/wire.js").StagingWire} */
let wire;

beforeEach(async () => {
  wire = stagingWire({ fallback: (w) => ok(w.staged) });
  config.value = { fields: [], file: {} };
  matrixConfig.value = {
    fields: [
      { name: "enabled", value: true },
      { name: "post_loudness_enabled", value: true },
      { name: "post_loudness_rangelow", value: "-60" },
      { name: "post_loudness_rangehigh", value: "-20" },
      { name: "post_loudness_lowfreq", value: "80" },
      { name: "post_loudness_lowlevel", value: "20" },
      { name: "post_loudness_highfreq", value: "5000" },
      { name: "post_loudness_highlevel", value: "10" },
    ],
  };
  liveOverride.value = {};
  volume.value = "-40";
  volumeDrag.value = null;
  loudnessSide.value = "low";
  dropBound();
  await quiesce(wire);
  await discardAll();
});

const settle = () => quiesce(wire);

// --- the bar's marks ----------------------------------------------------------

test("test_the_bar_marks_the_staged_bounds_and_the_shown_volume", async () => {
  await edit("loudness_range_low", "-50");
  volume.value = "-35";
  const m = loudnessBar();
  assert.deepEqual([m.low, m.high, m.needle], [-50, -20, -35]);
});

test("test_the_needle_is_held_to_the_axis", () => {
  volume.value = "-130";
  const below = loudnessBar().needle;
  volume.value = "-10";
  assert.deepEqual([below, loudnessBar().needle], [-120, -10]);
});

test("test_no_needle_shows_while_the_engine_reports_no_volume", () => {
  volume.value = null;
  const none = loudnessBar().needle;
  volume.value = "-30";
  assert.deepEqual([none, loudnessBar().needle], [null, -30]);
});

// --- dragging and typing a bound ----------------------------------------------

test("test_a_dragged_bound_stops_at_the_other_and_reads_active", () => {
  moveBound("low", -5);
  const m = loudnessBar();
  assert.deepEqual([m.low, m.active], [-20, "low"]);
});

test("test_a_drag_stages_nothing_until_it_drops", async () => {
  moveBound("low", -40.4);
  const during = isDirty("loudness_range_low");
  dropBound();
  await settle();
  assert.deepEqual([during, effective("loudness_range_low")], [false, "-40"]);
});

test("test_a_dropped_drag_leaves_no_bound_active", async () => {
  moveBound("high", -30);
  const during = loudnessBar().active;
  dropBound();
  await settle();
  assert.deepEqual([during, loudnessBar().active], ["high", null]);
});

test("test_a_typed_bound_is_held_whole_and_never_past_the_other", async () => {
  typeBound("high", -70.4);
  typeBound("low", -70.6);
  await settle();
  assert.deepEqual([effective("loudness_range_high"), effective("loudness_range_low")], ["-60", "-71"]);
});

// --- the Bass | Treble switch -------------------------------------------------

test("test_only_the_hidden_side_holding_an_edit_carries_a_dot", async () => {
  await edit("loudness_high_freq", "4000");
  const hidden = sideDots();
  loudnessSide.value = "high";
  assert.deepEqual(
    [hidden, sideDots()],
    [
      { low: false, high: true },
      { low: false, high: false },
    ],
  );
});

test("test_grabbing_a_plot_handle_points_the_switch_at_its_side", () => {
  grabHandle("high");
  assert.equal(loudnessSide.value, "high");
});

test("test_dropping_a_plot_handle_stages_its_whole_hertz_and_tenth_db", async () => {
  dropHandle("high", 4321.6, 3.27);
  await settle();
  assert.deepEqual([effective("loudness_high_freq"), effective("loudness_high_level")], ["4322", "3.3"]);
});
