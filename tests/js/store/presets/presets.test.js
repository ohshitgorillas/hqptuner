// Behavioral suite for store/actions.js's preset lane: previewPreset and
// clearPreview.
//
// The wire is faked, not the store (docs/testing.md rule 4): a fetch fake
// answers the real REST paths with the daemon's real response shapes —
// GET /api/preset/{name} -> {name, config}. No store function is stubbed. Module-level signals outlive a test, so reset()
// reassigns every tree and clears the preview and the staged buffer.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/presets.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { pendingPreset, config, matrixConfig, engineState } from "../../../../hqptuner/static/store/signals.js";
import { effective } from "../../../../hqptuner/static/store/resolve.js";
import {
  previewPreset,
  clearPreview,
  applyAll,
  lastApply,
  discardAll,
} from "../../../../hqptuner/static/store/actions.js";
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

// Every request the fake wire answered, for the silence assertions.
/** @type {{ path: string, method: string, body: Record<string, unknown> | null }[]} */
const CALLS = [];

// The one call matching a path — thrown rather than left undefined, since
// every caller here is asserting on a wire trip the case expects to have
// happened.
/**
 * @param {string} path
 * @returns {{ path: string, method: string, body: Record<string, unknown> | null }}
 */
function callFor(path) {
  const call = CALLS.find((c) => c.path === path);
  if (!call) throw new Error(`no call recorded for ${path}`);
  return call;
}

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
  CALLS.length = 0;
  env.fetch = async (/** @type {string} */ path, /** @type {{ method?: string, body?: string }} */ opts = {}) => {
    const method = opts.method || "GET";
    CALLS.push({ path, method, body: opts.body ? JSON.parse(opts.body) : null });
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

test("test_previewing_the_active_preset_does_not_touch_the_daemon", async () => {
  await reset({ active: "Day" });
  await previewPreset("Day");
  assert.equal(
    CALLS.some((c) => c.path.startsWith("/api/preset/")),
    false,
  );
});

// --- applying a previewed preset: the switch target on the wire -----------------
//
// "(no preset)" is the picker's empty option: a real previewed target whose name
// is the empty string. Asserted at the wire — the body of POST /api/config/apply —
// because that is where the switch either goes out or is silently dropped.

async function previewNoPreset() {
  await reset({ active: "Night", routes: { "GET /api/preset/": ok({ name: "", config: {} }) } });
  await previewPreset("");
}

test("test_applying_a_previewed_no_preset_option_sends_the_empty_switch_target", async () => {
  await previewNoPreset();
  await applyAll();
  assert.equal(callFor("/api/config/apply").body?.switch_to, "");
});

test("test_applying_with_nothing_previewed_sends_no_switch_target", async () => {
  await reset({ active: "Night" });
  await applyAll();
  assert.equal(callFor("/api/config/apply").body?.switch_to, undefined);
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
