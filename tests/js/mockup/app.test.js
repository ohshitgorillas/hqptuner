// Behavioral suite for mockup/scripts/model/app.js: the decisions the faceplate's wiring paints. The speed gauge and
// its zones, the source meter's no-stream line, a profile's records, the page's top section, what a playback path
// shows, the mock alerts a pick raises and the engine row that follows them, and a Setting Switcher target change.
//
// Every table here is the test's own: engine figures, seams, scenes, option lists and alert lines that return the one
// argument a test reads.
//
// Run: node --test tests/js/mockup/app.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  engineRow,
  fillLayout,
  gaugeReading,
  noStream,
  pathView,
  profileRecords,
  raisedAlerts,
  switcherChange,
  zone,
} from "../../../mockup/scripts/model/app.js";

/** @typedef {import("../../../mockup/scripts/model/app.js").Scene} Scene */
/** @typedef {import("../../../mockup/scripts/model/app.js").RaiseNow} RaiseNow */
/** @typedef {import("../../../mockup/scripts/model/app.js").SlotFace} SlotFace */
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

//: Engine figures by path, buffer seams and the output tiers by chain.
const ENGINE = { idle: null, "pcm-pcm": { speed: 3, in: 10, out: 60 }, direct: { speed: 9, in: 90, out: 30 } };
const PATHS = { engine: ENGINE, zones: { buffer: /** @type {Seams} */ ([25, 50]) }, out: { pcm: { tier: 3 }, sdm: { tier: 9 }, direct: { tier: 6 } } };

//: Alert lines that hand back the one argument a test reads.
const ALERT_COPY = {
  credentials: "creds",
  speedCrit: (/** @type {number} */ n) => String(n),
  clip: (/** @type {number} */ n) => String(n),
  apod: (/** @type {number} */ _n, /** @type {string} */ filter) => filter,
  shaperSdm: (/** @type {string} */ shaper) => shaper,
  shaperPcm: (/** @type {string} */ shaper) => shaper,
  roonIdle: "roon",
  junk20k: (/** @type {number} */ _fold, /** @type {number} */ rate) => String(rate),
};
//: Running filters: one non-apodizing, one apodizing, one that says nothing.
const LISTS = {
  pcmFilters: [{ v: "plain", f: { apod: null } }, { v: "apodic", f: { apod: true } }, { v: "bare" }],
  sdmFilters: [{ v: "plain", f: { apod: null } }],
};
const FIG = { speed: 0.9, clips: 7 };
const RAISE = { lists: LISTS, copy: ALERT_COPY, fig: FIG };
const SHAPERS = { pcm: { sh: "pcm-shaper" }, sdm: { sh: "sdm-shaper" } };

/**
 * The alerts a pick raises on a PCM 1x track through the PCM chain, the plain filter running, with `over` replacing
 * any of that.
 *
 * @param {string[]} picks
 * @param {Partial<RaiseNow>} [over]
 */
const raise = (picks, over = {}) =>
  raisedAlerts({ p: "pcm-pcm", run: "pcm", st: SHAPERS, picked: new Set(picks), rf: "plain", scene: PCM, ...over }, RAISE);

/**
 * The kinds of the alerts raise() returns, in order.
 *
 * @param {string[]} picks
 * @param {Partial<RaiseNow>} [over]
 */
const kinds = (picks, over = {}) => raise(picks, over).map((a) => a.kind);

/**
 * The gauge needle's end at a speed.
 *
 * @param {number | null} v
 */
const needle = (v) => {
  const { x2, y2 } = gaugeReading(v, SPEED);
  return { x2, y2 };
};

//: The slot faces the Output mode target keeps: the second slot was live.
/** @type {SlotFace[]} */
const FACES = [{ l: "a", v: "x", on: false }, { l: "b", v: "y", on: true }];
/** @type {SlotFace[]} */
const NONE_ON = [{ l: "a", v: "x", on: false }, { l: "b", v: "y", on: false }];
const TARGETS = { mode: "mode-target", volume: "volume-target" };

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

