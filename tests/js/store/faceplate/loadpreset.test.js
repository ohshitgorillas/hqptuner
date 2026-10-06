// Behavioral suite for store/actions.js's loadPreset, the verb the header's station tree calls: a station is loaded on
// the spot in either mode.
//
// A fetch fake answers the real REST paths with their real shapes and records every request; no store function is
// stubbed. `switch_to` is a wire identifier (docs/testing.md rule 9).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/loadpreset.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { config, pendingPreset, engineState, matrixConfig } from "../../../../hqptuner/static/store/signals.js";
import { liveMode } from "../../../../hqptuner/static/store/ui/prefs.js";
import { loadPreset, lastApply, discardAll } from "../../../../hqptuner/static/store/actions.js";
import { ok } from "../../support/wire/wire.js";

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;

/** @type {{ path: string, method: string, body: Record<string, unknown> | null }[]} */
const CALLS = [];

/**
 * The answer to one request: the preset read, the apply, and the reads around them in their real shapes.
 *
 * @param {string} path
 */
function answer(path) {
  if (path === "/api/preset/Night") return ok({ name: "Night", config: { volume_max: "-9" } });
  if (path === "/api/config") return ok({ data: config.value });
  if (path === "/api/config/pending" || path === "/api/config/stage") return ok({ live: {}, http: {} });
  if (path === "/api/config/apply") return ok({ report: {} });
  if (path === "/api/livepresets") return ok({ presets: [] });
  return ok({});
}

beforeEach(async () => {
  CALLS.length = 0;
  env.fetch = async (/** @type {string} */ path, /** @type {{ method?: string, body?: string }} */ opts = {}) => {
    CALLS.push({ path, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
    return answer(path);
  };
  engineState.value = {};
  matrixConfig.value = { fields: [] };
  config.value = { fields: [], file: {}, active: "Day" };
  lastApply.value = null;
  pendingPreset.value = null;
  liveMode.value = false;
  await discardAll();
  CALLS.length = 0;
});

afterEach(() => {
  env.fetch = REAL_FETCH;
});

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
