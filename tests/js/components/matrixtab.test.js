// Behavioral suite for components/matrix/Tab.js — the pipeline editor's rendered
// contract. Written BEFORE the complexity refactor of FlowRow (14) and
// ProfileCard (11); not one case may change when those are decomposed.
//
// Policy (docs/testing.md): public API only, one assertion per test. `FlowRow`
// and `ProfileCard` are private components and stay that way — every case here
// goes through the exported `MatrixTab`, driven by exported store signals
// (`config`, `matrixConfig`, `showDescriptions`, `stagePipelines`) and the
// exported plot/selection signals in matrix/Plot.js. The refactor's whole purpose
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

import { html } from "../../../hqptuner/static/lib/dom.js";
import { MatrixTab } from "../../../hqptuner/static/components/matrix/Tab.js";
import { config, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { stagePipelines, discardAll } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { plottedRows, togglePlotted } from "../../../hqptuner/static/components/matrix/Plot.js";
import { selectedStage } from "../../../hqptuner/static/components/matrix/BandStrip.js";
import { stagingWire } from "../support/wire.js";

function wire() {
  stagingWire();
}

/** @typedef {import("../../../hqptuner/static/lib/matrixspec.js").PipelineRow} PipelineRow */

/**
 * A stored profile as `matrixConfig.file_profiles` carries one.
 *
 * @typedef {{ rows: PipelineRow[], post: Record<string, unknown> }} SavedProfile
 */

/** @param {Partial<PipelineRow>} patch */
const ROW = (patch) => ({ source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: "", ...patch });

// Full reset every time — every one of these signals outlives a test.
/**
 * @param {PipelineRow[]} rows
 * @param {{
 *   active?: string,
 *   profiles?: string[],
 *   saved?: Record<string, SavedProfile>,
 *   notes?: boolean,
 * }} [opts]
 * @returns {Promise<void>}
 */
async function reset(rows, { active = "[Default]", profiles = [], saved = {}, notes = true } = {}) {
  wire();
  showDescriptions.value = notes;
  plottedRows.value = new Set();
  selectedStage.value = null;
  // `profiles` are the names the DAEMON read at startup (a live load can reach
  // them); `saved` is what the CONFIG carries, name -> {rows, post} (persisted,
  // and the
  // only source that has rows to stage).
  matrixConfig.value = {
    fields: [],
    rows: [],
    live_profiles: profiles,
    live_active: active,
    file_profiles: saved,
  };
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
/** @param {string} out */
const rowsOf = (out) => out.split('<div class="mtx-row ').slice(1);
// The tool buttons of one pipeline row, in render order.
const IMPORT = 0;
const EXPORT = 1;
const PLOT = 3;
const CLEAR = 4;
const REMOVE = 5;
/** @param {string} rowHtml */
const toolsOf = (rowHtml) =>
  rowHtml
    .slice(rowHtml.indexOf("mtx-row-tools"))
    .split("<button")
    .slice(1)
    .map((s) => s.split("</button>")[0]);
/**
 * @param {string} out
 * @param {number} rowIndex
 * @param {number} i
 */
const tool = (out, rowIndex, i) => toolsOf(rowsOf(out)[rowIndex])[i];
/** @param {string} btn */
const isDisabled = (btn) => btn.slice(0, btn.indexOf(">")).includes("disabled");
// The profile card's buttons, in render order. Switch and Load collapsed into one
// live Load in round 5 — a load is the live lane AND stages so it persists.
const DELETE = 1;
const SAVE = 2;
/** @param {string} out */
const profileCard = (out) => out.slice(out.indexOf("mtx-profile"), out.indexOf("Pipelines <span"));
/** @param {string} out */
const profileButtons = (out) =>
  profileCard(out)
    .split("<button")
    .slice(1)
    .map((s) => s.split("</button>")[0]);

// A card found by the schema key of a field it carries, and the schema keys a
// fragment carries. Both are wire identifiers, so neither the card's heading nor
// the field's label is ever used as a selector.
/**
 * @param {string} out
 * @param {string} key
 */
const sectionWith = (out, key) => {
  const i = out.indexOf(`data-k="${key}"`);
  return i < 0 ? "" : out.slice(out.lastIndexOf("<section", i), out.indexOf("</section>", i));
};
/** @param {string} frag */
const fieldKeys = (frag) => [...frag.matchAll(/data-k="([^"]*)"/g)].map((m) => m[1]);
// Description captions, counted rather than read: every one carries `field-note`.
/** @param {string} frag */
const captions = (frag) => (frag.match(/class="field-note"/g) || []).length;
// The two channel pickers of a pipeline row, source first, and the wire value
// each one is sitting on.
/** @param {string} rowHtml */
const channelPickers = (rowHtml) => rowHtml.split('<select class="mtx-ch').slice(1);
/** @param {string} frag */
const pickedValue = (frag) => (/<option selected value="([^"]*)"/.exec(frag) || ["", ""])[1];
// The lane tag beside the picker: what a Load of the selected profile will do.

// --- profile card ------------------------------------------------------------

test("test_the_active_profile_name_is_shown", async () => {
  await reset([ROW({})], { active: "Night" });
  assert.ok(tab().includes('t-value">Night<'));
});

test("test_the_unnamed_profile_is_shown_as_default", async () => {
  await reset([ROW({})], { active: "[Default]" });
  assert.ok(tab().includes('t-value">[Default]<'));
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

test("test_save_is_disabled_until_a_name_is_typed", async () => {
  await reset([ROW({})], { active: "Night", profiles: ["Night"] });
  assert.equal(isDisabled(profileButtons(tab())[SAVE]), true);
});

test("test_a_profile_only_the_config_carries_is_offered_in_the_picker", async () => {
  await reset([ROW({})], { active: "[Default]", profiles: [], saved: { Night: { rows: [ROW({})], post: {} } } });
  assert.ok(tab().includes('<option value="Night">Night</option>'));
});

// Load and save each carry a caption of their own; which sentence is in which is
// copy, so the card's captions are counted instead.
test("test_the_profile_card_captions_show_with_feature_descriptions_on", async () => {
  await reset([ROW({})], { notes: true });
  assert.equal(captions(profileCard(tab())), 2);
});

test("test_the_profile_card_captions_hide_with_feature_descriptions_off", async () => {
  await reset([ROW({})], { notes: false });
  assert.equal(captions(profileCard(tab())), 0);
});

// --- the channels card --------------------------------------------------------
// The reorganization moved the engine's output-channel count in from the Output
// tab: a card of its own titled Channels, stacked directly below the profile
// card in the top card row — NOT inside the Pipelines card, whose own block
// keeps the DSP pipelines control alone. Both fields ride the /config form, so
// the form is seeded with them.

/**
 * @param {PipelineRow[]} rows
 * @param {boolean} [notes]
 */
async function resetWithChannels(rows, notes = true) {
  await reset(rows, { notes });
  config.value = {
    fields: [
      { name: "channels", value: "2" },
      { name: "pipelines", value: "0" },
    ],
    file: { matrix_pipelines: JSON.stringify(rows) },
  };
}

test("test_the_channels_card_carries_exactly_the_channel_count", async () => {
  // the channel count and nothing else: the pipelines control stays in its own
  // card
  await resetWithChannels([ROW({})]);
  assert.deepEqual(fieldKeys(sectionWith(tab(), "channels")), ["channels"]);
});

test("test_the_open_pipelines_card_still_carries_the_pipelines_field", async () => {
  // Openness is established in the same fragment the field is read from: the
  // pipeline rows render only inside the open card.
  await resetWithChannels([ROW({})]);
  assert.ok(sectionWith(tab(), "pipelines").includes('<div class="mtx-row '));
});

test("test_the_open_pipelines_card_carries_no_channel_count", async () => {
  await resetWithChannels([ROW({})]);
  assert.deepEqual(fieldKeys(sectionWith(tab(), "pipelines")), ["pipelines"]);
});

test("test_the_channels_card_stands_below_the_profile_card_in_its_stack", async () => {
  await resetWithChannels([ROW({})]);
  const stack = tab().slice(tab().indexOf('<div class="card-stack'));
  const profile = stack.indexOf("mtx-profile");
  assert.ok(profile >= 0 && profile < stack.indexOf('data-k="channels"'));
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
  assert.equal(pickedValue(channelPickers(rowsOf(tab())[0])[0]), "3");
});

test("test_a_pipeline_shows_its_output_channel_selected", async () => {
  await reset([ROW({ mixdown: "5" })]);
  assert.equal(pickedValue(channelPickers(rowsOf(tab())[0])[1]), "5");
});

test("test_a_stage_in_the_chain_is_rendered_as_a_chip", async () => {
  await reset([ROW({ process: "iir:type=peak;f=100;q=1;g=-3" })]);
  assert.equal((rowsOf(tab())[0].match(/mtx-stage/g) || []).length, 1);
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

test("test_export_eq_is_disabled_on_a_pipeline_with_no_parametric_eq", async () => {
  await reset([ROW({})]);
  assert.equal(isDisabled(tool(tab(), 0, EXPORT)), true);
});

test("test_export_eq_is_enabled_on_a_pipeline_with_a_filter_stage", async () => {
  await reset([ROW({ process: "iir:type=peak;f=100;q=1;g=-3" })]);
  assert.equal(isDisabled(tool(tab(), 0, EXPORT)), false);
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

test("test_the_pipelines_caption_shows_with_feature_descriptions_on", async () => {
  await resetWithChannels([ROW({})]);
  assert.equal(captions(sectionWith(tab(), "pipelines")), 1);
});

test("test_the_pipelines_caption_hides_with_feature_descriptions_off", async () => {
  await resetWithChannels([ROW({})], false);
  assert.equal(captions(sectionWith(tab(), "pipelines")), 0);
});

// --- band strip under the response plot --------------------------------------
// Knob + slider + exact-box trios for the selected iir stage, in three standing
// slots. The drag/commit paths (and the plot's drag readout) live behind
// pointer/input events SSR never fires — they belong to the hand-back
// protocol, per docs/testing.md.

const PEAK = "iir:type=peak;f=100;q=1;g=-3";
/** @param {string} out */
const strip = (out) => (out.includes('class="band-strip"') ? out.slice(out.indexOf('class="band-strip"')) : "");
// The strip's band title, and the pipeline numbers it carries. Empty while no
// band is selected — the idle strip's caption is a different element.
/** @param {string} out */
const bandTitle = (out) => (/<div class="t-label mono">([^<]*)<\/div>/.exec(strip(out)) || ["", ""])[1];
/** @param {string} out */
const bandNumbers = (out) => (bandTitle(out).match(/\d+/g) || []).map(Number);

// --- applied reference trace --------------------------------------------------
// While the working rows differ from the daemon's file truth, the plot keeps
// the applied response underneath as a dashed muted ghost — the line edits are
// tuned against.

/** @param {string} out */
const ghostTraces = (out) => (out.match(/class="plot-trace ghost"/g) || []).length;

test("test_an_unedited_plot_draws_no_applied_reference", async () => {
  await reset([ROW({ process: PEAK })]);
  assert.equal(ghostTraces(tab()), 0);
});

test("test_a_staged_edit_draws_the_applied_reference_as_a_ghost_trace", async () => {
  await reset([ROW({ process: PEAK })]);
  await stagePipelines([ROW({ process: "iir:type=peak;f=100;q=1;g=-9" })]);
  assert.equal(ghostTraces(tab()), 1);
});

test("test_a_stereo_pair_reference_is_a_single_curve", async () => {
  await reset([ROW({ process: PEAK }), ROW({ source: "1", mixdown: "1", process: PEAK })]);
  await stagePipelines([
    ROW({ process: "iir:type=peak;f=100;q=1;g=-9" }),
    ROW({ source: "1", mixdown: "1", process: "iir:type=peak;f=100;q=1;g=-9" }),
  ]);
  assert.equal(ghostTraces(tab()), 1);
});

test("test_the_band_strip_always_stands_under_the_plot", async () => {
  await reset([ROW({ process: PEAK })]);
  assert.ok(tab().includes('class="band-strip"'));
});

test("test_an_unselected_strip_names_no_band", async () => {
  await reset([ROW({ process: PEAK })]);
  assert.equal(bandTitle(tab()), "");
});

test("test_an_unselected_strip_still_shows_the_full_control_skeleton", async () => {
  // fixed geometry: the idle trio is the same rows the live controls use
  await reset([ROW({ process: PEAK })]);
  assert.equal((strip(tab()).match(/class="band-arg"/g) || []).length, 3);
});

test("test_the_idle_skeleton_controls_are_disabled", async () => {
  await reset([ROW({ process: PEAK })]);
  assert.equal((strip(tab()).match(/disabled/g) || []).length, 6); // 3 sliders + 3 boxes
});

test("test_the_band_strip_names_the_pipeline_the_selected_band_runs_in", async () => {
  await reset([ROW({ process: PEAK })]);
  selectedStage.value = { row: 0, stage: 0 };
  assert.deepEqual(bandNumbers(tab()), [1]);
});

test("test_a_stereo_pair_band_is_named_with_both_pipelines", async () => {
  await reset([ROW({ process: PEAK }), ROW({ source: "1", mixdown: "1", process: PEAK })]);
  selectedStage.value = { row: 0, stage: 0 };
  assert.deepEqual(bandNumbers(tab()), [1, 2]);
});

test("test_a_diverged_pair_band_is_named_with_its_own_pipeline_only", async () => {
  await reset([ROW({ process: PEAK }), ROW({ source: "1", mixdown: "1", process: "iir:type=peak;f=200;q=1;g=-3" })]);
  selectedStage.value = { row: 0, stage: 0 };
  assert.deepEqual(bandNumbers(tab()), [1]);
});

// A shared band is matched by CONTENT, never by chain position: crossfeed-block
// rows carry the same EQ offset behind lp1/delay structural stages, and an
// index-based twin rule split those pairs on every drag (the "duplication" bug).
test("test_a_twin_band_offset_behind_a_structural_stage_still_names_both", async () => {
  await reset([ROW({ process: PEAK }), ROW({ source: "1", mixdown: "1", process: `iir:type=lp1;f=1143.2,${PEAK}` })]);
  selectedStage.value = { row: 0, stage: 0 };
  assert.deepEqual(bandNumbers(tab()), [1, 2]);
});

// Three sharers is past the point where naming each one fits, so the strip
// reports how many there are — the count is the contract.
test("test_a_band_shared_by_many_pipelines_names_the_count", async () => {
  await reset([
    ROW({ process: PEAK }),
    ROW({ source: "1", mixdown: "1", process: PEAK }),
    ROW({ source: "0", mixdown: "0", process: `iir:type=lp1;f=1143.2,${PEAK}` }),
  ]);
  selectedStage.value = { row: 0, stage: 0 };
  assert.deepEqual(bandNumbers(tab()), [3]);
});

test("test_a_peak_offers_a_control_per_schema_argument", async () => {
  // peak: f, g, and the q of its one-of group — three slider rows
  await reset([ROW({ process: PEAK })]);
  selectedStage.value = { row: 0, stage: 0 };
  assert.equal((strip(tab()).match(/class="band-arg"/g) || []).length, 3);
});

test("test_each_strip_slot_carries_a_knob_dial", async () => {
  await reset([ROW({ process: PEAK })]);
  assert.equal((strip(tab()).match(/class="knob-dial"/g) || []).length, 3);
});

// The dial's aria contract stays in real units even on a log track — the box
// is uncontrolled (ref-synced), so aria is the value surface SSR can see.
test("test_the_q_knob_carries_the_stage_value_in_real_units", async () => {
  await reset([ROW({ process: PEAK })]);
  selectedStage.value = { row: 0, stage: 0 };
  assert.ok(strip(tab()).includes('aria-valuemin="0.1" aria-valuemax="16" aria-valuenow="1"'));
});

test("test_the_gain_knob_spans_the_plots_db_ceiling", async () => {
  await reset([ROW({ process: PEAK })]);
  selectedStage.value = { row: 0, stage: 0 };
  assert.ok(strip(tab()).includes('aria-valuemin="-24" aria-valuemax="24" aria-valuenow="-3"'));
});

test("test_an_out_of_range_stage_value_clamps_to_the_strip_range", async () => {
  // f=0 would be -Infinity on the log track; the strip clamps into its range
  await reset([ROW({ process: "iir:type=peak;f=0;q=1;g=-3" })]);
  selectedStage.value = { row: 0, stage: 0 };
  assert.ok(strip(tab()).includes('aria-valuemin="20" aria-valuemax="20000" aria-valuenow="20"'));
});

test("test_a_convolution_selection_leaves_the_strip_controls_disabled", async () => {
  await reset([ROW({ process: "impulses/room.wav" })]);
  selectedStage.value = { row: 0, stage: 0 };
  assert.ok(strip(tab()).includes("disabled"));
});

test("test_a_delay_selection_leaves_the_strip_controls_disabled", async () => {
  await reset([ROW({ process: "delay:t=0.01" })]);
  selectedStage.value = { row: 0, stage: 0 };
  assert.ok(strip(tab()).includes("disabled"));
});

test("test_a_biquad_selection_leaves_the_strip_controls_disabled", async () => {
  await reset([ROW({ process: "iir:type=biquad;b0=1;b1=0;b2=0;a0=1;a1=0;a2=0" })]);
  selectedStage.value = { row: 0, stage: 0 };
  assert.ok(strip(tab()).includes("disabled"));
});

test("test_a_selected_peaks_strip_controls_are_live", async () => {
  await reset([ROW({ process: PEAK })]);
  selectedStage.value = { row: 0, stage: 0 };
  assert.equal(strip(tab()).includes("disabled"), false);
});
