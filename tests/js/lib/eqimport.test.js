// Behavioral suite for lib/eqimport.js — AutoEq / REW text import.
//
// `parseEqText` is the parse half. `planEqImport` is the decision half, lifted
// out of MatrixTab's `doImport` (complexity 17) so it can be exercised as what
// it always was: a pure function of the pipeline rows, the import text, the
// target row, and the crossfeed block recognized at rows 1–8. `doImport` is now
// a wrapper that reads the module-private import signals and calls it — the
// wrapper holds no decisions, so nothing behavioral is left behind it.
//
// Policy (docs/testing.md): public API only, one assertion per test, no case
// targets a private helper — the per-path planners the complexity fix creates
// are covered exclusively through `planEqImport`. Block-path results are
// re-recognized with the public `msRecognize` rather than compared to a hand-
// written gain string: what the import must preserve is a RECOGNIZABLE block,
// not a particular float rendering.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/eqimport.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { parseEqText, planEqImport } from "../../../hqptuner/static/lib/eqimport.js";
import { msCompile, msRecognize, fitComp } from "../../../hqptuner/static/lib/xfeed.js";
import { compileRows } from "../../../hqptuner/static/lib/binaural/compile.js";
import { HEAD_RADIUS } from "../../../hqptuner/static/lib/binaural/geometry.js";
import { recognizeRows } from "../../../hqptuner/static/lib/binaural/recognize.js";

// One filter and a preamp — the smallest complete AutoEq profile.
const EQ = "Preamp: -6.4 dB\nFilter 1: ON PK Fc 105 Hz Gain -3.2 dB Q 1.41";
const EQ_NO_PREAMP = "Filter 1: ON PK Fc 105 Hz Gain -3.2 dB Q 1.41";
// What that filter serializes to in the pipeline chain.
const ADDED = "iir:type=peak;f=105;q=1.41;g=-3.2";

/**
 * @typedef {import("../../../hqptuner/static/lib/matrixspec.js").PipelineRow} PipelineRow
 * @typedef {import("../../../hqptuner/static/lib/eqimport.js").ImportOpts} ImportOpts
 * @typedef {import("../../../hqptuner/static/lib/eqimport.js").ImportPlan} ImportPlan
 * @typedef {import("../../../hqptuner/static/lib/xfeed.js").MsRecognition} MsRecognition
 * @typedef {import("../../../hqptuner/static/lib/binaural/recognize.js").StructuralRecognition} StructuralRecognition
 * @typedef {{ fc: number, feed: number }} Bauer
 */

/**
 * @param {Partial<PipelineRow>} patch
 * @returns {PipelineRow}
 */
const ROW = (patch) => ({ source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: "", ...patch });
const PAIR = [ROW({ source: "0", mixdown: "0" }), ROW({ source: "1", mixdown: "1" })];

// Options carry no defaults — every caller states its intent.
/**
 * @param {Partial<ImportOpts>} patch
 * @returns {ImportOpts}
 */
const opts = (patch) => ({ text: EQ, replace: false, mirror: false, block: null, ...patch });

/** @type {Bauer} */
const BAUER = { fc: 700, feed: 4.5 };
/** @type {Bauer} */
const OTHER = { fc: 650, feed: 9.5 };
// A compiled compensation block for the In 1 / In 2 pair, at 100%.
/**
 * @param {string} eq
 * @param {number} preampDb
 * @param {Bauer} [bauer]
 * @returns {PipelineRow[]}
 */
const block = (eq, preampDb, bauer = BAUER) =>
  msCompile(eq, preampDb, { fit: fitComp(bauer.fc, bauer.feed), s: 1 }, { a: 0, b: 1 });
/**
 * @param {PipelineRow[]} rows
 * @param {Bauer} [bauer]
 * @returns {MsRecognition | null}
 */
