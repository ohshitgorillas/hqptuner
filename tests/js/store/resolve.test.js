// Behavioral suite for store/resolve.js's three-tree resolution (`baseline`,
// reached through `effective`/`isDirty`). Written BEFORE the complexity
// refactor of it (11).
//
// It is not exported, and should not be: its contract is what the public
// functions return. Everything below drives it the way the app does, over the
// fake wire in tests/js/support/threetrees.js. No store function is stubbed.
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
import { setLive, edit, discardAll, stagePipelines } from "../../../hqptuner/static/store/actions.js";
import { ok, stagingWire } from "../support/wire/wire.js";
import { route, trees, field } from "../support/threetrees.js";

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

// --- baseline: the pipeline set ---------------------------------------------
//
// `matrix_pipelines` is the whole row set, staged atomically as one canonical
// JSON string. Its applied value has two possible sources: the config XML read
// back (`config.file.matrix_pipelines`) when management credentials exist, and
// the parsed rows on the /matrix form (`matrixConfig.rows`) when they do not —
// read-only mode has no file truth at all.
//
// `trees()` (tests/js/support/threetrees.js) seeds no /matrix ROWS, so these
// cases use the sibling helper: same full reset of every source signal, plus
// the rows, plus the real staging wire so `stagePipelines` rides the REST path
// rather than a fixed buffer.

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
