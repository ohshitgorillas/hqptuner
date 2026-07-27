// Behavioral suite for store/state.js — the three-tree resolution (`baseline`,
// reached through `effective`/`isDirty`) and the apply summary (`summarize`,
// reached through `applyAll`). Written BEFORE the complexity refactor of those
// two (11 and 19).
//
// Neither is exported, and neither should be: their contracts are what the
// public functions return. Everything below drives them the way the app does.
//
// The wire is faked, not the store. `route()` installs a globalThis.fetch that
// answers the real REST paths (lib/api.js) with real response shapes — the
// docs/testing.md rule-4 route. No store function is stubbed.
//
// Schema facts this leans on, verified against store/schema.js:
//   adaptive_volume is the ONLY lane:"live" key (stateField "adaptive").
//   optimal_iso, matrix_pipelines and fixed_volume are the fileTruth keys.
//   matrix_engine carries endpoint:"matrix" + formField:"engine" — it reads its
//   baseline from the /matrix form under the BARE name, never from /config.

import test from "node:test";
import assert from "node:assert/strict";

import {
  effective,
  isDirty,
  runningValue,
  setLive,
  edit,
  applyAll,
  lastApply,
  discardAll,
  config,
  matrixConfig,
  engineState,
} from "../../hqptuner/static/store/state.js";
import { ok } from "./wire.js";

// Fake wire. `apply` is the body /api/config/apply answers with; every other
// path gets a minimal valid response so the surrounding flow completes.
function route({ apply = {}, staged = { live: {}, http: {} } } = {}) {
  globalThis.fetch = async (path) => {
    if (path === "/api/config/apply") return ok(apply);
    if (path === "/api/config/stage") return ok(staged);
    if (path === "/api/config/pending") return ok(staged);
    if (path === "/api/config") return ok({ data: config.value });
    if (path === "/api/matrix") return ok({ data: matrixConfig.value });
    if (path === "/api/enumerations") return ok({ data: null });
    return ok({});
  };
}

// A clean three-tree baseline. Every source signal is reassigned, not just the
// ones a case cares about — module-level signals outlive a test.
async function trees({ fields = [], file = {}, matrix = [], engine = {} } = {}) {
  engineState.value = engine;
  config.value = { fields, file, active: "" };
  matrixConfig.value = { fields: matrix, active: "[Default]" };
  route();
  await discardAll();
}

const field = (name, value) => ({ name, value });

// --- baseline: the live lane ------------------------------------------------

test("test_a_live_control_reads_its_value_from_the_engine_state", async () => {
  await trees({ engine: { adaptive: "1" } });
  assert.equal(effective("adaptive_volume"), "1");
});

test("test_a_live_control_with_no_engine_state_is_undefined", async () => {
  await trees({ engine: {} });
  assert.equal(effective("adaptive_volume"), undefined);
});

test("test_a_live_control_ignores_the_config_form_entirely", async () => {
  // the live lane never consults the http trees, even when they carry the name
  await trees({ engine: {}, fields: [field("adaptive", "9")] });
  assert.equal(effective("adaptive_volume"), undefined);
});

// --- baseline: the http form ------------------------------------------------

test("test_an_http_control_reads_its_value_from_the_config_form", async () => {
  await trees({ fields: [field("volume_max", "-3")] });
  assert.equal(effective("volume_max"), "-3");
});

test("test_an_http_control_missing_from_the_form_is_undefined", async () => {
  await trees({ fields: [] });
  assert.equal(effective("volume_max"), undefined);
});

test("test_an_unknown_control_key_is_undefined", async () => {
  await trees();
  assert.equal(effective("no_such_control"), undefined);
});

// --- baseline: file truth ---------------------------------------------------