const recognized = (rows, bauer = BAUER) => msRecognize(rows, 0, bauer.fc, bauer.feed);
// Plan an import into a compiled block, recognizing it the way the tab does.
/**
 * @param {PipelineRow[]} rows
 * @param {number} targetIndex
 * @param {Partial<ImportOpts>} patch
 * @returns {ImportPlan}
 */
const intoBlock = (rows, targetIndex, patch) =>
  planEqImport(rows, targetIndex, opts({ bauer: BAUER, block: recognized(rows), ...patch }));

// A plan that stages pipelines always carries them; a plan that stages none is
// asserted on as null through `.rows` directly.
/**
 * @param {ImportPlan} plan
 * @returns {PipelineRow[]}
 */
const staged = (plan) => /** @type {PipelineRow[]} */ (plan.rows);

// The blocks these cases build are recognizable by construction; the one case
// that asks whether recognition happened reads `recognized` itself.
/**
 * @param {PipelineRow[]} rows
 * @returns {MsRecognition}
 */
const msOf = (rows) => /** @type {MsRecognition} */ (recognized(rows));

// --- parse half --------------------------------------------------------------

test("test_an_autoeq_filter_line_is_parsed", async () => {
  assert.equal(parseEqText(EQ).stages.length, 1);
});

test("test_a_preamp_line_is_parsed", async () => {
  assert.equal(parseEqText(EQ).preamp, "-6.4");
});

test("test_a_disabled_filter_is_reported_as_skipped", async () => {
  assert.equal(parseEqText("Filter 1: OFF PK Fc 105 Hz Gain -3.2 dB Q 1.41").skipped.length, 1);
});

test("test_an_unsupported_filter_type_is_reported_as_skipped", async () => {
  assert.ok(parseEqText("Filter 1: ON XX Fc 105 Hz Gain -3 dB Q 1").skipped[0].includes('unsupported type "XX"'));
});

// --- nothing to import -------------------------------------------------------

test("test_text_with_no_filters_stages_no_pipelines", async () => {
  assert.equal(planEqImport(PAIR, 0, opts({ text: "some notes" })).rows, null);
});

test("test_text_with_no_filters_says_so", async () => {
  assert.ok(planEqImport(PAIR, 0, opts({ text: "some notes" })).note.includes("no filters found"));
});

test("test_text_with_only_skipped_lines_counts_them", async () => {
  const text = "Filter 1: OFF PK Fc 105 Hz Gain -3.2 dB Q 1.41";
  assert.ok(planEqImport(PAIR, 0, opts({ text })).note.includes("1 line(s) skipped"));
});

// --- plain pipeline path -----------------------------------------------------

test("test_an_empty_target_row_takes_the_filter_as_its_whole_chain", async () => {
  assert.equal(staged(planEqImport(PAIR, 0, opts({})))[0].process, ADDED);
});

test("test_a_filter_is_appended_after_the_target_rows_existing_chain", async () => {
  const rows = [ROW({ process: "impulse.wav" }), ROW({ source: "1" })];
  assert.equal(staged(planEqImport(rows, 0, opts({})))[0].process, `impulse.wav,${ADDED}`);
});

test("test_a_target_past_the_last_pipeline_is_clamped_to_it", async () => {
  assert.equal(staged(planEqImport(PAIR, 7, opts({})))[1].process, ADDED);
});

test("test_a_preamp_line_becomes_the_target_rows_gain", async () => {
  assert.equal(staged(planEqImport(PAIR, 0, opts({})))[0].gain, "-6.4");
});

test("test_a_preamp_line_sets_the_target_rows_gain_unit_to_db", async () => {
  const rows = [ROW({ gainunit: "Lin" }), ROW({ source: "1" })];
  assert.equal(staged(planEqImport(rows, 0, opts({})))[0].gainunit, "dB");
});

