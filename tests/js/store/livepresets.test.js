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
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. The fake answers the real REST paths with the real shapes and HOLDS
// the list the way the backend does, so "a save re-reads the list" is
// observable as the list having moved. No store function is ever stubbed.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/livepresets.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { engineState } from "../../../hqptuner/static/store/signals.js";
import { liveMode } from "../../../hqptuner/static/store/prefs.js";
import {
  livePresets,
  livePresetsBusy,
  livePresetError,
  applyLivePreset,
  saveLivePreset,
  deleteLivePreset,
} from "../../../hqptuner/static/store/live/presets.js";
import { rec, STATE, presetWire, settle } from "../support/livepresetwire.js";

/** @typedef {import("../../../hqptuner/static/store/live/presets.js").LivePreset} LivePreset */

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
 *   presets?: import("../support/livepresetwire.js").PresetRecord[],
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
 * @returns {import("../support/livepresetwire.js").PresetWire}
 */
function reset({ state, ...wire } = {}) {
  engineState.value = state === undefined ? STATE("pcm") : state;
  livePresets.value = null;
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

// --- saving and deleting --------------------------------------------------------

test("test_saving_a_preset_puts_to_its_endpoint", async () => {
  const w = reset();
  await saveLivePreset("Den");
  assert.equal(w.calls.filter((c) => c.path === "/api/livepresets/Den" && c.method === "PUT").length, 1);
});

test("test_a_save_sends_no_request_body", async () => {
  // The backend snapshots the running engine itself; a body would be the
  // frontend's idea of the settings instead of the engine's.
  const w = reset();
  await saveLivePreset("Den");
  assert.equal(w.calls.find((c) => c.method === "PUT")?.body, undefined);
});

test("test_a_save_re_reads_the_preset_list", async () => {
  reset({ presets: [rec("Living Room", "pcm")] });
  await saveLivePreset("Den");
  assert.deepEqual(names(), ["Living Room", "Den"]);
});

test("test_deleting_a_preset_sends_a_delete_to_its_endpoint", async () => {
  const w = reset({ presets: [rec("Den", "pcm")] });
  await deleteLivePreset("Den");
  assert.equal(w.calls.filter((c) => c.path === "/api/livepresets/Den" && c.method === "DELETE").length, 1);
});

test("test_a_delete_re_reads_the_preset_list", async () => {
  reset({ presets: [rec("Living Room", "pcm"), rec("Den", "pcm")] });
  await deleteLivePreset("Den");
  assert.deepEqual(names(), ["Living Room"]);
});
