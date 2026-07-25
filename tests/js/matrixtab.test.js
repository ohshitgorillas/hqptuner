// Behavioral suite for components/MatrixTab.js — the pipeline editor's rendered
// contract. Written BEFORE the complexity refactor of FlowRow (14) and
// ProfileCard (11); not one case may change when those are decomposed.
//
// Policy (docs/testing.md): public API only, one assertion per test. `FlowRow`
// and `ProfileCard` are private components and stay that way — every case here
// goes through the exported `MatrixTab`, driven by exported store signals
// (`config`, `matrixConfig`, `showDescriptions`, `stagePipelines`) and the
// exported plot/selection signals in MatrixPlot.js. The refactor's whole purpose
// is to create private sub-components; covering them only through the tab is
// what makes these tests survive it.
//
// NOT covered, because the state that reaches those branches lives in
// module-private signals with no public writer (see the report): the raw `{ }`
// chain view (`rawRows`), the busy/note/name states of the profile card
// (`profileBusy`, `profileNote`, `profileNewName`, `profileSel`), and the
// enabled state of "Import EQ" (`importText`). Reaching through a private signal
// is forbidden, so those branches are honestly uncovered rather than faked.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/matrixtab.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../hqptuner/static/lib/dom.js";
import { MatrixTab } from "../../hqptuner/static/components/MatrixTab.js";
import { config, matrixConfig, stagePipelines, discardAll } from "../../hqptuner/static/store/state.js";
import { showDescriptions } from "../../hqptuner/static/store/prefs.js";
import { plottedRows, selectedStage, togglePlotted } from "../../hqptuner/static/components/MatrixPlot.js";
import { stagingWire } from "./wire.js";

function wire() {
  stagingWire();
}

const ROW = (patch) => ({ source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: "", ...patch });

// Full reset every time — every one of these signals outlives a test.
async function reset(rows, { active = "[Default]", profiles = [], notes = true } = {}) {
  wire();
  showDescriptions.value = notes;
  plottedRows.value = new Set();
  selectedStage.value = null;
  matrixConfig.value = { fields: [], rows: [], live_profiles: profiles, live_active: active };
  config.value = { fields: [], file: { matrix_pipelines: JSON.stringify(rows) } };
  await discardAll();
}

// Rendered output with the entity escapes decoded — the contract is the text a
// user reads, not its HTML encoding.
const tab = () =>
  render(html`<${MatrixTab} />`)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'");

// The pipeline rows as raw HTML fragments, in render order.
const rowsOf = (out) => out.split('<div class="mtx-row ').slice(1);
// The tool buttons of one pipeline row, in render order.
const IMPORT = 0;
const EXPORT = 1;
const RAW = 2;
const PLOT = 3;
const CLEAR = 4;
const REMOVE = 5;
const toolsOf = (rowHtml) =>
  rowHtml
    .slice(rowHtml.indexOf("mtx-row-tools"))
    .split("<button")
    .slice(1)
    .map((s) => s.split("</button>")[0]);
const tool = (out, rowIndex, i) => toolsOf(rowsOf(out)[rowIndex])[i];
const isDisabled = (btn) => btn.slice(0, btn.indexOf(">")).includes("disabled");
// The profile card's buttons, in render order.
const SWITCH = 0;
const LOAD = 1;
const DELETE = 2;
const SAVE_NEW = 3;
const profileButtons = (out) =>
  out
    .slice(out.indexOf("mtx-profile"), out.indexOf("Pipelines <span"))
    .split("<button")
    .slice(1)
    .map((s) => s.split("</button>")[0]);

// --- profile card ------------------------------------------------------------

test("test_the_active_profile_name_is_shown", async () => {
  await reset([ROW({})], { active: "Night" });
  assert.ok(tab().includes("<dd>Night</dd>"));
});

test("test_the_unnamed_profile_is_shown_as_default", async () => {
  await reset([ROW({})], { active: "[Default]" });
  assert.ok(tab().includes("<dd>[Default]</dd>"));
});

test("test_a_saved_profile_is_offered_in_the_picker", async () => {
  await reset([ROW({})], { active: "[Default]", profiles: ["Night", "Day"] });
  assert.ok(tab().includes('<option value="Day">Day</option>'));
});

test("test_the_picker_follows_the_active_profile", async () => {
  await reset([ROW({})], { active: "Night", profiles: ["Night"] });
  assert.ok(tab().includes('<option selected value="Night">Night</option>'));
});

test("test_delete_is_disabled_while_the_unnamed_default_is_selected", async () => {
  await reset([ROW({})], { active: "[Default]", profiles: ["Night"] });
  assert.equal(isDisabled(profileButtons(tab())[DELETE]), true);
});