test("test_text_without_a_preamp_leaves_the_target_rows_gain_alone", async () => {
  const rows = [ROW({ gain: "-2" }), ROW({ source: "1" })];
  assert.equal(staged(planEqImport(rows, 0, opts({ text: EQ_NO_PREAMP })))[0].gain, "-2");
});

// --- stereo-pair mirror ------------------------------------------------------

test("test_mirroring_an_even_target_writes_its_next_pipeline", async () => {
  assert.equal(staged(planEqImport(PAIR, 0, opts({ mirror: true })))[1].process, ADDED);
});

test("test_mirroring_an_odd_target_writes_its_previous_pipeline", async () => {
  assert.equal(staged(planEqImport(PAIR, 1, opts({ mirror: true })))[0].process, ADDED);
});

test("test_mirroring_off_leaves_the_partner_pipeline_alone", async () => {
  assert.equal(staged(planEqImport(PAIR, 0, opts({ mirror: false })))[1].process, "");
});

test("test_a_lone_pipeline_has_no_partner_to_mirror_to", async () => {
  assert.deepEqual(planEqImport([ROW({})], 0, opts({ mirror: true })).targets, [0]);
});

test("test_a_mirror_partner_past_the_last_pipeline_is_dropped", async () => {
  const rows = [ROW({}), ROW({ source: "1" }), ROW({ source: "2" })];
  assert.deepEqual(planEqImport(rows, 2, opts({ mirror: true })).targets, [2]);
});

test("test_pipelines_outside_the_target_set_are_untouched", async () => {
  const rows = [ROW({}), ROW({ source: "1" }), ROW({ source: "2", process: "impulse.wav" })];
  assert.equal(staged(planEqImport(rows, 0, opts({ mirror: true })))[2].process, "impulse.wav");
});

test("test_the_touched_pipelines_are_returned_for_auto_plotting", async () => {
  assert.deepEqual(planEqImport(PAIR, 0, opts({ mirror: true })).targets, [0, 1]);
});

// --- replace vs append -------------------------------------------------------

test("test_replacing_drops_the_previous_eq_from_the_chain", async () => {
  const rows = [ROW({ process: "iir:type=peak;f=50;q=1;g=1" }), ROW({ source: "1" })];
  assert.equal(staged(planEqImport(rows, 0, opts({ replace: true })))[0].process, ADDED);
});

test("test_replacing_keeps_the_chains_non_eq_stages", async () => {
  const rows = [ROW({ process: "iir:type=peak;f=50;q=1;g=1,impulse.wav" }), ROW({ source: "1" })];
  assert.equal(staged(planEqImport(rows, 0, opts({ replace: true })))[0].process, `impulse.wav,${ADDED}`);
});

test("test_appending_stacks_onto_the_previous_eq", async () => {
  const rows = [ROW({ process: "iir:type=peak;f=50;q=1;g=1" }), ROW({ source: "1" })];
  assert.equal(staged(planEqImport(rows, 0, opts({})))[0].process, `iir:type=peak;f=50;q=1;g=1,${ADDED}`);
});

// --- the note ----------------------------------------------------------------

test("test_the_note_counts_the_imported_filters", async () => {
  assert.ok(planEqImport(PAIR, 0, opts({})).note.startsWith("1 filter(s)"));
});

test("test_the_note_names_the_target_pipeline_from_one", async () => {
  assert.ok(planEqImport(PAIR, 1, opts({})).note.includes("pipeline 2"));
});

test("test_the_note_names_both_mirrored_pipelines", async () => {
  assert.ok(planEqImport(PAIR, 0, opts({ mirror: true })).note.includes("pipeline 1 + 2"));
});

test("test_the_note_reports_the_preamp_landing_on_gain", async () => {
  assert.ok(planEqImport(PAIR, 0, opts({})).note.includes("preamp -6.4 dB → gain"));
});

