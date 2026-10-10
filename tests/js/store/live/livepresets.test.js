// Behavioral suite for store/live/presets.js — the LIVE page's own presets: the
// saved list and the four verbs (read / apply / save / delete). The LIVE MODE
// card LiveView renders from them is covered in livepresetscard.test.js; the
// wire fake and the records it serves live in livepresetwire.js.
//
// A live snapshot is HQPTuner's, not the daemon's: it stores a batch of live
// settings keyed by form-field name, and it carries the OUTPUT MODE among them
// (`fields.mode`, one of auto / pcm / sdm). Applying one switches the engine to
// that mode before applying the rest, so there is no such thing as an
// incompatible preset: every saved preset is pickable, always, whatever chain
// the engine currently reports.
//
// The fake answers the real REST paths with the real shapes and HOLDS
// the list the way the backend does, so "a save re-reads the list" is
// observable as the list having moved.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/livepresets.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { config, engineState } from "../../../../hqptuner/static/store/signals.js";
import { liveMode } from "../../../../hqptuner/static/store/ui/prefs.js";
import {
  livePresets,
  liveBook,
  livePresetStation,
  livePresetsBusy,
  livePresetError,
  applyLivePreset,
} from "../../../../hqptuner/static/store/live/presets.js";
import { rec, STATE, presetWire, settle } from "../../support/wire/livepresetwire.js";

/** @typedef {import("../../../../hqptuner/static/store/live/presets.js").LivePreset} LivePreset */

const REAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

// The fixture reset() takes. A 409's `detail` is a per-field object on the real
// wire — the fetch wrapper flattens its values into one sentence — so
// `applyDetail` is wider here than the bare string the harness's own
// PresetWireState spells it as.
/**
 * @typedef {{
 *   state?: unknown,
 *   presets?: import("../../support/wire/livepresetwire.js").PresetRecord[],
 *   station?: string,
 *   others?: Record<string, import("../../support/wire/livepresetwire.js").PresetRecord[]>,
 *   chain?: string,
 *   listStatus?: number,
 *   listDetail?: string,
 *   saveStatus?: number,
 *   saveDetail?: string,
 *   applyStatus?: number,
 *   applyDetail?: string | Record<string, string>,
 *   report?: unknown,
 *   mirrored?: unknown,
 * }} Fixture
 */

// Module-level signals outlive a test, so every one this file touches is
// reassigned in every case; a partial reset makes cases pass alone and fail in
// sequence.
/**
 * @param {Fixture} [fixture]
 * @returns {import("../../support/wire/livepresetwire.js").PresetWire}
 */
function reset({ state, ...wire } = {}) {
  engineState.value = state === undefined ? STATE("pcm") : state;
  config.value = null;
  livePresets.value = null;
  liveBook.value = null;
  livePresetStation.value = null;
  livePresetsBusy.value = "";
  livePresetError.value = "";
  liveMode.value = false;
  return presetWire(wire);
}

// The saved list's display names, in list order — every case reading
// `livePresets.value` after a settle reads it through here.
/** @returns {string[]} */
const names = () => (livePresets.value || []).map((/** @type {LivePreset} */ p) => p.name);

// --- the list -----------------------------------------------------------------

// FIRST, deliberately: "not looked yet" is the signal's state before anything in
// this file has read, and no later case can restore it honestly — a reset that
// wrote null would only assert the test's own write back at itself.
test("test_the_preset_list_is_unknown_before_the_first_read", () => {
  assert.equal(livePresets.value, null);
});

test("test_turning_live_mode_on_reads_the_saved_presets", async () => {
  reset({ presets: [rec("Living Room", "pcm")] });
  liveMode.value = true;
  await settle();
  assert.deepEqual(names(), ["Living Room"]);
});

test("test_a_failed_read_leaves_the_list_empty", async () => {
  reset({ listStatus: 500, listDetail: "the preset store is unreadable" });
  liveMode.value = true;
  await settle();
  assert.deepEqual(livePresets.value, []);
});

// --- applying -----------------------------------------------------------------

