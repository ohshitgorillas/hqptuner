// Behavioral suite for store/profiles.js — the saved-matrix-profile read model:
// savedProfiles' merge of staged save/delete over the config's <matrix_profile>
// elements and the daemon's startup list, profileRows' staged-vs-file
// resolution, isLiveProfile's reachability rule, and the active-name fallbacks.
//
// Everything is driven the way the app drives it: matrixConfig assigned
// directly (the poll's own seam) and staging through the exported
// stageProfileSave / stageProfileDelete, which ride edit() over a faked wire
// (stagingWire — the real /api/config/stage path, no store function stubbed).
// Module-level signals outlive a test, so reset() reassigns every tree and
// clears the staged buffer via discardAll().
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/profiles.test.js

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { edit } from "../../../hqptuner/static/store/actions.js";
import {
  savedProfiles,
  profileRows,
  isLiveProfile,
  matrixActiveProfile,
  stageProfileSave,
  stageProfileDelete,
} from "../../../hqptuner/static/store/profiles.js";
import { ROW, PROF, reset } from "../support/profile-fixtures.js";

const REAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

// --- savedProfiles: the picker's union ------------------------------------------

test("test_the_picker_unions_config_profiles_with_the_daemons_list", async () => {
  await reset({ file_profiles: { FileOne: PROF([ROW("-1")]) }, live_profiles: ["DaemonOne"] });
  assert.deepEqual(savedProfiles.value, ["DaemonOne", "FileOne"]);
});

test("test_a_name_known_to_both_sources_appears_once", async () => {
  await reset({ file_profiles: { Both: PROF([ROW("-1")]) }, live_profiles: ["Both"] });
  assert.deepEqual(savedProfiles.value, ["Both"]);
});

test("test_the_picker_sorts_its_names", async () => {
  await reset({ file_profiles: { zed: PROF([]) }, live_profiles: ["alpha"] });
  assert.deepEqual(savedProfiles.value, ["alpha", "zed"]);
});

test("test_a_staged_save_adds_its_name_to_the_picker", async () => {
  await reset({ file_profiles: { Old: PROF([ROW("-1")]) } });
  await stageProfileSave("New", [ROW("-2")]);
  assert.deepEqual(savedProfiles.value, ["New", "Old"]);
});

test("test_a_staged_delete_removes_the_name_from_the_picker", async () => {
  await reset({ file_profiles: { Old: PROF([ROW("-1")]), Kept: PROF([ROW("-2")]) } });
  await stageProfileDelete("Old");
  assert.deepEqual(savedProfiles.value, ["Kept"]);
});

test("test_a_corrupt_staged_save_is_treated_as_nothing_staged", async () => {
  await reset({ file_profiles: { Old: PROF([ROW("-1")]) } });
  await edit("matrix_profile_save", "{not json");
  assert.deepEqual(savedProfiles.value, ["Old"]);
});

test("test_the_daemon_list_falls_back_to_the_form_datalist", async () => {
  // no live_profiles (credentials kept the live list empty) — the /matrix form's
  // datalist options stand in, with the blank placeholder filtered out
  await reset({ profiles: { options: [{ value: "FormName" }, { value: "" }] } });
  assert.deepEqual(savedProfiles.value, ["FormName"]);
});

// --- isLiveProfile: what a live switch can reach -----------------------------------

test("test_a_daemon_known_profile_is_live_switchable", async () => {
  await reset({ live_profiles: ["Known"] });
  assert.equal(isLiveProfile("Known"), true);
});

test("test_a_profile_saved_this_session_is_not_live_switchable", async () => {
  // the daemon only knows what it read at startup
  await reset({ live_profiles: ["Known"] });
  await stageProfileSave("Fresh", [ROW("-1")]);
  assert.equal(isLiveProfile("Fresh"), false);
});

test("test_a_config_only_profile_is_not_live_switchable", async () => {
  await reset({ file_profiles: { FileOnly: PROF([ROW("-1")]) } });
  assert.equal(isLiveProfile("FileOnly"), false);
});

// --- profileRows: what a load would install -----------------------------------------

test("test_profile_rows_come_from_the_config_for_a_saved_profile", async () => {
  await reset({ file_profiles: { P: PROF([ROW("-9")]) } });
  assert.deepEqual(profileRows("P"), [ROW("-9")]);
});

test("test_a_staged_save_outranks_the_config_copy_of_the_same_profile", async () => {
  await reset({ file_profiles: { P: PROF([ROW("-9")]) } });
  await stageProfileSave("P", [ROW("-1")]);
  assert.deepEqual(profileRows("P"), [ROW("-1")]);
});

test("test_a_staged_save_does_not_leak_rows_into_another_profile", async () => {
  await reset({ file_profiles: { P: PROF([ROW("-9")]) } });
  await stageProfileSave("Other", [ROW("-1")]);
  assert.deepEqual(profileRows("P"), [ROW("-9")]);
});

test("test_a_daemon_only_profile_has_no_rows_to_stage", async () => {
  await reset({ live_profiles: ["DaemonOnly"] });
  assert.equal(profileRows("DaemonOnly"), null);
});

// --- matrixActiveProfile ---------------------------------------------------------------

test("test_the_active_profile_prefers_the_live_report", async () => {
  await reset({ live_active: "LiveName", active: "FormName" });
  assert.equal(matrixActiveProfile.value, "LiveName");
});

test("test_the_form_active_name_is_used_when_the_live_lane_is_silent", async () => {
  await reset({ active: "FormName" });
  assert.equal(matrixActiveProfile.value, "FormName");
});

test("test_the_default_placeholder_reads_as_default", async () => {
  await reset({ active: "[Default]" });
  assert.equal(matrixActiveProfile.value, "[Default]");
});

test("test_no_active_name_at_all_reads_as_default", async () => {
  await reset();
  assert.equal(matrixActiveProfile.value, "[Default]");
});
