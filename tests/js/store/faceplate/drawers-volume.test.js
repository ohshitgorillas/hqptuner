// Behavioral suite for hqptuner/static/store/faceplate/drawers/volume.js, the Volume drawer's store half: the Fixed
// volume line picked (Off, Manual or Auto) and what a pick stages, and the Range block's view (Min, Startup and Max,
// their gray and dirty state, the loudness bounds shown for reference and the live playback needle) with the move a
// handle makes.
//
// The store is driven at the wire: a staging fake answers the real REST paths (tests/js/support/wire/wire.js), the
// daemon's /config and /matrix form fields (and the config file's values) are assigned into `config` and
// `matrixConfig`, the engine's reported level and VolumeRange into `volume` and `volumeRange`. Every source signal is
// reset on every case.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/drawers-volume.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { config, matrixConfig, volume, volumeDrag, volumeRange } from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import {
  fixedMode,
  moveVolumeHandle,
  pickFixedMode,
  volumeRangeNow,
} from "../../../../hqptuner/static/store/faceplate/drawers/volume.js";
import { quiesce, stagingWire } from "../../support/wire/wire.js";

/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */

/**
 * @typedef {object} Running
 * @property {boolean} [fixed]     running fixed_volume_enabled
 * @property {string} [iso]        running volume_fixed (Auto headroom), 0 | 1 | 2
 * @property {string} [min]        running volume_min
 * @property {string} [startup]    running defaults_volume
 * @property {string} [max]        running volume_max
 * @property {boolean} [loudness]  running matrix engine and loudness both
 * @property {string} [at]         the engine's reported level, dB
 * @property {Record<string, string>} [report]  VolumeRange as the engine reports it
 */

/** Fixed volume off, a −60…0 dB range starting at −20 dB, the engine reporting the control at −12.5 dB. */
const BASE = {
  fixed: false,
  iso: "0",
  min: "-60",
  startup: "-20",
  max: "0",
  loudness: false,
  at: "-12.5",
  report: { enabled: "1", min: "-60", max: "0" },
};

/** The engine holding the control: it reports a range of its own, not the configured one. */
const HELD = { enabled: "0", min: "-12", max: "0" };

/** @type {StagingWire} */
let wire;

/** @param {Running} r */
function load(r = {}) {
  const s = { ...BASE, ...r };
  config.value = {
    fields: [
      { name: "fixed_volume_enabled", value: s.fixed },
      { name: "fixed_volume", value: "-10" },
      { name: "volume_fixed", value: s.iso !== "0" },
      { name: "direct_sdm", value: false },
      { name: "volume_min", value: s.min },
      { name: "volume_max", value: s.max },
      { name: "defaults_volume", value: s.startup },
    ],
    file: { volume_fixed: s.iso, fixed_volume: "-10" },
  };
  matrixConfig.value = {
    fields: [
      { name: "enabled", value: s.loudness },
      { name: "post_loudness_enabled", value: s.loudness },
      { name: "post_loudness_rangelow", value: "-45" },
      { name: "post_loudness_rangehigh", value: "-15" },
    ],
  };
  volume.value = s.at;
  volumeDrag.value = null;
  volumeRange.value = s.report;
}

beforeEach(async () => {
  wire = stagingWire();
  load();
  await discardAll();
});

/**
 * The Fixed volume line for one running state.
 *
 * @param {Running} r
 */
const modeWith = (r) => (load(r), fixedMode());

/**
 * What a pick stages from one running state, as the pending buffer's http lane.
 *
 * @param {Running} r
 * @param {string} v
 */
async function pickFrom(r, v) {
  load(r);
  await pickFixedMode(v);
  await quiesce(wire);
  return wire.staged.http;
}

/**
 * How many stage requests a pick sends from one running state.
 *
 * @param {Running} r
 * @param {string} v
 */
async function stagesFor(r, v) {
  wire = stagingWire();
  load(r);
  await pickFixedMode(v);
  await quiesce(wire);
  return wire.stages.length;
}

/**
 * The range view for one running state.
 *
 * @param {Running} r
 */
const rangeWith = (r) => (load(r), volumeRangeNow());

/**
 * What a handle move stages, as the pending buffer's http lane.
 *
 * @param {"min" | "startup" | "max"} k
 * @param {number} v
 */
async function moved(k, v) {
  moveVolumeHandle(k, v);
  await quiesce(wire);
  return wire.staged.http;
}

// --- the Fixed volume line ---------------------------------------------------------------------------------------

test("test_fixed_mode_reads_off_manual_or_auto_from_the_running_config", () => {
  assert.deepEqual([modeWith({}), modeWith({ fixed: true }), modeWith({ iso: "2" })], ["off", "manual", "auto"]);
});