test("test_applying_a_preset_posts_to_its_apply_endpoint", async () => {
  const w = reset({ presets: [rec("Den", "pcm")] });
  await applyLivePreset("Den");
  assert.equal(w.calls.filter((c) => c.path === "/api/livepresets/Den/apply" && c.method === "POST").length, 1);
});

test("test_applying_a_preset_whose_name_has_a_space_escapes_the_path", async () => {
  const w = reset({ presets: [rec("Living Room", "pcm")] });
  await applyLivePreset("Living Room");
  assert.equal(w.calls.filter((c) => c.path === "/api/livepresets/Living%20Room/apply").length, 1);
});

test("test_an_apply_whose_settings_all_verified_reports_nothing", async () => {
  // Seeded with a standing complaint, so this pins the error being CLEARED
  // rather than never written: an empty signal is also what the reset wrote, and
  // a lane that only ever appends failures would leave last time's sentence on
  // the card under a write that just succeeded.
  reset({
    presets: [rec("Den", "pcm")],
    report: { live: [{ setting: "filter1x", ok: true }], stored: {} },
  });
  livePresetError.value = "SetRate did not take";
  await applyLivePreset("Den");
  assert.equal(livePresetError.value, "");
});

test("test_a_successful_apply_re_reads_the_engines_state", async () => {
  // A live write never reaches the config file, so /api/state is the only place
  // the new values appear. Asserting the state SIGNAL moved, not just that the
  // call went out: a lane that fetched and dropped the answer would show the
  // user stale values.
  reset({
    presets: [rec("Den", "pcm")],
    report: { live: [{ setting: "rate", ok: true }], stored: {} },
    mirrored: STATE("pcm", "2"),
  });
  await applyLivePreset("Den");
  assert.equal(engineState.value.rate, "2");
});

test("test_a_refused_apply_does_not_re_read_the_engines_state", async () => {
  const w = reset({
    presets: [rec("Den", "pcm")],
    applyStatus: 409,
    applyDetail: { filter1x: "the pcm chain is not loaded (engine chain: sdm)" },
  });
  await applyLivePreset("Den");
  assert.equal(w.calls.filter((c) => c.path === "/api/state").length, 0);
});

// The mark is what the card's "working…" reads, so it has to be pinned in both
// directions: SET while the call is out, and released after. Asserting only the
// release would pass on a lane that never touched the signal at all — the reset
// already wrote the empty string the release leaves behind.
test("test_a_preset_in_flight_is_marked_busy_by_name", async () => {
  reset({ presets: [rec("Den", "pcm")] });
  const applying = applyLivePreset("Den");
  const marked = livePresetsBusy.value;
  await applying;
  assert.equal(marked, "Den");
});

test("test_a_settled_apply_releases_the_busy_mark", async () => {
  reset({ presets: [rec("Den", "pcm")] });
  livePresetsBusy.value = "Den";
  await applyLivePreset("Den");
  assert.equal(livePresetsBusy.value, "");
});

test("test_a_refused_apply_releases_the_busy_mark_too", async () => {
  reset({
    presets: [rec("Den", "pcm")],
    applyStatus: 409,
    applyDetail: { filter1x: "the pcm chain is not loaded (engine chain: sdm)" },
  });
  livePresetsBusy.value = "Den";
  await applyLivePreset("Den");
  assert.equal(livePresetsBusy.value, "");
});

// --- an apply the daemon failed, in the page's words ------------------------------
// The card's error names each failed setting by the label the page gives it,
// never by the daemon's form key. A refusal carries the daemon's own reason; a
// setter the daemon stopped answering has none worth showing (the 200 report's
// `{ok: false, error, code}` per setter). The fixture
// invents both texts, so asserting them pins no shipped wording.
// An error that names
// its setting reads differently for two settings, and never shows a labelled
// setting's form key.

// The PCM chain's two filter slots, by form key, each owned by a control on the
// page (tests/js/components/controls/combobox-favstars.test.js).
const PCM_1X = "filter1x";
const PCM_NX = "filter";
const REASON = "invalid filter";
const STALL = "SetFilter: no reply within 5.0s";

