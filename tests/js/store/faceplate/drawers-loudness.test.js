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
import { effective } from "../../../../hqptuner/static/store/resolve.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { loudnessSide } from "../../../../hqptuner/static/store/ui/ui.js";
import {
  dropBound,
  dropHandle,
  grabHandle,
  loudnessBar,
  moveBound,
  sideDots,
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

test("test_a_volume_below_the_axis_holds_the_needle_at_its_floor", () => {
  volume.value = "-130";
  assert.equal(loudnessBar().needle, -120);
});

test("test_a_volume_back_on_the_axis_moves_the_needle_to_it", () => {
  volume.value = "-130";
  volume.value = "-10";
  assert.equal(loudnessBar().needle, -10);
});

test("test_the_needle_returns_once_the_engine_reports_a_volume_again", () => {
  volume.value = null;
  volume.value = "-30";
  assert.equal(loudnessBar().needle, -30);
});

// --- dragging and typing a bound ----------------------------------------------

test("test_a_dropped_drag_stages_its_bound_in_whole_db", async () => {
  moveBound("low", -40.4);
  dropBound();
  await settle();
  assert.equal(effective("loudness_range_low"), "-40");
});

test("test_a_drag_marks_its_bound_active", () => {
  moveBound("high", -30);
  assert.equal(loudnessBar().active, "high");
});

// --- the Bass | Treble switch -------------------------------------------------

test("test_only_the_hidden_side_holding_an_edit_carries_a_dot", async () => {
  await edit("loudness_high_freq", "4000");
  assert.deepEqual(sideDots(), { low: false, high: true });
});

test("test_grabbing_a_plot_handle_points_the_switch_at_its_side", () => {
  grabHandle("high");
  assert.equal(loudnessSide.value, "high");
});

test("test_dropping_a_plot_handle_stages_its_whole_hertz", async () => {
  dropHandle("high", 4321.6, 3.27);
  await settle();
  assert.equal(effective("loudness_high_freq"), "4322");
});

test("test_dropping_a_plot_handle_stages_its_tenth_db", async () => {
  dropHandle("high", 4321.6, 3.27);
  await settle();
  assert.equal(effective("loudness_high_level"), "3.3");
});