test("test_delete_is_enabled_for_a_named_profile", async () => {
  await reset([ROW({})], { active: "Night", profiles: ["Night"] });
  assert.equal(isDisabled(profileButtons(tab())[DELETE]), false);
});

test("test_save_as_new_is_disabled_until_a_name_is_typed", async () => {
  await reset([ROW({})], { active: "Night", profiles: ["Night"] });
  assert.equal(isDisabled(profileButtons(tab())[SAVE_NEW]), true);
});

test("test_switch_is_offered_as_the_live_lane", async () => {
  await reset([ROW({})], { active: "Night", profiles: ["Night"] });
  assert.ok(profileButtons(tab())[SWITCH].includes("live, no engine reload"));
});

test("test_load_is_offered_as_the_reloading_lane", async () => {
  await reset([ROW({})], { active: "Night", profiles: ["Night"] });
  assert.ok(profileButtons(tab())[LOAD].includes("engine reload"));
});

test("test_the_profile_switch_caption_shows_with_feature_descriptions_on", async () => {
  await reset([ROW({})], { notes: true });
  assert.ok(tab().includes("Profiles can be switched at any time"));
});

test("test_the_profile_switch_caption_hides_with_feature_descriptions_off", async () => {
  await reset([ROW({})], { notes: false });
  assert.equal(tab().includes("Profiles can be switched at any time"), false);
});

test("test_the_profile_load_caption_hides_with_feature_descriptions_off", async () => {
  await reset([ROW({})], { notes: false });
  assert.equal(tab().includes("Load replaces the pipelines"), false);
});

test("test_the_profile_save_caption_hides_with_feature_descriptions_off", async () => {
  await reset([ROW({})], { notes: false });
  assert.equal(tab().includes("Saves the current matrix as a new named profile"), false);
});

// --- flow rows ---------------------------------------------------------------

test("test_every_pipeline_is_rendered", async () => {
  await reset([ROW({}), ROW({ source: "1" }), ROW({ source: "2" })]);
  assert.equal(rowsOf(tab()).length, 3);
});

test("test_pipelines_are_numbered_from_one", async () => {
  await reset([ROW({}), ROW({ source: "1" })]);
  assert.ok(tab().includes('<span class="mtx-flow-idx">2</span>'));
});

test("test_a_pipeline_shows_its_source_channel_selected", async () => {
  await reset([ROW({ source: "3" })]);
  assert.ok(rowsOf(tab())[0].includes('<option selected value="3">In 4</option>'));
});

test("test_a_pipeline_shows_its_output_channel_selected", async () => {
  await reset([ROW({ mixdown: "5" })]);
  assert.ok(rowsOf(tab())[0].includes('<option selected value="5">Out 6</option>'));
});

test("test_a_stage_in_the_chain_is_rendered_as_a_chip", async () => {
  await reset([ROW({ process: "iir:type=peak;f=100;q=1;g=-3" })]);
  assert.ok(rowsOf(tab())[0].includes("peak · 100 Hz · -3 dB"));
});

test("test_a_row_matching_the_baseline_is_not_marked_dirty", async () => {
  await reset([ROW({})]);
  assert.ok(tab().includes('<div class="mtx-row "'));
});

test("test_a_staged_edit_marks_its_row_dirty", async () => {
  await reset([ROW({})]);
  await stagePipelines([ROW({ gain: "-6" })]);
  assert.ok(tab().includes('<div class="mtx-row dirty"'));
});

test("test_pipelines_sharing_an_output_are_marked_as_summed", async () => {
  await reset([ROW({ source: "0", mixdown: "0" }), ROW({ source: "1", mixdown: "0" })]);
  assert.ok(rowsOf(tab())[0].includes('class="psum"'));
});

test("test_a_pipeline_with_a_private_output_is_not_marked_as_summed", async () => {
  await reset([ROW({ source: "0", mixdown: "0" }), ROW({ source: "1", mixdown: "1" })]);
  assert.equal(rowsOf(tab())[0].includes('class="psum"'), false);
});

test("test_the_only_pipeline_cannot_be_removed", async () => {
  await reset([ROW({})]);
  assert.equal(isDisabled(tool(tab(), 0, REMOVE)), true);
});

test("test_the_only_pipeline_explains_why_it_cannot_be_removed", async () => {
  await reset([ROW({})]);
  assert.ok(tool(tab(), 0, REMOVE).includes("At least one pipeline is required"));
});

