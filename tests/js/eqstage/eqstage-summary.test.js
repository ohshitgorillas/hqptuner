// Behavioral suite for the human-facing summary eqstage prints on stderr:
// `table(report)`. Written blind from a spec block; no eqstage source was read.
//
// `table` takes a plain Report and returns a string, so most cases build the
// Report by hand from the documented shape (scripts/eqstage/README.md, "Answer")
// and read the summary back. The one case that needs the tool itself — a bad
// `preamp_db` rejecting before the POST — drives `runJob` through a wire fake
// serving the real `GET /api/config` shape. That fake is deliberately narrow:
// the rejection happens after the baseline read and before anything else, so a
// baseline responder is all the wire this file needs. The fuller fake in
// eqstage.test.js is not imported because importing a test file would rerun its
// tests.
//
// Not pinned here: the exact wording of any line. The spec states what each line
// must claim, not how it is phrased, so assertions anchor on the values that
// have to appear (a band count, a gain, a staged field name, the Apply control)
// and on lines being present or absent.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqstage/eqstage-summary.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { runJob, table } from "../../../scripts/eqstage/eqstage.js";

/**
 * @typedef {import("../../../scripts/eqstage/eqstage.js").Job} Job
 * @typedef {import("../../../scripts/eqstage/eqstage.js").Report} Report
 * @typedef {import("../../../scripts/eqstage/post.js").FetchImpl} FetchImpl
 */

// --- report fixtures ------------------------------------------------------------

const EQ_PROCESS = "iir:type=peak;f=5000;q=2;g=-4";

/**
 * One side of a row: what it carried before the edit, or after it.
 *
 * @param {number} bandCount
 * @param {string} [gain]
 * @returns {Report["rows"][number]["before"]}
 */
const facts = (bandCount, gain = "0.0") => ({
  band_count: bandCount,
  process: "iir:type=peak;f=1000;q=1;g=1",
  gain,
  gainunit: "dB",
});

/**
 * @param {number} index
 * @param {Partial<Report["rows"][number]>} [patch]
 * @returns {Report["rows"][number]}
 */
const row = (index, patch = {}) => ({
  index,
  selected: true,
  before: facts(1),
  after: facts(2),
  ...patch,
});

/**
 * A complete report, patched per case.
 *
 * @param {Partial<Report>} [patch]
 * @returns {Report}
 */
const report = (patch = {}) => ({
  baseline_source: "config",
  eq: { band_count: 1, process: EQ_PROCESS },
  preamp_db: null,
  rows: [row(0)],
  staged: { live: {}, http: { matrix_pipelines: "[]" } },
  posted: true,
  verified: true,
  dry_run: false,
  ...patch,
});

/**
 * @param {string} summary
 * @returns {number}
 */
const lineCount = (summary) => summary.split("\n").length;

/**
 * @param {string} summary
 * @param {string} needle
 * @returns {number}
 */
const occurrences = (summary, needle) => summary.split(needle).length - 1;

// --- wire fake for the runJob case ----------------------------------------------

const URL_BASE = "http://127.0.0.1:8090";

const BASELINE = JSON.stringify([
  { gain: "0", gainunit: "dB", mixdown: "0", process: "iir:type=peak;f=200;q=1;g=1", source: "0" },
]);

// The tool's declared fetch answers with a real Response, which this fake does
// not build; it is handed over as the injected implementation all the same.
/** @type {FetchImpl} */
const baselineFetch = /** @type {FetchImpl} */ (
  /** @type {unknown} */ (
    async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ data: { file: { matrix_pipelines: BASELINE } } }),
    })
  )
);

// --- which baseline the rows came from -------------------------------------------

test("test_a_config_baseline_summary_names_the_config_source", () => {
  const summary = table(report({ baseline_source: "config", staged: { live: {}, http: {} } }));
  assert.equal(summary.includes("config"), true);
});

test("test_a_matrix_baseline_summary_names_the_matrix_source", () => {
  const summary = table(report({ baseline_source: "matrix", staged: { live: {}, http: { filter: "sinc-L" } } }));
  assert.equal(summary.includes("matrix"), true);
});

// --- what the eq carries ---------------------------------------------------------

test("test_the_summary_states_how_many_bands_the_eq_carries", () => {
  const summary = table(report({ eq: { band_count: 7, process: EQ_PROCESS } }));
  assert.equal(/\b7\b/.test(summary), true);
});

