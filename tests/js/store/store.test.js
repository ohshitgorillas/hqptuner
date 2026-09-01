// Behavioral suite for the store core — store/resolve.js's three-tree resolution (`baseline`,
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

import { config, matrixConfig, engineState } from "../../../hqptuner/static/store/signals.js";
import {
  effective,
  isDirty,
  runningValue,
  effectivePipelines,
  stagedCount,
} from "../../../hqptuner/static/store/resolve.js";
import {
  setLive,
  edit,
  applyAll,
  lastApply,
  discardAll,
  stagePipelines,
} from "../../../hqptuner/static/store/actions.js";
import { ok, stagingWire } from "../support/wire.js";

/**
 * One /config or /matrix form field, as `field()` below builds it. `value` is a
 * union because the form answers a checkbox with a real bool and everything
 * else with a string.
 *
 * @typedef {{ name: string, value: string | boolean }} FormField
 */

/**
 * One matrix pipeline row: exactly five keys, every value a string.
 *
 * @typedef {{
 *   gain: string,
 *   gainunit: string,
 *   mixdown: string,
 *   process: string,
 *   source: string,
 * }} PipelineRow
 */

/**
 * The globals a fake wire installs a `fetch` on, viewed as an optional member:
 * the DOM lib declares it returning a real `Response`, which these fakes do not
 * build.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

// Fake wire. `apply` is the body /api/config/apply answers with; every other
// path gets a minimal valid response so the surrounding flow completes.
/** @param {{ apply?: unknown, staged?: { live: unknown, http: unknown } }} [seams] */
function route({ apply = {}, staged = { live: {}, http: {} } } = {}) {
  env.fetch = async (/** @type {string} */ path) => {
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
/**
 * @param {{
 *   fields?: FormField[],
 *   file?: Record<string, string>,
 *   matrix?: FormField[],
 *   engine?: Record<string, string>,
 * }} [trees]
 */
async function trees({ fields = [], file = {}, matrix = [], engine = {} } = {}) {
  engineState.value = engine;
  config.value = { fields, file, active: "" };
  matrixConfig.value = { fields: matrix, active: "[Default]" };
  route();
  await discardAll();
}

/**
 * @param {string} name
 * @param {string | boolean} value
 * @returns {FormField}
 */
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

// The verdict's `code` and the data fields beside it are what these read; the
// sentence built from them is owner copy (docs/testing.md rule 9).

/**
 * The verdict the last apply recorded. `lastApply.value` is nullable by design,
 * so that a verdict field that does not exist stops type-checking clean;
 * reading a field off it needs narrowing, and a case whose apply recorded
 * nothing has lost its own premise rather than its assertion. Refusing here
 * keeps that separate from the one assertion each case is allowed.
 *
 * @param {typeof lastApply} signal
 * @returns {NonNullable<typeof lastApply.value>}
 */
function verdict(signal) {
  if (signal.value === null) throw new Error("expected an apply verdict, none was recorded");
  return signal.value;
}

test("test_a_failed_live_setting_is_reported_by_name", async () => {
  await trees();
  route({ apply: { live: [{ setting: "filter", ok: false }] } });
  await applyAll();
  assert.deepEqual(verdict(lastApply).settings, ["filter"]);
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
  assert.deepEqual(verdict(lastApply).settings, ["a", "b"]);
});

test("test_a_live_failure_outranks_a_failed_switch_and_a_failed_save", async () => {
  await trees();
  route({
    apply: { live: [{ setting: "a", ok: false }], switched: { name: "N", active: false }, saved: { ok: false } },
  });
  await applyAll();
  assert.equal(verdict(lastApply).code, "live-failed");
});

// A failed live entry may carry the setter's error `code` (a wire identifier).
// `daemon_unavailable` anywhere in the report is a different verdict from a
// refusal; a report carrying only `daemon_refused`, or no code at all, is the
// plain live failure the cases above pin.

test("test_any_unavailable_live_failure_yields_live_unavailable_and_refused_or_uncoded_keep_live_failed", async () => {
  await trees();
  const codes = [];
  route({
    apply: {
      live: [
        { setting: "a", ok: false, code: "daemon_refused" },
        { setting: "b", ok: false, code: "daemon_unavailable" },
      ],
    },
  });
  await applyAll();
  codes.push(verdict(lastApply).code);
  route({ apply: { live: [{ setting: "a", ok: false, code: "daemon_refused" }] } });
  await applyAll();
  codes.push(verdict(lastApply).code);
  route({ apply: { live: [{ setting: "a", ok: false }] } });
  await applyAll();
  codes.push(verdict(lastApply).code);
  assert.deepEqual(codes, ["live-unavailable", "live-failed", "live-failed"]);
});

test("test_live_unavailable_lists_every_failed_setter_refused_ones_included_in_report_order", async () => {
  await trees();
  // the refused one comes first, so a verdict keyed on the first failure alone
  // would read this report as a plain live failure
  route({
    apply: {
      live: [
        { setting: "a", ok: false, code: "daemon_refused" },
        { setting: "b", ok: false, code: "daemon_unavailable" },
        { setting: "c", ok: true },
      ],
    },
  });
  await applyAll();
  assert.deepEqual([verdict(lastApply).code, verdict(lastApply).settings], ["live-unavailable", ["a", "b"]]);
});

test("test_a_failed_apply_is_not_ok", async () => {
  await trees();
  route({ apply: { live: [{ setting: "filter", ok: false }] } });
  await applyAll();
  assert.equal(verdict(lastApply).ok, false);
});

// --- summarize: the switch --------------------------------------------------

test("test_a_switch_that_did_not_take_is_reported_as_a_failed_switch", async () => {
  await trees();
  route({ apply: { switched: { name: "Night", active: false } } });
  await applyAll();
  assert.equal(verdict(lastApply).code, "switch-failed");
});

test("test_a_failed_switch_names_the_preset_it_could_not_reach", async () => {
  await trees();
  route({ apply: { switched: { name: "Night", active: false } } });
  await applyAll();
  assert.equal(verdict(lastApply).preset, "Night");
});

test("test_a_successful_switch_is_reported_as_switched", async () => {
  await trees();
  route({ apply: { switched: { name: "Night", active: true } } });
  await applyAll();
  assert.equal(verdict(lastApply).code, "switched");
});

// Unloading the active preset switches to the nameless "(no preset)" option: an
// empty name is a real switch and must not degrade the verdict.
test("test_a_switch_to_the_nameless_preset_still_reads_as_switched", async () => {
  await trees();
  route({ apply: { switched: { name: "", active: true } } });
  await applyAll();
  assert.equal(verdict(lastApply).code, "switched");
});

// --- summarize: the persistent lane -----------------------------------------

test("test_a_missing_endpoint_is_named_rather_than_reported_generically", async () => {
  await trees();
  route({ apply: { persistent: { applied: false, unfixable: { net_device: { want: "NAA1" } }, error: "e" } } });
  await applyAll();
  assert.equal(verdict(lastApply).endpoint, "NAA1");
});

test("test_a_missing_endpoint_outranks_the_generic_error_beside_it", async () => {
  await trees();
  route({ apply: { persistent: { applied: false, unfixable: { net_device: { want: "NAA1" } }, error: "e" } } });
  await applyAll();
  assert.equal(verdict(lastApply).code, "endpoint-missing");
});

test("test_a_persistent_error_is_reported_as_an_error", async () => {
  await trees();
  route({ apply: { persistent: { applied: false, error: "boom" } } });
  await applyAll();
  assert.equal(verdict(lastApply).code, "persist-error");
});

// The daemon's own reason is the only thing that tells the user what went
// wrong, so it must survive the trip to the caption. The test invents it, which
// is why asserting it back pins no shipped wording.
test("test_the_daemons_own_error_reaches_the_user", async () => {
  await trees();
  route({ apply: { persistent: { applied: false, error: "boom" } } });
  await applyAll();
  assert.ok(String(verdict(lastApply).text).includes("boom"));
});

test("test_a_persistent_refusal_reports_its_reason", async () => {
  await trees();
  route({ apply: { persistent: { applied: false, reason: "timeout" } } });
  await applyAll();
  assert.equal(verdict(lastApply).reason, "timeout");
});

// "unconverged" alone is undebuggable: it says a setting the daemon kept
// refusing exists, but not which one — and the user is the only one who can see
// their own config.
test("test_an_unconverged_apply_names_the_fields_that_diverged", async () => {
  await trees();
  route({ apply: { persistent: { applied: false, reason: "unconverged", diff: { volume_max: {}, alsa_dop: {} } } } });
  await applyAll();
  assert.deepEqual(verdict(lastApply).fields, ["volume_max", "alsa_dop"]);
});

test("test_a_persistent_refusal_with_no_reason_is_still_a_refusal", async () => {
  await trees();
  route({ apply: { persistent: { applied: false } } });
  await applyAll();
  assert.equal(verdict(lastApply).code, "persist-refused");
});

// --- summarize: change counts -----------------------------------------------

test("test_an_apply_with_nothing_staged_counts_no_changes", async () => {
  await trees();
  await discardAll();
  route({ apply: {} });
  await applyAll();
  assert.equal(verdict(lastApply).changes, 0);
});

test("test_a_single_change_is_counted_as_one", async () => {
  await trees({ fields: [field("volume_max", "-3")] });
  route({ staged: { live: {}, http: { volume_max: "-6" } } });
  await edit("volume_max", "-6");
  route({ apply: {}, staged: { live: {}, http: { volume_max: "-6" } } });
  await applyAll();
  assert.equal(verdict(lastApply).changes, 1);
});

test("test_a_switch_and_edits_are_reported_together", async () => {
  await trees({ fields: [field("volume_max", "-3")] });
  route({ staged: { live: {}, http: { volume_max: "-6" } } });
  await edit("volume_max", "-6");
  route({ apply: { switched: { name: "N", active: true } }, staged: { live: {}, http: { volume_max: "-6" } } });
  await applyAll();
  assert.deepEqual([verdict(lastApply).code, verdict(lastApply).changes], ["switched", 1]);
});

// --- summarize: the save lane -----------------------------------------------

// A save rides its own axis on the verdict, because an apply and a save can end
// differently and one code cannot carry both.

test("test_a_successful_save_rides_alongside_the_apply", async () => {
  await trees();
  await discardAll();
  route({ apply: { saved: { ok: true, name: "P" } } });
  await applyAll();
  assert.equal(verdict(lastApply).save, "ok");
});

test("test_a_failed_save_is_appended_and_makes_the_apply_not_ok", async () => {
  await trees();
  await discardAll();
  route({ apply: { saved: { ok: false, name: "P", error: "disk" } } });
  await applyAll();
  assert.equal(verdict(lastApply).ok, false);
});

test("test_a_failed_save_is_reported_as_failed", async () => {
  await trees();
  await discardAll();
  route({ apply: { saved: { ok: false, name: "P", error: "disk" } } });
  await applyAll();
  assert.equal(verdict(lastApply).save, "failed");
});

// A failed save decorates the base verdict rather than replacing it: the
// sentence is the base apply's own sentence plus the save failure, and the
// code stays the base outcome's. The base sentence is read off a save-free run
// of the same apply, so no owner wording is pinned — only the composition.

// As with the persistent lane's daemon error above: the error string is
// test-invented, so asserting it back pins no shipped wording.
test("test_the_save_errors_own_text_reaches_the_user", async () => {
  await trees();
  await discardAll();
  route({ apply: { saved: { ok: false, name: "P", error: "disk" } } });
  await applyAll();
  assert.ok(String(verdict(lastApply).text).includes("disk"));
});

test("test_a_failed_save_keeps_the_applied_code", async () => {
  await trees();
  await discardAll();
  route({ apply: { saved: { ok: false, name: "P", error: "disk" } } });
  await applyAll();
  assert.equal(verdict(lastApply).code, "applied");
});

test("test_a_failed_save_keeps_the_switched_code", async () => {
  await trees();
  await discardAll();
  route({ apply: { switched: { name: "N", active: true }, saved: { ok: false, name: "P", error: "disk" } } });
  await applyAll();
  assert.equal(verdict(lastApply).code, "switched");
});

// A WARNED save is a save: only hqplayerd's own mirror of the preset is behind,
// so the caveat rides a success rather than turning it into a failure. Reporting
// it as failed is what sent a user hunting for a preset already on disk.

test("test_a_warned_save_is_reported_as_warned", async () => {
  await trees();
  await discardAll();
  route({ apply: { saved: { ok: true, name: "P", warning: "list not updated" } } });
  await applyAll();
  assert.equal(verdict(lastApply).save, "warned");
});

test("test_a_warned_save_is_still_ok", async () => {
  await trees();
  await discardAll();
  route({ apply: { saved: { ok: true, name: "P", warning: "list not updated" } } });
  await applyAll();
  assert.equal(verdict(lastApply).ok, true);
});

// --- summarize: transport failure -------------------------------------------

test("test_a_rejected_apply_request_is_reported_rather_than_swallowed", async () => {
  await trees();
  env.fetch = async (/** @type {string} */ path) => {
    if (path === "/api/config/apply") return { ok: false, status: 503, json: async () => ({}) };
    return ok({});
  };
  await assert.rejects(() => applyAll());
});

// --- baseline: the pipeline set ---------------------------------------------
//
// `matrix_pipelines` is the whole row set, staged atomically as one canonical
// JSON string. Its applied value has two possible sources: the config XML read
// back (`config.file.matrix_pipelines`) when management credentials exist, and
// the parsed rows on the /matrix form (`matrixConfig.rows`) when they do not —
// read-only mode has no file truth at all.
//
// `trees()` above seeds no /matrix ROWS, so these cases use the sibling helper:
// same full reset of every source signal, plus the rows, plus the real staging
// wire so `stagePipelines` rides the REST path rather than a fixed buffer.

/** @param {{ file?: Record<string, string>, rows?: PipelineRow[] }} [trees] */
async function pipeTrees({ file = {}, rows = undefined } = {}) {
  engineState.value = {};
  config.value = { fields: [], file, active: "" };
  matrixConfig.value = { fields: [], rows, active: "[Default]" };
  stagingWire({
    routes: (/** @type {string} */ path) => {
      if (path === "/api/config") return ok({ data: config.value });
      if (path === "/api/matrix") return ok({ data: matrixConfig.value });
      if (path === "/api/enumerations") return ok({ data: null });
      return undefined;
    },
  });
  await discardAll();
}

// A pipeline row carries exactly five keys; `gainunit` defaults to dB, the rest
// to the wire's own defaults.
/**
 * @param {Partial<PipelineRow>} [patch]
 * @returns {PipelineRow}
 */
const ROW = (patch) => ({ gain: "0", gainunit: "dB", mixdown: "0", process: "", source: "0", ...patch });
// The backend's own serialization of `[ROW({gain: "-6"})]`, written out by hand:
// alphabetical keys, compact, every value a string.
const FILE_ROWS = '[{"gain":"-6","gainunit":"dB","mixdown":"0","process":"","source":"0"}]';

test("test_pipelines_with_file_truth_and_nothing_staged_are_not_dirty", async () => {
  await pipeTrees({ file: { matrix_pipelines: FILE_ROWS } });
  assert.equal(isDirty("matrix_pipelines"), false);
});

// Read-only mode has no file to compare against; falling back to the /matrix
// rows is what keeps it from reporting a permanent pending change nobody made.
test("test_pipelines_with_only_the_matrix_rows_and_nothing_staged_are_not_dirty", async () => {
  await pipeTrees({ rows: [ROW({ gain: "-6" })] });
  assert.equal(isDirty("matrix_pipelines"), false);
});

test("test_pipelines_with_neither_file_truth_nor_matrix_rows_are_not_dirty", async () => {
  await pipeTrees();
  assert.equal(isDirty("matrix_pipelines"), false);
});

test("test_staging_rows_that_differ_from_the_matrix_rows_reads_dirty", async () => {
  await pipeTrees({ rows: [ROW({ gain: "-6" })] });
  await stagePipelines([ROW({ gain: "-3" })]);
  assert.equal(isDirty("matrix_pipelines"), true);
});

test("test_staging_the_matrix_rows_unchanged_reads_clean", async () => {
  await pipeTrees({ rows: [ROW({ gain: "-6" })] });
  await stagePipelines([ROW({ gain: "-6" })]);
  assert.equal(isDirty("matrix_pipelines"), false);
});

// The compare is over the canonical serialization — alphabetical keys, all
// values strings — never the literal row objects.
test("test_staging_the_matrix_rows_with_the_keys_in_another_order_reads_clean", async () => {
  await pipeTrees({ rows: [ROW({ gain: "-6" })] });
  await stagePipelines([{ source: "0", process: "", mixdown: "0", gainunit: "dB", gain: "-6" }]);
  assert.equal(isDirty("matrix_pipelines"), false);
});

test("test_staging_the_matrix_rows_with_numeric_values_reads_clean", async () => {
  await pipeTrees({ rows: [ROW({ gain: "-6" })] });
  await stagePipelines([{ gain: -6, gainunit: "dB", mixdown: 0, process: "", source: 0 }]);
  assert.equal(isDirty("matrix_pipelines"), false);
});

test("test_staging_rows_that_differ_from_the_file_rows_reads_dirty", async () => {
  await pipeTrees({ file: { matrix_pipelines: FILE_ROWS } });
  await stagePipelines([ROW({ gain: "-3" })]);
  assert.equal(isDirty("matrix_pipelines"), true);
});

test("test_the_effective_pipelines_are_the_matrix_rows_when_the_file_is_silent", async () => {
  const rows = [ROW({ gain: "-6" }), ROW({ source: "1", mixdown: "1" })];
  await pipeTrees({ rows });
  assert.equal(effectivePipelines.value[1].source, "1");
});

test("test_a_dirty_pipeline_edit_is_counted_as_a_staged_change", async () => {
  await pipeTrees({ rows: [ROW({ gain: "-6" })] });
  await stagePipelines([ROW({ gain: "-3" })]);
  assert.equal(stagedCount.value, 1);
});

test("test_a_pipeline_edit_that_reads_clean_is_not_counted_as_a_staged_change", async () => {
  await pipeTrees({ rows: [ROW({ gain: "-6" })] });
  await stagePipelines([ROW({ gain: "-6" })]);
  assert.equal(stagedCount.value, 0);
});