test("test_one_of_two_pipelines_can_be_removed", async () => {
  await reset([ROW({}), ROW({ source: "1" })]);
  assert.equal(isDisabled(tool(tab(), 0, REMOVE)), false);
});

test("test_clearing_is_disabled_on_an_untouched_pipeline", async () => {
  await reset([ROW({})]);
  assert.equal(isDisabled(tool(tab(), 0, CLEAR)), true);
});

test("test_clearing_is_enabled_on_a_pipeline_with_stages", async () => {
  await reset([ROW({ process: "iir:type=peak;f=100;q=1;g=-3" })]);
  assert.equal(isDisabled(tool(tab(), 0, CLEAR)), false);
});

test("test_clearing_is_enabled_on_a_pipeline_carrying_gain", async () => {
  await reset([ROW({ gain: "-6" })]);
  assert.equal(isDisabled(tool(tab(), 0, CLEAR)), false);
});

test("test_import_eq_is_disabled_with_no_eq_text_loaded", async () => {
  await reset([ROW({})]);
  assert.equal(isDisabled(tool(tab(), 0, IMPORT)), true);
});

test("test_import_eq_says_where_to_load_eq_text_from", async () => {
  await reset([ROW({})]);
  assert.ok(tool(tab(), 0, IMPORT).includes("Load or paste EQ text first"));
});

test("test_export_eq_is_disabled_on_a_pipeline_with_no_parametric_eq", async () => {
  await reset([ROW({})]);
  assert.equal(isDisabled(tool(tab(), 0, EXPORT)), true);
});

test("test_export_eq_is_enabled_on_a_pipeline_with_a_filter_stage", async () => {
  await reset([ROW({ process: "iir:type=peak;f=100;q=1;g=-3" })]);
  assert.equal(isDisabled(tool(tab(), 0, EXPORT)), false);
});

test("test_the_raw_view_toggle_is_offered_on_every_pipeline", async () => {
  await reset([ROW({})]);
  assert.ok(tool(tab(), 0, RAW).includes("Edit the raw process string"));
});

test("test_an_unplotted_pipeline_shows_a_hollow_plot_toggle", async () => {
  await reset([ROW({})]);
  togglePlotted(0);
  togglePlotted(0);
  assert.ok(tool(tab(), 0, PLOT).includes("○"));
});

test("test_a_plotted_pipeline_shows_a_filled_plot_toggle", async () => {
  await reset([ROW({})]);
  togglePlotted(0);
  assert.ok(tool(tab(), 0, PLOT).includes("◉"));
});

test("test_a_plotted_pipeline_marks_its_plot_toggle_active", async () => {
  await reset([ROW({})]);
  togglePlotted(0);
  assert.ok(tool(tab(), 0, PLOT).includes('class="mtx-tool active"'));
});

// --- docked stage editor -----------------------------------------------------

test("test_no_stage_editor_is_docked_until_a_chip_is_selected", async () => {
  await reset([ROW({ process: "iir:type=peak;f=100;q=1;g=-3" })]);
  assert.equal(tab().includes('class="mtx-editor"'), false);
});

test("test_selecting_a_chip_docks_the_stage_editor_under_its_row", async () => {
  await reset([ROW({ process: "iir:type=peak;f=100;q=1;g=-3" })]);
  selectedStage.value = { row: 0, stage: 0 };
  assert.ok(rowsOf(tab())[0].includes('class="mtx-editor"'));
});

test("test_the_docked_editor_shows_the_selected_stages_arguments", async () => {
  await reset([ROW({ process: "iir:type=peak;f=100;q=1;g=-3" })]);
  selectedStage.value = { row: 0, stage: 0 };
  assert.ok(tab().includes('<span>f</span><input type="text" value="100"/>'));
});

test("test_the_docked_editor_shows_the_selected_stages_spec", async () => {
  await reset([ROW({ process: "iir:type=peak;f=100;q=1;g=-3" })]);
  selectedStage.value = { row: 0, stage: 0 };
  assert.ok(tab().includes("<code>iir:type=peak;f=100;q=1;g=-3</code>"));
});

test("test_a_selection_docks_the_editor_on_its_own_row_only", async () => {
  await reset([ROW({ process: "iir:type=peak;f=100;q=1;g=-3" }), ROW({ source: "1" })]);
  selectedStage.value = { row: 0, stage: 0 };
  assert.equal(rowsOf(tab())[1].includes('class="mtx-editor"'), false);
});

test("test_the_pipelines_caption_hides_with_feature_descriptions_off", async () => {
  await reset([ROW({})], { notes: false });
  assert.equal(tab().includes("Each pipeline copies a source channel"), false);
});
