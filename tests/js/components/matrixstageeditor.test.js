// Behavioral suite for components/matrix/StageEditor.js — the docked inline
// stage editor (matrix-spec.md "Stage editor"): kind picker, per-kind argument editors,
// validation line and raw spec readout.
//
// Policy (docs/testing.md): public API only, one assertion per test. The
// editor is a pure function of the props it is handed (stages, stageIndex,
// replaceStages), so the whole per-kind rendering contract is reachable by
// rendering it with stages the test owns. `setSelected` is called per case to
// clear the shared selection state — module signals outlive a test.
//
// NOT REACHABLE from here, and deliberately not exported to make it so:
//   - The conv-draft render branch (kind-switch to Convolution holds a draft
//     until a file commits it). `convDraft` is written only inside the kind
//     select's onChange; the exported `setSelected` can only CLEAR it, so the
//     drafting stage can never exist under SSR.
//   - The upload chain: `uploadNote` ("uploading…" / "uploaded" / failures) and
//     with it the 352.8 kHz WAV sample-rate recommendation. Both are written
//     only inside the file input's onChange handler, which SSR never fires.
// Both belong to the playwright hand-back protocol.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/matrixstageeditor.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { StageEditor, setSelected } from "../../../hqptuner/static/components/matrix/StageEditor.js";
import { parseProcess } from "../../../hqptuner/static/lib/matrixspec.js";

// Render the editor docked on one stage of a process chain. Selection state is
// cleared first: `selected`/`convDraft` are module-level and outlive a test.
/**
 * @param {string} process the chain text
 * @param {number} [stageIndex]
 * @returns {string}
 */
function editor(process, stageIndex = 0) {
  setSelected(null);
  const stages = parseProcess(process);
  return render(html`<${StageEditor} stages=${stages} stageIndex=${stageIndex} replaceStages=${() => {}} />`);
}

const PEAK = "iir:type=peak;f=1000;q=1;g=0";

// Count the single-width argument inputs. The exact class match matters:
// conv's file field is "mtx-arg mtx-arg-wide" and must not count here.
/** @param {string} out */
const argCount = (out) => (out.match(/class="mtx-arg"/g) || []).length;

// --- the docked panel itself --------------------------------------------------

test("test_an_out_of_range_stage_index_renders_nothing", () => {
  assert.equal(editor(PEAK, 5), "");
});

// The case that pinned the delete button's caption is gone: the caption is the
// owner's wording and the button carries no identity to ask for instead
// (docs/testing.md rule 9).

test("test_the_kind_picker_marks_the_stage_kind_selected", () => {
  assert.ok(editor(PEAK).includes('<option selected value="iir"'));
});

test("test_the_kind_picker_offers_all_four_stage_kinds", () => {
  const head = editor(PEAK).split("</select>")[0];
  assert.equal((head.match(/<option/g) || []).length, 4);
});

// --- the iir editor: schema-driven arguments ------------------------------------

test("test_a_peak_stage_renders_one_input_per_schema_argument", () => {
  // peak: args f,g plus the one-of group q/bw — four inputs beside the type picker
  assert.equal(argCount(editor(PEAK)), 5);
});

test("test_an_iir_argument_input_carries_the_stage_value", () => {
  assert.ok(editor(PEAK).includes('value="1000"'));
});

test("test_the_iir_type_picker_marks_the_stage_type_selected", () => {
  assert.ok(editor(PEAK).includes('<option selected value="peak">peak</option>'));
});

test("test_the_iir_type_picker_lists_every_iir_type", () => {
  const body = editor(PEAK).split("mtx-editor-args")[1];
  assert.equal((body.split("</select>")[0].match(/<option/g) || []).length, 11);
});

test("test_a_first_order_lowpass_renders_only_its_frequency_argument", () => {
  // lp1: args [f], no one-of group — one input beside the type picker
  assert.equal(argCount(editor("iir:type=lp1;f=100")), 2);
});

test("test_an_unknown_iir_type_renders_no_argument_inputs", () => {
  assert.equal(argCount(editor("iir:type=weird")), 1);
});

// WHAT an issue says is the owner's wording; that the editor raises one is the
// behavior, and the issue line carries its own class (rule 9).
test("test_an_unknown_iir_type_is_reported_as_an_issue", () => {
  assert.ok(editor("iir:type=weird").includes("mtx-issues"));
});

// --- the delay and riaa editors -------------------------------------------------

test("test_a_delay_stage_renders_all_four_delay_arguments", () => {
  assert.equal(argCount(editor("delay:t=0.01")), 4);
});

test("test_a_riaa_stage_marks_its_subsonic_setting_selected", () => {
  assert.ok(editor("riaa:subsonic=0").includes('<option selected value="0"'));
});

test("test_a_riaa_stage_defaults_its_subsonic_filter_on", () => {
  assert.ok(editor("riaa").includes('<option selected value="1"'));
});

// --- the convolution editor ------------------------------------------------------

test("test_a_convolution_stage_shows_its_impulse_path", () => {
  assert.ok(editor("impulses/room.wav").includes('value="impulses/room.wav"'));
});

test("test_a_convolution_stage_offers_a_file_upload", () => {
  assert.ok(editor("impulses/room.wav").includes('accept=".wav,.txt"'));
});

// --- validation and the raw spec line --------------------------------------------

test("test_a_valid_stage_shows_no_issue_line", () => {
  assert.equal(editor(PEAK).includes("mtx-issues"), false);
});

test("test_a_missing_required_argument_is_reported", () => {
  assert.ok(editor("iir:type=peak;g=0;q=1").includes("mtx-issues"));
});

// The issue line's own text, or "" when the editor raises none. No wording is
// pinned: the case below compares one render's line against another's, so what
// each issue actually says stays the owner's (docs/testing.md rule 9).
/** @param {string} out */
const issueLine = (out) => (/<div class="mtx-issues">([^<]*)</.exec(out) || ["", ""])[1];

test("test_multiple_issues_share_one_line", () => {
  // `delay:x=1` raises two: an argument the kind does not take, and a required
  // one it lacks. Each is reachable alone, so the combined line is read against
  // both singles — counting the elements alone would stay green for an editor
  // that dropped one of the two issues on the floor.
  const many = editor("delay:x=1");
  const seen = {
    lines: (many.match(/mtx-issues/g) || []).length,
    carries: [issueLine(editor("delay:t=1;x=1")), issueLine(editor("delay"))].filter((one) =>
      issueLine(many).includes(one),
    ).length,
  };
  assert.deepEqual(seen, { lines: 1, carries: 2 });
});

test("test_the_spec_line_shows_the_stage_raw_string", () => {
  assert.ok(editor(PEAK).includes(`<code>${PEAK}</code>`));
});
