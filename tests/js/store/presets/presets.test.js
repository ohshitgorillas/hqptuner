// Behavioral suite for store/actions.js's preset lane: previewPreset and
// clearPreview.
//
// A fetch fake
// answers the real REST paths with the daemon's real response shapes —
// GET /api/preset/{name} -> {name, config}. Module-level signals outlive a test, so reset()
// reassigns every tree and clears the preview and the staged buffer.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/presets/presets.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  pendingPreset,
  config,
  matrixConfig,
  engineState,
  lastApply,
} from "../../../../hqptuner/static/store/signals.js";
import { effective } from "../../../../hqptuner/static/store/resolve.js";
import { previewPreset, clearPreview, discardAll } from "../../../../hqptuner/static/store/actions.js";
import { ok } from "../../support/wire/wire.js";

/**
 * @typedef {import("../../support/wire/wire.js").FakeResponse} FakeResponse
 */

/**
 * One /config form field, as `field()` below builds it.
 *
 * @typedef {{ name: string, value: string }} FormField
 */

// The globals a fake wire installs a `fetch` on, viewed as an optional member:
// the DOM lib declares it returning a real `Response`, which these fakes do
// not build.
/** @type {{ fetch?: unknown }} */
const env = globalThis;

const REAL_FETCH = env.fetch;
afterEach(() => {
  env.fetch = REAL_FETCH;
});

// The minimal valid answer for a path no case routed, so the surrounding
// flow (refreshConfig after a delete/save) completes.
/**
 * @param {string} path
 * @returns {FakeResponse}
 */
function defaultAnswerFor(path) {
  if (path === "/api/config/pending" || path === "/api/config/stage") return ok({ live: {}, http: {} });
  if (path === "/api/config") return ok({ data: config.value });
  if (path === "/api/matrix") return ok({ data: matrixConfig.value });
  if (path === "/api/enumerations") return ok({ data: null });
  if (path === "/api/config/apply") return ok({ report: {} });
  return ok({});
}

// Routes are keyed "METHOD /path"; anything unrouted falls back to defaultAnswerFor.
/** @param {Record<string, FakeResponse>} [routes] */
function wire(routes = {}) {
  env.fetch = async (/** @type {string} */ path, /** @type {{ method?: string, body?: string }} */ opts = {}) => {
    const method = opts.method || "GET";
    return routes[`${method} ${path}`] || defaultAnswerFor(path);
  };
}

/**
 * @param {string} name
 * @param {string} value
 * @returns {FormField}
 */
const field = (name, value) => ({ name, value });

/**
 * @param {{ fields?: FormField[], active?: string, routes?: Record<string, FakeResponse> }} [seams]
 */
async function reset({ fields = [], active = "", routes = {} } = {}) {
  engineState.value = {};
  config.value = { fields, file: {}, active };
  matrixConfig.value = { fields: [] };
  lastApply.value = null;
  wire(routes);
  await discardAll(); // also clears any leftover preview
}

// The picker's usual case: previewing a preset that is NOT the active one.
/**
 * @param {{ fields?: FormField[], active?: string }} [seams]
 */
async function previewNight({ fields = [field("volume_max", "-3")], active = "" } = {}) {
  await reset({
    fields,
    active,
    routes: { "GET /api/preset/Night": ok({ name: "Night", config: { volume_max: "-9" } }) },
  });
  await previewPreset("Night");
}

// --- previewing a preset ------------------------------------------------------

test("test_previewing_a_preset_grounds_the_editor_to_its_saved_values", async () => {
  await previewNight();
  assert.equal(effective("volume_max"), "-9");
});

test("test_previewing_a_preset_marks_it_pending", async () => {
  await previewNight();
  assert.equal(pendingPreset.value, "Night");
});

test("test_a_preset_silent_on_a_field_leaves_the_form_baseline_in_place", async () => {
  await reset({
    fields: [field("volume_max", "-3")],
    routes: { "GET /api/preset/Night": ok({ name: "Night", config: {} }) },
  });
  await previewPreset("Night");
  assert.equal(effective("volume_max"), "-3");
});

// --- previewing the already-active preset is a clear, not a switch -------------

test("test_previewing_the_active_preset_clears_the_preview", async () => {
  await previewNight({ active: "Day" });
  await previewPreset("Day");
  assert.equal(pendingPreset.value, null);
});

test("test_previewing_the_active_preset_restores_the_form_baseline", async () => {
  await previewNight({ active: "Day" });
  await previewPreset("Day");
  assert.equal(effective("volume_max"), "-3");
});

// --- clearPreview ---------------------------------------------------------------

test("test_clearing_the_preview_restores_the_form_baseline", async () => {
  await previewNight();
  clearPreview();
  assert.equal(effective("volume_max"), "-3");
});

test("test_clearing_the_preview_unmarks_the_pending_preset", async () => {
  await previewNight();
  clearPreview();
  assert.equal(pendingPreset.value, null);
});