/** @param {string} setting */
const refusedSetter = (setting) => ({ setting, ok: false, code: "daemon_refused", error: REASON });
/** @param {string} setting */
const stalledSetter = (setting) => ({ setting, ok: false, code: "daemon_unavailable", error: STALL });

/**
 * The card's error after applying a preset whose setters answered `live`.
 *
 * @param {ReturnType<typeof refusedSetter>[]} live
 * @returns {Promise<string>}
 */
async function failedApply(live) {
  const den = { ...rec("Den", "pcm"), fields: { mode: "pcm", [PCM_1X]: "40", [PCM_NX]: "40", rate: "0" } };
  reset({ presets: [den], report: { live, stored: {} } });
  await applyLivePreset("Den");
  return livePresetError.value;
}

test("test_refusals_of_two_different_preset_settings_read_differently", async () => {
  const oneX = await failedApply([refusedSetter(PCM_1X)]);
  const nX = await failedApply([refusedSetter(PCM_NX)]);
  assert.notEqual(oneX, nX);
});

test("test_a_preset_setting_the_daemon_refused_is_shown_without_its_form_key", async () => {
  const text = await failedApply([refusedSetter(PCM_1X)]);
  assert.ok(!text.includes(PCM_1X), text);
});

// Keys no control on the page owns have no label to show, so each wire key stands in.
const UNLABELLED = "no_control_owns_this_key";
const ALSO_UNLABELLED = "nor_does_any_own_this_one";

test("test_a_refused_preset_setting_no_control_owns_is_named_by_its_wire_key", async () => {
  const text = await failedApply([refusedSetter(UNLABELLED)]);
  assert.ok(text.includes(UNLABELLED), text);
});

test("test_every_preset_setting_the_daemon_stopped_answering_on_is_named", async () => {
  const text = await failedApply([stalledSetter(UNLABELLED), stalledSetter(ALSO_UNLABELLED)]);
  assert.deepEqual(
    [UNLABELLED, ALSO_UNLABELLED].map((key) => text.includes(key)),
    [true, true],
    text,
  );
});

test("test_a_preset_setting_the_daemon_stopped_answering_on_is_shown_without_its_form_key", async () => {
  const text = await failedApply([stalledSetter(PCM_1X)]);
  assert.ok(!text.includes(PCM_1X), text);
});

test("test_a_preset_setting_the_daemon_stopped_answering_on_does_not_show_the_setters_error", async () => {
  const text = await failedApply([stalledSetter(PCM_1X)]);
  assert.ok(!text.includes(STALL), text);
});

// --- saving and deleting --------------------------------------------------------

// --- stations -------------------------------------------------------------------
//
// The list is the loaded station's; the book beside it holds every station's.
// The station the list was read for is the one an apply or a delete names, so a
// pick from the list reaches the snapshot the list showed.

test("test_a_read_holds_every_stations_snapshots_in_the_book", async () => {
  reset({ presets: [rec("Den", "pcm")], station: "Office", others: { "": [rec("Hall", "pcm")] } });
  liveMode.value = true;
  await settle();
  assert.deepEqual(Object.keys((liveBook.value || {})[""] || {}), ["Hall"]);
});

test("test_a_change_of_loaded_station_re_reads_the_list", async () => {
  const w = reset({ presets: [rec("Hall", "pcm")] });
  liveMode.value = true;
  await settle();
  w.station = "Den";
  w.presets = [rec("Warm", "pcm")];
  config.value = { active: "Den" };
  await settle();
  assert.deepEqual(names(), ["Warm"]);
});

test("test_an_apply_names_the_station_its_list_was_read_for", async () => {
  const w = reset({ presets: [rec("Warm", "pcm")], station: "Den" });
  liveMode.value = true;
  await settle();
  await applyLivePreset("Warm");
  assert.equal(w.calls.filter((c) => c.path === "/api/livepresets/Warm/apply?station=Den").length, 1);
});
