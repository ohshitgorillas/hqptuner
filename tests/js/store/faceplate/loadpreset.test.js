// Behavioral suite for store/actions.js's loadPreset, the verb the header's station tree calls: a station is loaded on
// the spot in either mode.
//
// A fetch fake answers the real REST paths with their real shapes and records every request; no store function is
// stubbed. `switch_to` is a wire identifier.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/loadpreset.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { loadPreset, discardAll } from "../../../../hqptuner/static/store/actions.js";
import { ok } from "../../support/wire/wire.js";
import { seedReadings } from "../../support/readings.js";
import { CALLS, presetAnswer, recordFetch } from "../../support/rendered/connpanel.js";
import { resetPlateSignals, restoreFetch } from "../../support/rendered/alerts.js";

/** The answer to one request: the station load's paths in their real shapes, and an empty object for the rest. */
const answer = (/** @type {string} */ path) => presetAnswer(path) ?? ok({});

beforeEach(async () => {
  recordFetch(answer);
  resetPlateSignals();
  await seedReadings({ active_preset: { value: "Day", readonly: true } });
  await discardAll();
  CALLS.length = 0;
});

afterEach(restoreFetch);

/** The apply requests the wire saw. */
const applies = () => CALLS.filter((c) => c.method === "POST" && c.path === "/api/config/apply");

test("test_loading_a_preset_outside_live_switches_to_it_on_the_wire", async () => {
  await loadPreset("Night");
  assert.deepEqual(
    applies().map((c) => c.body?.switch_to),
    ["Night"],
  );
});

test("test_loading_the_preset_already_loaded_sends_no_apply", async () => {
  await loadPreset("Day");
  assert.equal(applies().length, 0);
});