test("test_the_summary_states_the_process_string_the_eq_serialises_to", () => {
  const summary = table(report({ eq: { band_count: 1, process: EQ_PROCESS } }));
  assert.equal(summary.includes(EQ_PROCESS), true);
});

// --- one line per row ------------------------------------------------------------

test("test_each_extra_row_in_the_report_adds_exactly_one_line_to_the_summary", () => {
  const one = table(report({ rows: [row(0)] }));
  const four = table(report({ rows: [row(0), row(1), row(2), row(3)] }));
  assert.equal(lineCount(four) - lineCount(one), 3);
});

// --- selection -------------------------------------------------------------------

test("test_a_selected_row_reads_differently_from_the_same_row_unselected", () => {
  const selected = table(report({ rows: [row(0, { selected: true })] }));
  const unselected = table(report({ rows: [row(0, { selected: false })] }));
  assert.notEqual(selected, unselected);
});

// --- band counts per row ---------------------------------------------------------

test("test_a_row_line_states_the_band_count_it_had_before_the_edit", () => {
  const summary = table(
    report({ eq: { band_count: 5, process: EQ_PROCESS }, rows: [row(0, { before: facts(11), after: facts(23) })] }),
  );
  assert.equal(/\b11\b/.test(summary), true);
});

test("test_a_row_line_states_the_band_count_it_has_after_the_edit", () => {
  const summary = table(
    report({ eq: { band_count: 5, process: EQ_PROCESS }, rows: [row(0, { before: facts(11), after: facts(23) })] }),
  );
  assert.equal(/\b23\b/.test(summary), true);
});

// --- gain ------------------------------------------------------------------------

test("test_a_row_whose_gain_is_unchanged_states_that_gain_once", () => {
  const same = row(0, { before: facts(1, "-3.5"), after: facts(2, "-3.5") });
  assert.equal(occurrences(table(report({ rows: [same] })), "-3.5"), 1);
});

test("test_a_row_whose_gain_changed_states_the_gain_it_had_before", () => {
  const changed = row(0, { before: facts(1, "-1.25"), after: facts(2, "-4.75") });
  assert.equal(table(report({ rows: [changed] })).includes("-1.25"), true);
});

test("test_a_row_whose_gain_changed_states_the_gain_it_has_after", () => {
  const changed = row(0, { before: facts(1, "-1.25"), after: facts(2, "-4.75") });
  assert.equal(table(report({ rows: [changed] })).includes("-4.75"), true);
});

// --- staged fields ---------------------------------------------------------------

test("test_the_summary_names_a_field_staged_in_the_http_half_of_the_payload", () => {
  const summary = table(report({ staged: { live: { volume: -20 }, http: { matrix_pipelines: "[]" } } }));
  assert.equal(summary.includes("matrix_pipelines"), true);
});

test("test_the_summary_names_a_field_staged_in_the_live_half_of_the_payload", () => {
  const summary = table(report({ staged: { live: { volume: -20 }, http: { matrix_pipelines: "[]" } } }));
  assert.equal(summary.includes("volume"), true);
});

// --- dry run ---------------------------------------------------------------------

test("test_a_dry_run_summary_reads_differently_from_a_run_that_staged_the_same_fields", () => {
  const staged = { live: {}, http: { matrix_pipelines: "[]" } };
  const dry = table(report({ dry_run: true, posted: false, verified: false, staged }));
  const wet = table(report({ dry_run: false, posted: false, verified: false, staged }));
  assert.notEqual(dry, wet);
});

// --- the buffer line -------------------------------------------------------------

test("test_a_run_that_reached_the_buffer_says_the_user_is_the_one_who_clicks_apply", () => {
  const summary = table(report({ posted: true, verified: true }));
  assert.equal(summary.includes("Apply"), true);
});

test("test_a_run_that_did_not_reach_the_buffer_omits_the_apply_line", () => {
  const summary = table(report({ posted: false, verified: false }));
  assert.equal(summary.includes("Apply"), false);
});

// --- runJob preamp validation ----------------------------------------------------

test("test_a_preamp_that_is_neither_a_number_nor_auto_is_rejected_naming_the_value_given", async () => {
  /** @type {Job} */
  const job = /** @type {Job} */ ({
    url: URL_BASE,
    eq: { bands: [{ type: "peak", f: 5000, q: 2, g: -4 }] },
    rows: [0],
    preamp_db: "loud",
  });
  await assert.rejects(() => runJob(job, { fetch: baselineFetch }), /loud/);
});
