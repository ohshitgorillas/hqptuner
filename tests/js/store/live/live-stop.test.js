// Behavioral suite for a live apply that stopped playback: the backend's report
// carries `playback_stopped`, and the page treats it as a failed apply, both for a
// hand-made write (store/live/write.js) and for a live snapshot apply
// (store/live/presets.js). Assertions are on the failure state, never on the
// sentence.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live/live-stop.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { engineState, config } from "../../../../hqptuner/static/store/signals.js";
import { liveOp, writeLive } from "../../../../hqptuner/static/store/live/write.js";
import { livePresetError, applyLivePreset } from "../../../../hqptuner/static/store/live/presets.js";
import { ok } from "../../support/wire/wire.js";
import { rec, STATE, presetWire } from "../../support/wire/livepresetwire.js";
import { seedReadings } from "../../support/readings.js";

/**
 * The globals a fake wire installs a `fetch` on, viewed as an optional
 * member: the DOM lib declares it returning a real `Response`, which this
 * fake does not build.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;
const REAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

/**
 * A /api/config/live that answers `report`, and the one read a successful write
 * re-mirrors from.
 *
 * @param {unknown} report
 */
async function liveWire(report) {
  engineState.value = STATE("pcm");
  config.value = { fields: [] };
  await seedReadings({});
  liveOp.clear();
  env.fetch = async (/** @type {string} */ path) =>
    path === "/api/config/live" ? ok({ report }) : ok({ data: STATE("pcm") });
}

/**
 * Apply the one saved snapshot against a wire answering `report`.
 *
 * @param {unknown} report
 */
async function snapshotWire(report) {
  engineState.value = STATE("pcm");
  config.value = null;
  await seedReadings({});
  livePresetError.value = "";
  return presetWire({ presets: [rec("Den", "pcm")], report });
}

/** The live op's error, as the backend-failure object `writeLive` raises. */
const failure = () => /** @type {{ fromBackend?: boolean } | null} */ (liveOp.error.value);

const STOPPED = { live: [], stored: {}, playback_stopped: true };
const KEPT = { live: [], stored: {}, playback_stopped: false };
const SILENT = { live: [], stored: {} };

test("test_a_live_write_that_stopped_playback_fails", async () => {
  await liveWire(STOPPED);
  await writeLive("volume", "-20");
  assert.equal(failure()?.fromBackend, true);
});

test("test_a_live_write_that_kept_playing_does_not_fail", async () => {
  await liveWire(KEPT);
  await writeLive("volume", "-20");
  assert.equal(liveOp.error.value, null);
});

test("test_a_live_write_with_no_stop_in_the_report_does_not_fail", async () => {
  await liveWire(SILENT);
  await writeLive("volume", "-20");
  assert.equal(liveOp.error.value, null);
});

test("test_a_snapshot_apply_that_stopped_playback_fails", async () => {
  await snapshotWire(STOPPED);
  await applyLivePreset("Den");
  assert.notEqual(livePresetError.value, "");
});

test("test_a_snapshot_apply_that_kept_playing_does_not_fail", async () => {
  await snapshotWire(KEPT);
  await applyLivePreset("Den");
  assert.equal(livePresetError.value, "");
});

test("test_a_snapshot_apply_with_no_stop_in_the_report_does_not_fail", async () => {
  await snapshotWire(SILENT);
  await applyLivePreset("Den");
  assert.equal(livePresetError.value, "");
});

// A stop and a setter that did not verify are both the user's to see.
const FAILED_SETTER = { setting: "filter1x", ok: false, code: "daemon_refused", error: "invalid filter" };

test("test_a_stop_in_a_report_with_a_failed_setter_still_names_the_setter", async () => {
  await snapshotWire({ live: [FAILED_SETTER], stored: {}, playback_stopped: true });
  await applyLivePreset("Den");
  assert.ok(livePresetError.value.includes("invalid filter"), livePresetError.value);
});

test("test_a_failed_setter_in_a_report_with_a_stop_adds_the_stop_to_the_error", async () => {
  await snapshotWire({ live: [FAILED_SETTER], stored: {}, playback_stopped: false });
  await applyLivePreset("Den");
  const setterAlone = livePresetError.value;
  await snapshotWire({ live: [FAILED_SETTER], stored: {}, playback_stopped: true });
  await applyLivePreset("Den");
  assert.ok(livePresetError.value.length > setterAlone.length, livePresetError.value);
});