test("test_the_note_lists_the_skipped_lines", async () => {
  const text = `${EQ}\nFilter 2: OFF PK Fc 200 Hz Gain 1 dB Q 1`;
  assert.ok(planEqImport(PAIR, 0, opts({ text })).note.includes("skipped: Filter 2: OFF"));
});

// --- recognized crossfeed compensation block ---------------------------------

test("test_an_import_into_a_recognized_block_keeps_its_eight_rows", async () => {
  assert.equal(staged(intoBlock(block("", 0), 0, {})).length, 8);
});

test("test_an_import_into_a_recognized_block_stays_recognizable", async () => {
  assert.ok(recognized(staged(intoBlock(block("", 0), 0, {}))) !== null);
});

test("test_an_import_into_a_recognized_block_lands_in_its_shared_eq_chain", async () => {
  assert.equal(msOf(staged(intoBlock(block("", 0), 0, {}))).eqProcess, ADDED);
});

test("test_an_import_into_a_recognized_block_appends_to_its_existing_eq", async () => {
  const rows = staged(intoBlock(block("iir:type=peak;f=50;q=1;g=1", 0), 0, {}));
  assert.equal(msOf(rows).eqProcess, `iir:type=peak;f=50;q=1;g=1,${ADDED}`);
});

test("test_replacing_into_a_recognized_block_drops_its_previous_eq", async () => {
  const rows = staged(intoBlock(block("iir:type=peak;f=50;q=1;g=1", 0), 0, { replace: true }));
  assert.equal(msOf(rows).eqProcess, ADDED);
});

test("test_a_preamp_is_folded_into_the_blocks_gains", async () => {
  const rows = staged(intoBlock(block("", 0), 0, {}));
  assert.ok(Math.abs(msOf(rows).preampDb - -6.4) < 0.001);
});

test("test_a_block_import_without_a_preamp_keeps_the_blocks_own", async () => {
  const rows = staged(intoBlock(block("", -3), 0, { text: EQ_NO_PREAMP }));
  assert.ok(Math.abs(msOf(rows).preampDb - -3) < 0.001);
});

test("test_the_block_note_names_the_crossfeed_compensation_block", async () => {
  assert.ok(intoBlock(block("", 0), 0, {}).note.includes("crossfeed compensation block (pipelines 1–8)"));
});

test("test_the_block_note_reports_the_preamp", async () => {
  assert.ok(intoBlock(block("", 0), 0, {}).note.includes("preamp -6.4 dB"));
});

test("test_a_block_import_offers_no_rows_for_auto_plotting", async () => {
  assert.deepEqual(intoBlock(block("", 0), 0, {}).targets, []);
});

test("test_a_stale_block_is_reported_as_rebuilt", async () => {
  const rows = block("", 0, OTHER);
  assert.ok(intoBlock(rows, 0, {}).note.includes("rebuilt at 100%"));
});

test("test_rows_after_a_recognized_block_survive_the_import", async () => {
  const rows = [...block("", 0), ROW({ source: "2", mixdown: "2", process: "impulse.wav" })];
  assert.equal(staged(intoBlock(rows, 0, {}))[8].process, "impulse.wav");
});

test("test_a_target_outside_a_recognized_block_takes_the_plain_pipeline_path", async () => {
  const rows = [...block("", 0), ROW({ source: "2", mixdown: "2" })];
  assert.equal(staged(intoBlock(rows, 8, {}))[8].process, ADDED);
});

// The damage a single-row append would do: the preamp would land as a dB gain
// on a Lin row, and recognition would die on the first gainunit check.
test("test_a_target_inside_a_recognized_block_keeps_the_blocks_linear_gains", async () => {
  const rows = [...block("", 0), ROW({ source: "2", mixdown: "2" })];
  assert.equal(staged(intoBlock(rows, 2, {}))[2].gainunit, "Lin");
});

// --- recognized structural block ---------------------------------------------
// Sixteen rows with the same ownership rule as the eight above, and the same
// failure if it is ignored: an import onto one of its rows stops the block being
// a block, and the profile ends up on two rows out of sixteen.

