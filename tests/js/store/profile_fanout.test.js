// Behavioral suite for store/matrix/profiles.js — the profile-staging fan-out
// payloads: what stageProfileSave / stageProfileDelete actually put on the
// wire when a presets list is (or is not) supplied, that a targeted delete's
// name is still honoured by savedProfiles, and the presetProfiles read model.
//
// Everything is driven the way the app drives it: matrixConfig assigned
// directly (the poll's own seam) and staging through the exported
// stageProfileSave / stageProfileDelete, which ride edit() over a faked wire
// (stagingWire — the real /api/config/stage path, no store function stubbed).
// Staged values are read back through effective(), the resolver every caller
// uses. Module-level signals outlive a test, so reset() reassigns every tree
// and clears the staged buffer via discardAll().
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/profile_fanout.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { effective } from "../../../hqptuner/static/store/resolve.js";
import {
  savedProfiles,
  presetProfiles,
  stageProfileSave,
  stageProfileDelete,
} from "../../../hqptuner/static/store/matrix/profiles.js";
import { ROW, PROF, reset } from "../support/profile-fixtures.js";

const REAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

// --- stageProfileSave: the staged JSON payload -----------------------------------

test("test_a_save_without_presets_stages_only_name_and_rows", async () => {
  await reset();
  await stageProfileSave("P", [ROW("-1")]);
  assert.deepEqual(JSON.parse(String(effective("matrix_profile_save"))), { name: "P", rows: [ROW("-1")] });
});

test("test_a_save_with_an_empty_presets_list_stages_the_no_presets_shape", async () => {
  await reset();
  await stageProfileSave("P", [ROW("-1")], []);
  assert.deepEqual(JSON.parse(String(effective("matrix_profile_save"))), { name: "P", rows: [ROW("-1")] });
});

test("test_a_save_with_presets_carries_them_alongside_name_and_rows", async () => {
  await reset();
  await stageProfileSave("P", [ROW("-1")], ["Office", "Headphones"]);
  assert.deepEqual(JSON.parse(String(effective("matrix_profile_save"))), {
    name: "P",
    rows: [ROW("-1")],
    presets: ["Office", "Headphones"],
  });
});

// --- stageProfileDelete: plain name vs JSON object -------------------------------

test("test_a_delete_without_presets_stages_the_plain_name_string", async () => {
  await reset();
  await stageProfileDelete("P");
  assert.equal(effective("matrix_profile_delete"), "P");
});

test("test_a_delete_with_presets_stages_a_json_object_naming_them", async () => {
  await reset();
  await stageProfileDelete("X", ["Office"]);
  assert.deepEqual(JSON.parse(String(effective("matrix_profile_delete"))), {
    name: "X",
    presets: ["Office"],
  });
});

test("test_a_targeted_delete_still_removes_the_name_from_the_picker", async () => {
  await reset({ file_profiles: { X: PROF([ROW("-1")]), Kept: PROF([ROW("-2")]) } });
  await stageProfileDelete("X", ["Office"]);
  assert.deepEqual(savedProfiles.value, ["Kept"]);
});

// --- presetProfiles: the config's preset->profile map -----------------------------

test("test_preset_profiles_mirrors_the_matrix_configs_map", async () => {
  await reset({ preset_profiles: { Office: "Flat", Headphones: "Warm" } });
  assert.deepEqual(presetProfiles.value, { Office: "Flat", Headphones: "Warm" });
});

test("test_preset_profiles_is_empty_when_the_config_carries_no_map", async () => {
  await reset();
  assert.deepEqual(presetProfiles.value, {});
});

test("test_preset_profiles_is_empty_before_the_matrix_config_arrives", async () => {
  await reset();
  matrixConfig.value = null;
  assert.deepEqual(presetProfiles.value, {});
});
