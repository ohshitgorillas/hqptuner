// Behavioral suite for the faceplate's alert list (hqptuner/static/store/faceplate/alerts.js) taking the failures of
// three areas no one read before: a failed apply, a failed live write and a failed live snapshot. Each failure joins
// the list as one alert, and it leaves the list when that same area next succeeds; a success in another area leaves it
// where it is. Where the line shows, directly under the top bar, and how a tap clears it, is pinned in
// tests/js/components/faceplate-alerts/plate-unread.test.js.
//
// Driven at the wire: each area's own exported verb runs over tests/js/support/wire/unreadwire.js, whose table answers
// a success or a failure in the backend's real shapes (tests/js/support/unreadareas.js). The reads an area makes after
// a write answer the payload the signals were seeded with, so nothing else on the list moves. The alert's kind is the
// implementation's to name, so no case names it: the list is counted against the count it held before the failure.
// The sentences are owner copy and are nowhere in this file.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-alerts/alerts-unread.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  health,
  engineState,
  engineStatus,
  enums,
  config,
  matrixConfig,
  lastApply,
} from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { initHealth } from "../../../../hqptuner/static/store/health.js";
import {
  liveBook,
  livePresets,
  livePresetError,
  livePresetsBusy,
  livePresetStation,
} from "../../../../hqptuner/static/store/live/presets.js";
import { faceplateAlerts } from "../../../../hqptuner/static/store/faceplate/alerts.js";
import { quiesce } from "../../support/wire/wire.js";
import { unreadWire, STATE, ENUMS, CONFIG, BOOK } from "../../support/wire/unreadwire.js";
import { fail, succeed, succeedEverywhere } from "../../support/unreadareas.js";
import { fakeClock } from "../../support/clock.js";

/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */

initHealth(fakeClock().clock);

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** A /api/health reading whose credentials the daemon accepted and which lists no dropped setting. */
const HEALTHY = { reachable: true, ready: true, connected: true, credentials_ok: true, info: {}, dropped_settings: [] };

/** @type {StagingWire} */
let wire;

beforeEach(async () => {
  wire = unreadWire();
  health.value = { ...HEALTHY };
  engineStatus.value = null;
  engineState.value = STATE();
  enums.value = ENUMS();
  config.value = CONFIG();
  matrixConfig.value = { fields: [] };
  liveBook.value = BOOK();
  livePresets.value = null;
  livePresetStation.value = null;
  livePresetsBusy.value = "";
  livePresetError.value = "";
  lastApply.value = null;
  await discardAll();
  await quiesce(wire);
  await succeedEverywhere(wire);
});

afterEach(() => {
  env.fetch = REAL_FETCH;
});

/**
 * How many alerts the list holds beyond `base`.
 *
 * @param {number} base
 */
const beyond = (base) => faceplateAlerts().length - base;

test("test_a_failed_apply_stays_on_the_alert_list_until_an_apply_succeeds", async () => {
  const base = faceplateAlerts().length;
  await fail(wire, "a_failed_apply");
  const failed = beyond(base);
  await succeed(wire, "apply");
  assert.deepEqual([failed, beyond(base)], [1, 0]);
});

test("test_a_failed_live_write_stays_on_the_alert_list_until_a_live_write_succeeds", async () => {
  const base = faceplateAlerts().length;
  await fail(wire, "a_live_write_hqplayer_refused");
  const failed = beyond(base);
  await succeed(wire, "live");
  assert.deepEqual([failed, beyond(base)], [1, 0]);
});

test("test_a_failed_snapshot_stays_on_the_alert_list_until_a_snapshot_succeeds", async () => {
  const base = faceplateAlerts().length;
  await fail(wire, "a_failed_snapshot_apply");
  const failed = beyond(base);
  await succeed(wire, "snapshot");
  assert.deepEqual([failed, beyond(base)], [1, 0]);
});

test("test_a_success_in_another_area_leaves_a_failed_applys_alert_on_the_list", async () => {
  const base = faceplateAlerts().length;
  await fail(wire, "a_failed_apply");
  await succeed(wire, "live");
  await succeed(wire, "snapshot");
  assert.equal(beyond(base), 1);
});
