// Behavioral suite for the structural crossfeed install's parse-or-refuse
// contract (store/xfmode.js stageStructural + lib/binaural-setup.js pairInfo).
//
// The install compiles a 16-row matrix block over pipeline rows 0..1 — the
// stereo EQ pair, one row per ear — and keeps later rows after it. The contract
// is all-or-nothing: either the pair parses and the block carries its process
// chains and dB gains in (Lin gains converted as dB = 20*log10(linear)), or the
// call refuses with a human-readable note and stages nothing at all. No refusal
// path may ever leave the staged rows different from what they were before the
// call — in particular it may never drop the EQ chains the prior rows carried.
//
// Blocks are built and torn down through the real stage/remove entry points
// over the staging wire; pairInfo is pure and tested directly.

import test from "node:test";
import assert from "node:assert/strict";

import { stageStructural, removeStructural, structuralBlock } from "../../../hqptuner/static/store/xfmode.js";
import { pairInfo } from "../../../hqptuner/static/lib/binaural-setup.js";
import { HEAD_RADIUS, SPEAKER_ANGLE } from "../../../hqptuner/static/lib/binaural/geometry.js";
import { config, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { effective, effectivePipelines, isDirty } from "../../../hqptuner/static/store/resolve.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { ok, stagingWire } from "../support/wire.js";

/**
 * @typedef {import("../../../hqptuner/static/lib/matrixspec.js").PipelineRow} PipelineRow
 * @typedef {import("../../../hqptuner/static/lib/binaural/recognize.js").StructuralRecognition} StructuralRecognition
 */

/**
 * One /config or /matrix form field, as `resetForms()` below builds it.
 * `value` is a union because the form answers a checkbox with a real bool and
 * everything else with a string.
 *
 * @typedef {{ name: string, value: string | boolean }} FormField
 */

const EQ_L = "iir:type=peak;f=1000;q=1;g=-3";
const EQ_R = "iir:type=peak;f=2000;q=2;g=2";
const EQ_X = "iir:type=peak;f=500;q=1;g=1";

const DEFAULTS = { angle: SPEAKER_ANGLE, headRadius: HEAD_RADIUS, lambda: 1 };

/**
 * @param {string} source
 * @param {string} mixdown
 * @param {string} gain
 * @param {string} process
 * @returns {PipelineRow}
 */
const dbRow = (source, mixdown, gain, process) => ({
  gain,
  gainunit: "dB",
  mixdown,
  process,
  source,
});
/**
 * @param {string} source
 * @param {string} mixdown
 * @param {string} gain
 * @param {string} process
 * @returns {PipelineRow}
 */
const linRow = (source, mixdown, gain, process) => ({
  gain,
  gainunit: "Lin",
  mixdown,
  process,
  source,
});

// The block a test knows is installed, typed without the `| null` case: every
// call site here follows a compile of a real block, so what `structuralBlock`
// hands back always recognizes.
/**
 * @param {PipelineRow[]} rows
 * @returns {StructuralRecognition}
 */
function installedBlock(rows) {
  const rec = structuralBlock(rows);
  if (!rec) throw new Error("expected a recognized block");
  return rec;
}

// The parse a test knows succeeded, typed without the refusal case: every call
// site here feeds a pair `pairInfo` accepts, so what it hands back always
// carries `eq` and `gain`.
/**
 * @param {PipelineRow[]} rows
 * @returns {{ eq: { left: string, right: string }, gain: { left: number, right: number } }}
 */
function parsed(rows) {
  const { eq, gain } = pairInfo(rows);
  if (!eq || !gain) throw new Error("expected a parsed pair");
  return { eq, gain };
}

// The parseable shapes: a straight dB pair, and a straight Lin pair whose
// gains 2 and 0.5 land on +/-20*log10(2) dB exactly.
const straight = () => [dbRow("0", "0", "-3", EQ_L), dbRow("1", "1", "2", EQ_R)];
const linPair = () => [linRow("0", "0", "2", EQ_L), linRow("1", "1", "0.5", EQ_R)];
const LIN2_DB = 20 * Math.log10(2);

// Full reset every time — the staging buffer outlives a test.
/** @param {PipelineRow[]} rows */
async function reset(rows) {
  stagingWire({ fallback: (w) => ok(w.staged) });
  matrixConfig.value = { fields: [] };
  config.value = { fields: [], file: { matrix_pipelines: JSON.stringify(rows) } };
  await discardAll();
}

const live = () => effectivePipelines.value;
/** @param {string} source */
const bySource = (source) => live().find((/** @type {PipelineRow} */ r) => r.source === source);

// --- a parseable pair installs -------------------------------------------------

test("test_install_over_a_straight_db_pair_stages_sixteen_rows", async () => {
  await reset(straight());
  stageStructural(live(), DEFAULTS);
  assert.equal(live().length, 16);
});

test("test_install_over_a_straight_db_pair_is_recognized_as_a_block", async () => {
  await reset(straight());
  stageStructural(live(), DEFAULTS);
  assert.notEqual(structuralBlock(live()), null);
});

test("test_a_successful_install_returns_no_note", async () => {
  await reset(straight());
  assert.ok(!stageStructural(live(), DEFAULTS));
});

test("test_a_reversed_straight_pair_installs_with_no_note", async () => {
  await reset([...straight()].reverse());
  assert.ok(!stageStructural(live(), DEFAULTS));
});

// --- what the installed block carries, before anything is taken off ------------
//
// The EQ has to be IN the block: a block compiled without it is silent processing
// the user did not ask for, and an implementation that stashed the chains aside
// and handed them back on removal would satisfy every round-trip test below while
// playing no EQ at all.

test("test_an_installed_block_carries_the_left_ears_chain", async () => {
  await reset(straight());
  stageStructural(live(), DEFAULTS);
  assert.equal(installedBlock(live()).eqProcess.left, EQ_L);
});

// --- what the block carries in comes back out ----------------------------------

test("test_removal_recovers_the_left_ears_chain", async () => {
  await reset(straight());
  stageStructural(live(), DEFAULTS);
  removeStructural(live(), installedBlock(live()));
  assert.equal(bySource("0").process, EQ_L);
});

test("test_removal_recovers_the_right_ears_chain", async () => {
  await reset(straight());
  stageStructural(live(), DEFAULTS);
  removeStructural(live(), installedBlock(live()));
  assert.equal(bySource("1").process, EQ_R);
});

test("test_removal_recovers_the_right_ears_db_gain", async () => {
  await reset(straight());
  stageStructural(live(), DEFAULTS);
  removeStructural(live(), installedBlock(live()));
  assert.ok(Math.abs(parseFloat(bySource("1").gain) - 2) < 1e-3);
});

// Ears are read off the SOURCE channel, not off row position, so the pair handed
// back from a block built on rows in the other order still carries its own chain.
test("test_a_reversed_straight_pair_recovers_the_source_0_chain", async () => {
  await reset([...straight()].reverse());
  stageStructural(live(), DEFAULTS);
  removeStructural(live(), installedBlock(live()));
  assert.equal(bySource("0").process, EQ_L);
});

// The recovered gain is a STRING in the row, snapped to the 1e-3 dB grid the row
// editor speaks: 20*log10(2) is 6.020599913…, and what lands in the pair is the
// snapped "6.021", not the full float written out.
test("test_a_lin_install_recovers_its_gain_converted_to_db", async () => {
  await reset(linPair());
  stageStructural(live(), DEFAULTS);
  removeStructural(live(), installedBlock(live()));
  assert.equal(bySource("0").gain, "6.021");
});

test("test_a_lin_install_recovers_its_chain", async () => {
  await reset(linPair());
  stageStructural(live(), DEFAULTS);
  removeStructural(live(), installedBlock(live()));
  assert.equal(bySource("0").process, EQ_L);
});

test("test_a_lin_install_hands_back_a_db_marked_pair", async () => {
  await reset(linPair());
  stageStructural(live(), DEFAULTS);
  removeStructural(live(), installedBlock(live()));
  assert.equal(bySource("0").gainunit, "dB");
});

test("test_a_lin_install_hands_back_a_db_marked_right_row", async () => {
  await reset(linPair());
  stageStructural(live(), DEFAULTS);
  removeStructural(live(), installedBlock(live()));
  assert.equal(bySource("1").gainunit, "dB");
});

// --- extra rows outside the pair ride along, untouched -------------------------

test("test_extra_rows_outside_the_stereo_mixdowns_survive_install_in_order", async () => {
  const extras = [dbRow("2", "2", "0", EQ_X), dbRow("3", "3", "-1", "")];
  await reset([...straight(), ...extras]);
  stageStructural(live(), DEFAULTS);
  assert.deepEqual(live().slice(16), extras);
});

test("test_install_with_extra_rows_outside_the_stereo_mixdowns_returns_no_note", async () => {
  await reset([...straight(), dbRow("2", "2", "0", EQ_X)]);
  assert.ok(!stageStructural(live(), DEFAULTS));
});

// --- everything else refuses, all-or-nothing -----------------------------------
//
// One case per unparseable shape; each gets two tests. The refusal is ONE note,
// the same wording whatever the shape — the user wrote it and reads it, so it is
// pinned here as a literal rather than imported from the module under test. And
// "stages nothing" is literal: the staged rows after the call are byte-identical
// to the rows before it, EQ chains included, so no refusal path can strip the EQ
// the rows carried.

const REFUSAL_NOTE =
  "⚠ Structural crossfeed requires a stereo starting point. Ensure the first two pipelines route to themselves.";

/** @type {[string, PipelineRow[]][]} */
const REFUSALS = [
  ["a_crossed_pair", [dbRow("0", "1", "-3", EQ_L), dbRow("1", "0", "-3", EQ_R)]],
  ["a_half_misrouted_pair", [dbRow("0", "0", "-3", EQ_L), dbRow("1", "2", "2", EQ_R)]],
  ["a_lin_pair_with_a_zero_gain", [linRow("0", "0", "0", EQ_L), linRow("1", "1", "2", EQ_R)]],
  ["a_lin_pair_with_a_negative_gain", [linRow("0", "0", "2", EQ_L), linRow("1", "1", "-1", EQ_R)]],
  ["a_db_pair_with_a_non_numeric_gain", [dbRow("0", "0", "abc", EQ_L), dbRow("1", "1", "2", EQ_R)]],
  ["a_lin_pair_with_a_non_numeric_gain", [linRow("0", "0", "abc", EQ_L), linRow("1", "1", "2", EQ_R)]],
  ["a_single_row", [dbRow("0", "0", "-3", EQ_L)]],
  ["no_rows", []],
  ["an_extra_row_on_mixdown_0", [...straight(), dbRow("2", "0", "0", EQ_X)]],
  ["an_extra_row_on_mixdown_1", [...straight(), dbRow("3", "1", "0", EQ_X)]],
];

for (const [name, rows] of REFUSALS) {
  test(`test_installing_over_${name}_refuses_with_the_refusal_note`, async () => {
    await reset(rows);
    assert.equal(stageStructural(live(), DEFAULTS), REFUSAL_NOTE);
  });

  test(`test_installing_over_${name}_stages_nothing`, async () => {
    await reset(rows);
    const before = JSON.stringify(live());
    stageStructural(live(), DEFAULTS);
    assert.equal(JSON.stringify(live()), before);
  });
}

// --- a refusal stages nothing, the conflict fixes included ---------------------
//
// An install does not only write rows: it also stages the two settings the block
// cannot coexist with — `crossfeed_enabled` off, and `matrix_iir2fir` away from
// 2. Those are part of the install, so they are part of what all-or-nothing
// covers. A refusal that has already written them leaves the user's daemon
// changed by a call that reported it did nothing.
//
// Both settings are matrix-form controls, read back through `effective` under
// their schema names (store.test.js: a matrix control reads the matrix form
// under its bare name).

const crossed = () => [dbRow("0", "1", "-3", EQ_L), dbRow("1", "0", "-3", EQ_R)];

// Same reset, with forms carrying the settings under test: the matrix form for
// the two conflict fixes, the config form for the DSP pipelines row count.
/**
 * @param {PipelineRow[]} rows
 * @param {{ matrix?: FormField[], fields?: FormField[] }} [forms]
 */
async function resetForms(rows, { matrix = [], fields = [] } = {}) {
  stagingWire({ fallback: (w) => ok(w.staged) });
  matrixConfig.value = { fields: matrix };
  config.value = { fields, file: { matrix_pipelines: JSON.stringify(rows) } };
  await discardAll();
}

test("test_a_refused_install_leaves_crossfeed_enabled_alone", async () => {
  await resetForms(crossed(), { matrix: [{ name: "post_bauer_enabled", value: "1" }] });
  stageStructural(live(), DEFAULTS);
  assert.equal(effective("crossfeed_enabled"), "1");
});

test("test_a_refused_install_leaves_the_matrix_iir2fir_mode_alone", async () => {
  await resetForms(crossed(), { matrix: [{ name: "iir2fir", value: "2" }] });
  stageStructural(live(), DEFAULTS);
  assert.equal(effective("matrix_iir2fir"), "2");
});

// The block needs sixteen pipeline rows, so an install raises the DSP row count
// field with them. A refusal installs no rows and so must not raise it either.
test("test_a_refused_install_leaves_the_dsp_pipelines_row_count_unstaged", async () => {
  await resetForms(crossed(), { fields: [{ name: "pipelines", value: "2" }] });
  stageStructural(live(), DEFAULTS);
  assert.equal(isDirty("pipelines"), false);
});

// "Nothing installed" asserted rather than inferred from the row text.
test("test_a_refused_install_leaves_no_block_installed", async () => {
  await reset(crossed());
  stageStructural(live(), DEFAULTS);
  assert.equal(structuralBlock(live()), null);
});

// --- pairInfo: the pure parse behind the install -------------------------------
//
// Ears are read off the SOURCE channel — source "0" is the left ear, source "1"
// the right — never off row position.

test("test_pair_info_carries_the_source_0_chain_as_the_left_ear", () => {
  assert.equal(parsed(straight()).eq.left, EQ_L);
});

test("test_pair_info_reads_ears_by_source_not_row_order", () => {
  assert.equal(parsed([...straight()].reverse()).eq.left, EQ_L);
});

test("test_pair_info_reads_a_db_gain_as_is", () => {
  assert.ok(Math.abs(parsed(straight()).gain.left - -3) < 1e-3);
});

test("test_pair_info_converts_a_lin_gain_to_db", () => {
  assert.ok(Math.abs(parsed(linPair()).gain.left - LIN2_DB) < 1e-3);
});

test("test_pair_info_refusal_carries_no_eq", () => {
  assert.equal(pairInfo([dbRow("0", "1", "-3", EQ_L), dbRow("1", "0", "-3", EQ_R)]).eq, undefined);
});
