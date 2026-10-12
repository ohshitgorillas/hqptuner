// Behavioral suite for hqptuner/static/model/shell/frame.js: the decisions the faceplate's wiring paints. The speed gauge and
// its zones, the source meter's no-stream line, and the page's top section.
//
// Every table here is the test's own: seams, scenes and the no-stream lines.
//
// Run: node --test tests/js/model/shell/frame.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { fillLayout, gaugeReading, noStream, zone } from "../../../../hqptuner/static/model/shell/frame.js";

/** @typedef {import("../../../../hqptuner/static/model/shell/frame.js").Scene} Scene */
/** @typedef {[number, number]} Seams */

//: Speed seams [bad|warn, warn|ok] the gauge tests read.
/** @type {Seams} */
const SPEED = [0.5, 1];

//: The no-stream lines, as tokens.
const COPY = { meterIdle: "idle-line", meterDsd: "dsd-line" };

//: Scenes: nothing playing, PCM at 1x and Nx, DSD.
/** @type {Scene} */
const IDLE = { id: "idle", playing: false, family: "pcm" };
/** @type {Scene} */
const PCM = { id: "pcm1x", playing: true, family: "pcm", source: "src-44", stage: "1x", nyquist: 22050 };
/** @type {Scene} */
const PCM_NX = { id: "pcmnx", playing: true, family: "pcm", source: "src-96", stage: "nx", nyquist: 48000 };
/** @type {Scene} */
const DSD = { id: "dsd64", playing: true, family: "dsd", source: "src-dsd" };

/**
 * The gauge needle's end at a speed.
 *
 * @param {number | null} v
 */
const needle = (v) => {
  const { x2, y2 } = gaugeReading(v, SPEED);
  return { x2, y2 };
};

// ── zones ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("test_a_value_below_the_first_seam_is_bad", () => {
  assert.equal(zone(0.4, SPEED), "bad");
});

test("test_a_value_on_the_first_seam_is_warn", () => {
  assert.equal(zone(0.5, SPEED), "warn");
});

test("test_a_value_on_the_second_seam_is_ok", () => {
  assert.equal(zone(1, SPEED), "ok");
});

test("test_nothing_playing_has_no_zone", () => {
  assert.equal(zone(null, SPEED), "");
});

// ── speed gauge ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("test_nothing_playing_rests_the_needle_where_the_slowest_speed_stops", () => {
  assert.deepEqual(needle(null), needle(1e-6));
});

test("test_a_fast_engine_pins_the_needle_at_the_right_stop", () => {
  assert.deepEqual(needle(1e3), needle(1e6));
});

test("test_a_faster_engine_moves_the_needle_right", () => {
  assert.ok(Number(needle(2).x2) > Number(needle(1).x2));
});

test("test_the_gauge_figure_takes_the_zone_of_its_speed", () => {
  assert.equal(gaugeReading(0.75, SPEED).zone, "warn");
});

// ── source meter's no-stream line ────────────────────────────────────────────────────────────────────────────────────

test("test_nothing_playing_shows_the_idle_line", () => {
  assert.equal(noStream(IDLE, true, COPY), COPY.meterIdle);
});

test("test_dsd_with_the_matrix_engine_bypassed_shows_the_dsd_line", () => {
  assert.equal(noStream(DSD, false, COPY), COPY.meterDsd);
});

test("test_dsd_with_the_matrix_engine_applied_runs_the_meter", () => {
  assert.equal(noStream(DSD, true, COPY), null);
});

test("test_pcm_with_the_matrix_engine_bypassed_runs_the_meter", () => {
  assert.equal(noStream(PCM, false, COPY), null);
});

// ── the page's top section ───────────────────────────────────────────────────────────────────────────────────────────

test("test_auto_with_the_matrix_engine_applied_folds_the_matrix_section", () => {
  assert.equal(fillLayout(true, "auto", PCM, COPY).fold, true);
});

test("test_auto_keeps_the_spectrum", () => {
  assert.equal(fillLayout(true, "auto", PCM, COPY).show, true);
});

test("test_profile_with_the_matrix_engine_applied_hides_the_spectrum", () => {
  assert.equal(fillLayout(true, "profile", PCM, COPY).show, false);
});

test("test_profile_with_the_matrix_engine_bypassed_gives_the_spectrum_the_top", () => {
  assert.equal(fillLayout(false, "profile", PCM, COPY).show, true);
});

test("test_a_bypassed_matrix_engine_never_folds", () => {
  assert.equal(fillLayout(false, "auto", PCM, COPY).fold, false);
});

test("test_a_shown_spectrum_with_nothing_playing_carries_the_idle_line", () => {
  assert.equal(fillLayout(true, "auto", IDLE, COPY).why, COPY.meterIdle);
});

test("test_folding_the_matrix_section_keeps_the_page_meter_mounted", () => {
  assert.equal(fillLayout(true, "auto", PCM, COPY).key, fillLayout(true, "spectrum", PCM, COPY).key);
});

test("test_another_scene_remounts_the_page_meter", () => {
  assert.notEqual(fillLayout(true, "auto", PCM, COPY).key, fillLayout(true, "auto", PCM_NX, COPY).key);
});

test("test_hiding_the_spectrum_remounts_the_page_meter", () => {
  assert.notEqual(fillLayout(true, "profile", PCM, COPY).key, fillLayout(true, "auto", PCM, COPY).key);
});