test("test_a_file_truth_control_prefers_the_config_file_over_the_form", async () => {
  // volume_fixed is 0/1/2 in the XML but a bare checkbox on the form, so the
  // form cannot express -6 dB and the file has to win
  await trees({ fields: [field("volume_fixed", true)], file: { volume_fixed: "2" } });
  assert.equal(effective("optimal_iso"), "2");
});

test("test_a_file_truth_control_falls_back_to_the_form_when_the_file_is_silent", async () => {
  await trees({ fields: [field("volume_fixed", "2")], file: {} });
  assert.equal(effective("optimal_iso"), "2");
});

test("test_a_file_truth_fallback_normalizes_a_checked_form_box_into_the_xml_domain", async () => {
  await trees({ fields: [field("volume_fixed", true)], file: {} });
  assert.equal(effective("optimal_iso"), "1");
});

test("test_a_file_truth_fallback_normalizes_an_unchecked_form_box", async () => {
  await trees({ fields: [field("volume_fixed", false)], file: {} });
  assert.equal(effective("optimal_iso"), "0");
});

test("test_the_fixed_volume_level_reads_the_file_rather_than_the_daemon_form", async () => {
  // while fixed volume is OFF the daemon's form offers its OWN remembered level;
  // the user's is parked in a commented <fixed> line the file lane reads back, so
  // the file has to win or the box shows a number the user never typed
  await trees({ fields: [field("fixed_volume", "-3")], file: { fixed_volume: "-20" } });
  assert.equal(effective("fixed_volume"), "-20");
});

test("test_a_file_truth_control_reads_the_file_even_with_no_form_field_at_all", async () => {
  await trees({ fields: [], file: { volume_fixed: "2" } });
  assert.equal(effective("optimal_iso"), "2");
});

// --- baseline: the matrix form ----------------------------------------------

test("test_a_matrix_control_reads_the_matrix_form_under_its_bare_name", async () => {
  await trees({ matrix: [field("engine", "IIR")] });
  assert.equal(effective("matrix_engine"), "IIR");
});

test("test_a_matrix_control_ignores_a_same_named_field_on_the_config_form", async () => {
  await trees({ fields: [field("matrix_engine", "WRONG")], matrix: [field("engine", "IIR")] });
  assert.equal(effective("matrix_engine"), "IIR");
});

// --- effective: precedence --------------------------------------------------

test("test_a_live_drag_override_outranks_everything", async () => {
  await trees({ fields: [field("volume_max", "-3")] });
  setLive("volume_max", "-9");
  assert.equal(effective("volume_max"), "-9");
});

test("test_a_staged_edit_outranks_the_baseline", async () => {
  await trees({ fields: [field("volume_max", "-3")] });
  route({ staged: { live: {}, http: { volume_max: "-6" } } });
  await edit("volume_max", "-6");
  assert.equal(effective("volume_max"), "-6");
});

test("test_the_running_value_ignores_a_staged_edit", async () => {
  await trees({ fields: [field("volume_max", "-3")] });
  route({ staged: { live: {}, http: { volume_max: "-6" } } });
  await edit("volume_max", "-6");
  assert.equal(runningValue("volume_max"), "-3");
});

// --- isDirty ----------------------------------------------------------------

test("test_an_unstaged_control_is_not_dirty", async () => {
  await trees({ fields: [field("volume_max", "-3")] });
  assert.equal(isDirty("volume_max"), false);
});

test("test_a_staged_change_reads_as_dirty", async () => {
  await trees({ fields: [field("volume_max", "-3")] });
  route({ staged: { live: {}, http: { volume_max: "-6" } } });
  await edit("volume_max", "-6");
  assert.equal(isDirty("volume_max"), true);
});

test("test_a_staged_value_equal_to_the_baseline_is_not_dirty", async () => {
  await trees({ fields: [field("volume_max", "-3")] });
  route({ staged: { live: {}, http: { volume_max: "-3" } } });
  await edit("volume_max", "-3");
  assert.equal(isDirty("volume_max"), false);
});

