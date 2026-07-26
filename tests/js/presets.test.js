// Behavioral suite for store/state.js's preset lane: previewPreset /
// clearPreview / deletePreset (the picker's verbs) and savePresetOnly (the
// standalone "I like this, keep it" save).
//
// The wire is faked, not the store (docs/testing.md rule 4): a fetch fake
// answers the real REST paths with the daemon's real response shapes —
// GET /api/preset/{name} -> {name, config}, POST /api/profile/save ->
// {name, ok, error?}, DELETE /api/preset/{name} -> {name, ok}. No store
// function is stubbed. Module-level signals outlive a test, so reset()
// reassigns every tree and clears the preview and the staged buffer.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/presets.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  previewPreset,
  clearPreview,
  deletePreset,
  savePresetOnly,
  pendingPreset,
  hasPending,
  effective,
  applying,
  lastApply,
  config,
  matrixConfig,
  engineState,
  discardAll,
} from "../../hqptuner/static/store/state.js";
import { ok, bad } from "./wire.js";

const REAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

// Every request the fake wire answered, for the silence assertions.
const CALLS = [];

// Routes are keyed "METHOD /path"; anything unrouted gets a minimal valid
// answer so the surrounding flow (refreshConfig after a delete/save) completes.
function wire(routes = {}) {
  CALLS.length = 0;
  globalThis.fetch = async (path, opts = {}) => {
    const method = opts.method || "GET";
    CALLS.push({ path, method, body: opts.body ? JSON.parse(opts.body) : null });
    const hit = routes[`${method} ${path}`];
    if (hit) return hit;
    if (path === "/api/config/pending" || path === "/api/config/stage") return ok({ live: {}, http: {} });
    if (path === "/api/config") return ok({ data: config.value });
    if (path === "/api/matrix") return ok({ data: matrixConfig.value });
    if (path === "/api/enumerations") return ok({ data: null });
    return ok({});
  };
}

const field = (name, value) => ({ name, value });

async function reset({ fields = [], active = "", routes = {} } = {}) {
  engineState.value = {};
  config.value = { fields, file: {}, active };
  matrixConfig.value = { fields: [] };
  lastApply.value = null;
  wire(routes);
  await discardAll(); // also clears any leftover preview
}

// The picker's usual case: previewing a preset that is NOT the active one.
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

test("test_a_previewed_preset_alone_warrants_an_apply", async () => {
  await previewNight();
  assert.equal(hasPending.value, true);
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

// --- deletePreset ----------------------------------------------------------------

test("test_deleting_a_preset_removes_it_on_the_server", async () => {
  await reset();
  await deletePreset("Old");
  assert.equal(CALLS.filter((c) => c.path === "/api/preset/Old" && c.method === "DELETE").length, 1);
});

test("test_deleting_a_preset_refreshes_the_picker", async () => {
  await reset({ routes: { "GET /api/config": ok({ data: { fields: [], file: {}, active: "AfterDelete" } }) } });
  await deletePreset("Old");
  assert.equal(config.value.active, "AfterDelete");
});

test("test_deleting_the_previewed_preset_clears_the_preview", async () => {
  await previewNight();
  await deletePreset("Night");
  assert.equal(pendingPreset.value, null);
});

test("test_deleting_another_preset_keeps_the_preview", async () => {
  await previewNight();
  await deletePreset("Old");
  assert.equal(pendingPreset.value, "Night");
});

test("test_deleting_a_blank_name_is_a_no_op", async () => {
  await reset();
  const before = CALLS.length;
  await deletePreset("");
  assert.equal(CALLS.length, before);
});

// --- savePresetOnly ---------------------------------------------------------------

test("test_a_standalone_save_posts_the_preset_name", async () => {
  await reset({ routes: { "POST /api/profile/save": ok({ name: "P", ok: true }) } });
  await savePresetOnly("P");
  assert.equal(CALLS.find((c) => c.path === "/api/profile/save").body.name, "P");
});

test("test_a_successful_standalone_save_reports_the_saved_name", async () => {
  await reset({ routes: { "POST /api/profile/save": ok({ name: "P", ok: true }) } });
  await savePresetOnly("P");
  assert.equal(lastApply.value.text, 'Saved to "P"');
});

test("test_a_successful_standalone_save_is_ok", async () => {
  await reset({ routes: { "POST /api/profile/save": ok({ name: "P", ok: true }) } });
  await savePresetOnly("P");
  assert.equal(lastApply.value.ok, true);
});

test("test_a_failed_standalone_save_names_the_preset_and_the_error", async () => {
  await reset({ routes: { "POST /api/profile/save": ok({ name: "P", ok: false, error: "disk" }) } });
  await savePresetOnly("P");
  assert.equal(lastApply.value.text, 'Save to "P" failed: disk');
});

test("test_a_failed_standalone_save_is_not_ok", async () => {
  await reset({ routes: { "POST /api/profile/save": ok({ name: "P", ok: false, error: "disk" }) } });
  await savePresetOnly("P");
  assert.equal(lastApply.value.ok, false);
});

test("test_a_standalone_save_refreshes_the_active_preset", async () => {
  await reset({
    routes: {
      "POST /api/profile/save": ok({ name: "P", ok: true }),
      "GET /api/config": ok({ data: { fields: [], file: {}, active: "P" } }),
    },
  });
  await savePresetOnly("P");
  assert.equal(config.value.active, "P");
});

test("test_a_rejected_save_request_rethrows_to_the_caller", async () => {
  await reset({ routes: { "POST /api/profile/save": bad(503, "boom") } });
  await assert.rejects(() => savePresetOnly("P"));
});

test("test_a_rejected_save_request_leaves_a_readable_verdict", async () => {
  await reset({ routes: { "POST /api/profile/save": bad(503, "boom") } });
  await savePresetOnly("P").catch(() => {});
  assert.equal(lastApply.value.text, "Save failed: boom");
});

test("test_the_save_lane_releases_the_applying_flag", async () => {
  await reset({ routes: { "POST /api/profile/save": ok({ name: "P", ok: true }) } });
  await savePresetOnly("P");
  assert.equal(applying.value, false);
});

test("test_the_save_lane_releases_the_applying_flag_on_failure_too", async () => {
  await reset({ routes: { "POST /api/profile/save": bad(503, "boom") } });
  await savePresetOnly("P").catch(() => {});
  assert.equal(applying.value, false);
});