test("test_auto_headroom_wins_over_the_fixed_level", () => {
  assert.equal(modeWith({ fixed: true, iso: "1" }), "auto");
});

test("test_fixed_mode_follows_a_staged_edit", async () => {
  const before = fixedMode();
  await edit("optimal_iso", "2");
  assert.deepEqual([before, fixedMode()], ["off", "auto"]);
});

// --- a pick ------------------------------------------------------------------------------------------------------

test("test_picking_manual_stages_the_fixed_level_on_and_auto_headroom_off", async () => {
  assert.deepEqual(await pickFrom({ iso: "1" }, "manual"), { fixed_volume_enabled: "1", volume_fixed: "0" });
});

test("test_picking_auto_stages_minus_three_and_the_fixed_level_off", async () => {
  assert.deepEqual(await pickFrom({ fixed: true }, "auto"), { volume_fixed: "1", fixed_volume_enabled: "0" });
});

test("test_picking_auto_again_restores_the_running_headroom", async () => {
  load({ iso: "2" });
  await pickFixedMode("off");
  await pickFixedMode("auto");
  await quiesce(wire);
  assert.equal(wire.stages.at(-1)?.http?.volume_fixed, "2");
});

test("test_picking_off_from_manual_stages_the_fixed_level_off", async () => {
  assert.deepEqual(await pickFrom({ fixed: true }, "off"), { fixed_volume_enabled: "0" });
});

test("test_picking_off_from_auto_stages_auto_headroom_off", async () => {
  assert.deepEqual(await pickFrom({ iso: "1" }, "off"), { volume_fixed: "0" });
});

test("test_a_pick_moves_the_line_picked", async () => {
  load({});
  await pickFixedMode("manual");
  assert.equal(fixedMode(), "manual");
});

test("test_picking_the_line_already_picked_stages_nothing", async () => {
  const counts = [await stagesFor({ fixed: true }, "manual"), await stagesFor({ fixed: true }, "off")];
  assert.deepEqual(counts, [0, 1]);
});

// --- the Range block ---------------------------------------------------------------------------------------------

test("test_the_range_is_the_effective_min_startup_and_max", async () => {
  load({ min: "-70", startup: "-25", max: "-3" });
  await edit("startup_volume", "-30");
  assert.deepEqual(volumeRangeNow().cur, { min: -70, startup: -30, max: -3 });
});

test("test_an_absent_startup_sits_at_min", () => {
  assert.equal(rangeWith({ min: "-70", startup: "" }).cur.startup, -70);
});

test("test_the_range_grays_while_fixed_volume_or_auto_headroom_is_on", () => {
  const grayed = (/** @type {Running} */ r) => rangeWith(r).gray !== "";
  assert.deepEqual([grayed({}), grayed({ fixed: true }), grayed({ iso: "1" })], [false, true, true]);
});

test("test_a_staged_handle_reads_dirty_and_the_others_do_not", async () => {
  await edit("volume_max", "-6");
  assert.deepEqual(volumeRangeNow().dirty, { min: false, startup: false, max: true });
});

test("test_the_loudness_bounds_show_while_matrix_and_loudness_run", () => {
  assert.deepEqual([rangeWith({ loudness: true }).loud, rangeWith({}).loud], [{ low: -45, high: -15 }, null]);
});

test("test_the_needle_follows_the_live_level_while_the_engine_reports_the_control", () => {
  assert.deepEqual([rangeWith({}).level, rangeWith({ report: HELD }).level], [-12.5, null]);
});

test("test_a_knob_drag_in_flight_moves_the_needle", () => {
  load({});
  volumeDrag.value = -30;
  assert.equal(volumeRangeNow().level, -30);
});

// --- a handle move -----------------------------------------------------------------------------------------------

test("test_a_handle_moved_past_its_neighbour_stops_against_it", async () => {
  assert.equal((await moved("min", -10)).volume_min, "-20");
});

test("test_max_moved_past_the_axis_stops_at_plus_12", async () => {
  assert.equal((await moved("max", 20)).volume_max, "12");
});

test("test_a_move_lands_on_whole_db", async () => {
  assert.equal((await moved("startup", -33.4)).defaults_volume, "-33");
});

test("test_a_move_landing_where_the_handle_is_stages_nothing", async () => {
  moveVolumeHandle("max", 0.3);
  await quiesce(wire);
  const still = wire.stages.length;
  moveVolumeHandle("max", -1);
  await quiesce(wire);
  assert.deepEqual([still, wire.stages.length], [0, 1]);
});