test("test_a_checkbox_staged_as_one_against_a_true_baseline_is_not_dirty", async () => {
  // the domains differ — config gives a bool, staging gives "1"/"0" — so the
  // comparison happens in the control's own domain
  await trees({ fields: [field("quick_pause", true)] });
  route({ staged: { live: {}, http: { quick_pause: "1" } } });
  await edit("quick_pause", "1");
  assert.equal(isDirty("quick_pause"), false);
});

test("test_a_checkbox_staged_as_zero_against_a_true_baseline_is_dirty", async () => {
  await trees({ fields: [field("quick_pause", true)] });
  route({ staged: { live: {}, http: { quick_pause: "0" } } });
  await edit("quick_pause", "0");
  assert.equal(isDirty("quick_pause"), true);
});

// --- summarize: failures outrank everything ---------------------------------

test("test_a_failed_live_setting_is_reported_by_name", async () => {
  await trees();
  route({ apply: { live: [{ setting: "filter", ok: false }] } });
  await applyAll();
  assert.equal(lastApply.value.text, "Failed: filter");
});

test("test_several_failed_live_settings_are_listed", async () => {
  await trees();
  route({
    apply: {
      live: [
        { setting: "a", ok: false },
        { setting: "b", ok: false },
        { setting: "c", ok: true },
      ],
    },
  });
  await applyAll();
  assert.equal(lastApply.value.text, "Failed: a, b");
});

test("test_a_live_failure_outranks_a_failed_switch_and_a_failed_save", async () => {
  await trees();
  route({
    apply: { live: [{ setting: "a", ok: false }], switched: { name: "N", active: false }, saved: { ok: false } },
  });
  await applyAll();
  assert.equal(lastApply.value.text, "Failed: a");
});

test("test_a_failed_apply_is_not_ok", async () => {
  await trees();
  route({ apply: { live: [{ setting: "filter", ok: false }] } });
  await applyAll();
  assert.equal(lastApply.value.ok, false);
});

// --- summarize: the switch --------------------------------------------------

test("test_a_switch_that_did_not_take_is_reported", async () => {
  await trees();
  route({ apply: { switched: { name: "Night", active: false } } });
  await applyAll();
  assert.equal(lastApply.value.text, 'Switch to "Night" did not take');
});

test("test_a_successful_switch_is_reported", async () => {
  await trees();
  route({ apply: { switched: { name: "Night", active: true } } });
  await applyAll();
  assert.equal(lastApply.value.text, 'Switched to "Night"');
});

// Unloading the active preset switches to the nameless "(no preset)" option, so
// quoting the switch target as a preset name printed `Switched to ""`.
test("test_a_switch_to_the_nameless_preset_is_reported_as_no_preset", async () => {
  await trees();
  route({ apply: { switched: { name: "", active: true } } });
  await applyAll();
  assert.equal(lastApply.value.text, "Switched to (no preset)");
});

// --- summarize: the persistent lane -----------------------------------------

test("test_a_missing_endpoint_is_named_rather_than_reported_generically", async () => {
  await trees();
  route({ apply: { persistent: { applied: false, unfixable: { net_device: { want: "NAA1" } }, error: "e" } } });
  await applyAll();
  assert.equal(lastApply.value.text, 'Endpoint "NAA1" not present — config not applied');
});

test("test_a_persistent_error_is_reported_verbatim", async () => {
  await trees();
  route({ apply: { persistent: { applied: false, error: "boom" } } });
  await applyAll();
  assert.equal(lastApply.value.text, "Config not applied: boom");
});

test("test_a_persistent_refusal_reports_its_reason", async () => {
  await trees();
  route({ apply: { persistent: { applied: false, reason: "timeout" } } });
  await applyAll();
  assert.equal(lastApply.value.text, "Config not applied (timeout)");
});

