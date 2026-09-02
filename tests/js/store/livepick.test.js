// Behavioral suite for store/actions.js's pickPreset — the single verb the
// header's preset picker calls when the user picks a preset from the dropdown.
// One behavior: with LIVE mode on, picking a preset switches to it on the wire.
//
// The wire is faked, not the store (docs/testing.md rule 4): a fetch fake
// answers the real REST paths with the daemon's real response shapes —
// GET /api/preset/{name} -> {name, config}, GET /api/livepresets -> {presets},
// and nothing else. No store function is stubbed. POST /api/config/apply is
// answered with a bare ok({}): the case asserts on the request the store
// sends, not on any verdict it gets back.
// `switch_to` is a wire identifier, so pinning it is correct (rule 9).
//
// Module-level signals outlive a test file, so reset() reassigns every signal
// this file touches — including the live-snapshot ones, which turning LIVE mode
// on sets going — and clears the staged buffer through discardAll().
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/livepick.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { pendingPreset, config, matrixConfig, engineState } from "../../../hqptuner/static/store/signals.js";
import { liveMode } from "../../../hqptuner/static/store/prefs.js";
import { livePresets, livePresetsBusy, livePresetError } from "../../../hqptuner/static/store/live/presets.js";
import { pickPreset, lastApply, discardAll } from "../../../hqptuner/static/store/actions.js";
import { ok } from "../support/wire.js";
import { STATE } from "../support/livepresetwire.js";

/** @typedef {import("../support/wire.js").FakeResponse} FakeResponse */

// The globals a fake wire installs a `fetch` on, viewed as an optional member:
// the DOM lib declares it returning a real `Response`, which these fakes do
// not build.
/** @type {{ fetch?: unknown }} */
const env = globalThis;

const REAL_FETCH = env.fetch;
afterEach(() => {
  env.fetch = REAL_FETCH;
});

// Every request the fake wire answered, so the assertion can read the apply
// request's own body.
/** @type {{ path: string, method: string, body: Record<string, unknown> | null }[]} */
const CALLS = [];

// The one call matching a verb AND a path — the verb is part of the wire
// contract, so a request made with any other method is not this trip. Thrown
// rather than left undefined, since the case is asserting on a wire trip it
// expects to have happened. Not an assertion: a lane that never fired has lost
// its premise, not its verdict.
/**
 * @param {string} method
 * @param {string} path
 * @returns {{ path: string, method: string, body: Record<string, unknown> | null }}
 */
function callFor(method, path) {
  const call = CALLS.find((c) => c.method === method && c.path === path);
  if (!call) throw new Error(`no call recorded for ${method} ${path}`);
  return call;
}

// The endpoints a pick may touch on either side of its own — the live-snapshot
// list LIVE mode reads, the engine's state, the trees the page reads. Each
// answers its real shape, so a lane reading one gets something it can adopt
// rather than a bare {}.
/**
 * @param {string} path
 * @returns {FakeResponse}
 */
function ambient(path) {
  if (path === "/api/livepresets") return ok({ presets: [] });
  if (path === "/api/state") return ok({ stale: false, loaded_at: 1, data: STATE("pcm") });
  if (path === "/api/config/pending" || path === "/api/config/stage") return ok({ live: {}, http: {} });
  if (path === "/api/config") return ok({ data: config.value });
  if (path === "/api/matrix") return ok({ data: matrixConfig.value });
  if (path === "/api/enumerations") return ok({ data: null });
  return ok({});
}

// Routes are keyed "METHOD /path"; anything unrouted falls through to ambient().
/** @param {Record<string, FakeResponse>} routes */
function wire(routes) {
  CALLS.length = 0;
  env.fetch = async (/** @type {string} */ path, /** @type {{ method?: string, body?: string }} */ opts = {}) => {
    const method = opts.method || "GET";
    CALLS.push({ path, method, body: opts.body ? JSON.parse(opts.body) : null });
    return routes[`${method} ${path}`] || ambient(path);
  };
}

/** @param {Record<string, FakeResponse>} routes */
async function reset(routes) {
  engineState.value = {};
  config.value = { fields: [{ name: "volume_max", value: "-3" }], file: {}, active: "Day" };
  matrixConfig.value = { fields: [] };
  lastApply.value = null;
  pendingPreset.value = null;
  livePresets.value = null;
  livePresetsBusy.value = "";
  livePresetError.value = "";
  liveMode.value = false;
  wire(routes);
  await discardAll(); // also clears any leftover preview
}

test("test_picking_a_preset_in_live_mode_sends_it_as_the_switch_target", async () => {
  await reset({ "GET /api/preset/Night": ok({ name: "Night", config: { volume_max: "-9" } }) });
  liveMode.value = true;
  await pickPreset("Night");
  assert.equal(callFor("POST", "/api/config/apply").body?.switch_to, "Night");
});