test("test_the_gauge_figure_rounds_to_two_decimals", () => {
  assert.equal(parseFloat(gaugeReading(1.234, SPEED).text), 1.23);
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

// ── profile records ──────────────────────────────────────────────────────────────────────────────────────────────────

//: Two stations sharing one profile name; only the first holds the flat one.
const PROFILES = { first: { flat: { flat: true }, shared: { desc: "first-desc" } }, second: { shared: { desc: "second-desc" } } };

test("test_a_name_two_stations_hold_has_two_records", () => {
  assert.equal(profileRecords(PROFILES, "shared").length, 2);
});

test("test_the_first_record_is_the_earlier_stations", () => {
  assert.equal(profileRecords(PROFILES, "shared")[0], PROFILES.first.shared);
});

test("test_an_unknown_name_has_no_records", () => {
  assert.equal(profileRecords(PROFILES, "missing").length, 0);
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

test("test_spectrum_never_gives_the_matrix_section_the_top", () => {
  assert.equal(fillLayout(true, "spectrum", PCM, COPY).profile, false);
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

// ── a playback path ──────────────────────────────────────────────────────────────────────────────────────────────────

test("test_a_path_reads_its_speed_from_the_engine_table", () => {
  assert.equal(pathView("pcm-pcm", "pcm", PCM, PATHS).speed, 3);
});

test("test_idle_has_no_speed", () => {
  assert.equal(pathView("idle", "pcm", IDLE, PATHS).speed, null);
});

test("test_the_buffers_read_input_then_output", () => {
  assert.deepEqual(pathView("pcm-pcm", "pcm", PCM, PATHS).buffers.map((b) => b.v), [10, 60]);
});

test("test_each_buffer_takes_its_own_zone", () => {
  assert.deepEqual(pathView("pcm-pcm", "pcm", PCM, PATHS).buffers.map((b) => b.zone), ["bad", "ok"]);
});

test("test_idle_buffers_read_empty_with_no_zone", () => {
  assert.deepEqual(pathView("idle", "pcm", IDLE, PATHS).buffers, [{ v: 0, zone: "" }, { v: 0, zone: "" }]);
});

test("test_a_playing_scene_names_its_source_on_the_rail", () => {
  assert.equal(pathView("pcm-pcm", "pcm", PCM, PATHS).source, PCM.source);
});

test("test_the_direct_path_is_direct", () => {
  assert.equal(pathView("direct", "sdm", DSD, PATHS).direct, true);
});

test("test_a_converted_path_is_not_direct", () => {
  assert.equal(pathView("pcm-pcm", "pcm", PCM, PATHS).direct, false);
});

test("test_the_dial_plays_the_running_chains_tier", () => {
  assert.equal(pathView("pcm-pcm", "pcm", PCM, PATHS).tier, 3);
});

test("test_the_dial_plays_the_direct_tier_on_the_direct_path", () => {
  assert.equal(pathView("direct", "sdm", DSD, PATHS).tier, 6);
});

test("test_the_dial_plays_nothing_while_idle", () => {
  assert.equal(pathView("idle", "pcm", IDLE, PATHS).tier, null);
});

// ── mock alerts ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("test_idle_raises_only_the_credentials_of_the_playback_alerts", () => {
  assert.deepEqual(kinds(["credentials", "speed", "clip", "roon"], { p: "idle", scene: IDLE }), ["credentials"]);
});

test("test_a_speed_pick_raises_a_critical_alert", () => {
  assert.equal(raise(["speed"])[0]?.sev, "crit");
});

test("test_the_speed_alert_carries_the_mock_figure", () => {
  assert.equal(raise(["speed"])[0]?.text, String(FIG.speed));
});

test("test_a_non_apodizing_running_filter_raises_apodizing", () => {
  assert.deepEqual(kinds(["apod"]), ["apod"]);
});

test("test_the_apodizing_alert_names_the_running_filter", () => {
  assert.equal(raise(["apod"])[0]?.text, "plain");
});

test("test_an_apodizing_running_filter_raises_nothing", () => {
  assert.deepEqual(kinds(["apod"], { rf: "apodic" }), []);
});

test("test_a_running_filter_that_says_nothing_raises_nothing", () => {
  assert.deepEqual(kinds(["apod"], { rf: "bare" }), []);
});

test("test_apodizing_is_silent_on_the_direct_path", () => {
  assert.deepEqual(kinds(["apod"], { p: "direct", run: "sdm" }), []);
});

test("test_apodizing_is_silent_on_dsd_to_sdm", () => {
  assert.deepEqual(kinds(["apod"], { p: "sdm-sdm", run: "sdm" }), []);
});

test("test_the_modulator_fit_fires_only_on_the_sdm_chain", () => {
  assert.deepEqual(kinds(["shaperSdm"]), []);
});

test("test_the_modulator_fit_names_the_sdm_chains_shaper", () => {
  assert.equal(raise(["shaperSdm"], { p: "pcm-sdm", run: "sdm" })[0]?.text, SHAPERS.sdm.sh);
});

test("test_the_ditherer_fit_fires_with_nothing_playing", () => {
  assert.deepEqual(kinds(["shaperPcm"], { p: "idle", scene: IDLE }), ["shaperPcm"]);
});

test("test_junk_advice_fires_on_nx_pcm", () => {
  assert.equal(raise(["junk"], { scene: PCM_NX })[0]?.sev, "advice");
});

test("test_junk_advice_is_silent_on_1x_pcm", () => {
  assert.deepEqual(kinds(["junk"]), []);
});

test("test_junk_advice_names_the_container_rate_in_khz", () => {
  assert.equal(raise(["junk"], { scene: PCM_NX })[0]?.text, "96");
});

// ── the engine row after a raise ─────────────────────────────────────────────────────────────────────────────────────

test("test_a_raised_speed_alert_sets_the_gauge_to_the_mock_figure", () => {
  assert.equal(engineRow(raise(["speed"]), "pcm-pcm", ENGINE, FIG).speed, FIG.speed);
});

test("test_without_a_speed_alert_the_gauge_reads_the_path", () => {
  assert.equal(engineRow([], "pcm-pcm", ENGINE, FIG).speed, 3);
});

test("test_idle_without_alerts_leaves_the_gauge_at_rest", () => {
  assert.equal(engineRow([], "idle", ENGINE, FIG).speed, null);
});

test("test_a_raised_clip_alert_lights_the_clip_lamp", () => {
  assert.equal(engineRow(raise(["clip"]), "pcm-pcm", ENGINE, FIG).clip, true);
});

test("test_without_a_clip_alert_the_clip_lamp_keeps_its_own", () => {
  assert.equal(engineRow(raise(["speed"]), "pcm-pcm", ENGINE, FIG).clip, false);
});

// ── Setting Switcher target ──────────────────────────────────────────────────────────────────────────────────────────

test("test_the_volume_target_puts_the_switcher_in_volume", () => {
  assert.equal(switcherChange(TARGETS.volume, null, TARGETS).sw, "volume");
});

test("test_any_other_target_leaves_volume", () => {
  assert.equal(switcherChange(TARGETS.mode, null, TARGETS).sw, "");
});

test("test_the_output_mode_target_borrows_the_slots", () => {
  assert.equal(switcherChange(TARGETS.mode, null, TARGETS).step, "stash");
});

test("test_the_output_mode_target_borrows_the_slots_once", () => {
  assert.equal(switcherChange(TARGETS.mode, FACES, TARGETS).step, "none");
});

test("test_leaving_the_output_mode_target_hands_the_slots_back", () => {
  assert.equal(switcherChange(TARGETS.volume, FACES, TARGETS).step, "restore");
});

test("test_another_target_with_nothing_borrowed_leaves_the_slots", () => {
  assert.equal(switcherChange(TARGETS.volume, null, TARGETS).step, "none");
});

test("test_handing_back_relights_the_slot_that_was_live", () => {
  assert.equal(switcherChange(TARGETS.volume, FACES, TARGETS).lit, 1);
});

test("test_handing_back_with_no_slot_live_lights_the_first", () => {
  assert.equal(switcherChange(TARGETS.volume, NONE_ON, TARGETS).lit, 0);
});