// "unconverged" alone is undebuggable: it says a setting the daemon kept
// refusing exists, but not which one — and the user is the only one who can see
// their own config.
test("test_an_unconverged_apply_names_the_fields_that_diverged", async () => {
  await trees();
  route({ apply: { persistent: { applied: false, reason: "unconverged", diff: { volume_max: {}, alsa_dop: {} } } } });
  await applyAll();
  assert.equal(lastApply.value.text, "Config not applied (unconverged): volume_max, alsa_dop");
});

test("test_a_persistent_refusal_with_no_reason_reads_as_unconfirmed", async () => {
  await trees();
  route({ apply: { persistent: { applied: false } } });
  await applyAll();
  assert.equal(lastApply.value.text, "Config not applied (unconfirmed)");
});

// --- summarize: change counts -----------------------------------------------

test("test_an_apply_with_nothing_staged_says_so", async () => {
  await trees();
  await discardAll();
  route({ apply: {} });
  await applyAll();
  assert.equal(lastApply.value.text, "Applied no changes");
});

test("test_a_single_change_is_reported_in_the_singular", async () => {
  await trees({ fields: [field("volume_max", "-3")] });
  route({ staged: { live: {}, http: { volume_max: "-6" } } });
  await edit("volume_max", "-6");
  route({ apply: {}, staged: { live: {}, http: { volume_max: "-6" } } });
  await applyAll();
  assert.equal(lastApply.value.text, "Applied 1 change");
});

test("test_a_switch_and_edits_are_reported_together", async () => {
  await trees({ fields: [field("volume_max", "-3")] });
  route({ staged: { live: {}, http: { volume_max: "-6" } } });
  await edit("volume_max", "-6");
  route({ apply: { switched: { name: "N", active: true } }, staged: { live: {}, http: { volume_max: "-6" } } });
  await applyAll();
  assert.equal(lastApply.value.text, 'Switched to "N" + 1 change');
});

// --- summarize: the save lane -----------------------------------------------

test("test_a_successful_save_is_appended", async () => {
  await trees();
  await discardAll();
  route({ apply: { saved: { ok: true, name: "P" } } });
  await applyAll();
  assert.equal(lastApply.value.text, 'Applied no changes · saved to "P"');
});

test("test_a_failed_save_is_appended_and_makes_the_apply_not_ok", async () => {
  await trees();
  await discardAll();
  route({ apply: { saved: { ok: false, name: "P", error: "disk" } } });
  await applyAll();
  assert.equal(lastApply.value.ok, false);
});

test("test_a_failed_save_names_the_preset_and_the_error", async () => {
  await trees();
  await discardAll();
  route({ apply: { saved: { ok: false, name: "P", error: "disk" } } });
  await applyAll();
  assert.equal(lastApply.value.text, 'Applied no changes — save to "P" failed: disk');
});

// A WARNED save is a save: only hqplayerd's own mirror of the preset is behind,
// so the caveat rides a success rather than turning it into a failure. Reporting
// it as failed is what sent a user hunting for a preset already on disk.

test("test_a_warned_save_carries_its_caveat_in_the_text", async () => {
  await trees();
  await discardAll();
  route({ apply: { saved: { ok: true, name: "P", warning: "list not updated" } } });
  await applyAll();
  assert.equal(lastApply.value.text, 'Applied no changes · saved to "P" — list not updated');
});

test("test_a_warned_save_is_still_ok", async () => {
  await trees();
  await discardAll();
  route({ apply: { saved: { ok: true, name: "P", warning: "list not updated" } } });
  await applyAll();
  assert.equal(lastApply.value.ok, true);
});

// --- summarize: transport failure -------------------------------------------

test("test_a_rejected_apply_request_is_reported_rather_than_swallowed", async () => {
  await trees();
  globalThis.fetch = async (path) => {
    if (path === "/api/config/apply") return { ok: false, status: 503, json: async () => ({}) };
    return ok({});
  };
  await assert.rejects(() => applyAll());
});