/**
 * @param {string} eq
 * @param {number} [preampDb]
 * @returns {PipelineRow[]}
 */
const structural = (eq, preampDb = 0) =>
  compileRows({ lambda: 1, angle: 30, headRadius: HEAD_RADIUS, srcA: 0, srcB: 1, preampDb, eqProcess: eq });

/**
 * @param {PipelineRow[]} rows
 * @param {number} targetIndex
 * @param {Partial<ImportOpts>} patch
 * @returns {ImportPlan}
 */
const intoStructural = (rows, targetIndex, patch) =>
  planEqImport(rows, targetIndex, opts({ structural: recognizeRows(rows, 0), ...patch }));

// The rows these cases read back are a compiled block by construction; the one
// case that asks whether recognition happened calls recognizeRows itself.
/**
 * @param {PipelineRow[]} rows
 * @returns {StructuralRecognition}
 */
const structOf = (rows) => /** @type {StructuralRecognition} */ (recognizeRows(rows, 0));

/**
 * @param {PipelineRow[]} rows
 * @param {"left" | "right"} [side]
 * @returns {string}
 */
const earEq = (rows, side = "left") => structOf(rows).eqProcess[side];

test("test_an_import_into_a_structural_block_keeps_its_sixteen_rows", async () => {
  assert.equal(staged(intoStructural(structural(""), 0, {})).length, 16);
});

test("test_an_import_into_a_structural_block_stays_recognizable", async () => {
  assert.ok(recognizeRows(staged(intoStructural(structural(""), 0, {})), 0) !== null);
});

test("test_an_import_into_a_structural_block_lands_in_its_ear_chains", async () => {
  assert.equal(earEq(staged(intoStructural(structural(""), 0, {}))), ADDED);
});

test("test_an_import_into_a_structural_block_reaches_both_ears", async () => {
  assert.equal(earEq(staged(intoStructural(structural(""), 0, {})), "right"), ADDED);
});

test("test_an_import_into_a_structural_block_appends_to_its_existing_eq", async () => {
  const rows = staged(intoStructural(structural("iir:type=peak;f=50;q=1;g=1"), 0, {}));
  assert.equal(earEq(rows), `iir:type=peak;f=50;q=1;g=1,${ADDED}`);
});

test("test_replacing_into_a_structural_block_drops_its_previous_eq", async () => {
  const rows = staged(intoStructural(structural("iir:type=peak;f=50;q=1;g=1"), 0, { replace: true }));
  assert.equal(earEq(rows), ADDED);
});

test("test_a_preamp_is_folded_into_the_structural_blocks_gains", async () => {
  const rows = staged(intoStructural(structural(""), 0, {}));
  assert.ok(Math.abs(structOf(rows).preampDb.left - -6.4) < 0.001);
});

test("test_a_structural_import_without_a_preamp_keeps_the_blocks_own", async () => {
  const rows = staged(intoStructural(structural("", -3), 0, { text: EQ_NO_PREAMP }));
  assert.ok(Math.abs(structOf(rows).preampDb.left - -3) < 0.001);
});

test("test_a_target_inside_a_structural_block_keeps_the_blocks_linear_gains", async () => {
  const rows = [...structural(""), ROW({ source: "2", mixdown: "2" })];
  assert.equal(staged(intoStructural(rows, 2, {}))[2].gainunit, "Lin");
});

test("test_a_target_outside_a_structural_block_takes_the_plain_pipeline_path", async () => {
  const rows = [...structural(""), ROW({ source: "2", mixdown: "2" })];
  assert.equal(staged(intoStructural(rows, 16, {}))[16].process, ADDED);
});

test("test_the_structural_note_names_the_block", async () => {
  assert.ok(intoStructural(structural(""), 0, {}).note.includes("structural crossfeed block (pipelines 1–16)"));
});
