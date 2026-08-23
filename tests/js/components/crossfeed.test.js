// Behavioral suite for components/xfeed/Card.js — the one crossfeed card: the
// Bauer/Structural view segment, the Bauer half (fields + compensation strip),
// the structural half (controls, geometry, readouts), and the conflict note.
//
// Inputs are the exported store signals the exemplar suites drive: the config
// baseline carries the pipeline rows (`effectivePipelines`), `matrixConfig`
// carries the /matrix form fields, `xfMode`/`liveParams`/`remember` (store/xfeed/mode.js)
// carry the view choice and the structural controls' memory — all public, all
// reset every test. Blocks are built with the real compiler, never hand-typed.
//
// The readout numbers asserted here are physics of the published model (Brown &
// Duda via lib/binaural/geometry.js) at stated control values — contract facts a listener
// reads off the card, not implementation echoes.
//
// NOT covered, because SSR never fires an event handler and module-private
// signals have no public writer (docs/testing.md "Branches that cannot be
// reached"): the collapsed card (cardOpen — its open default IS asserted), the
// opened Bauer response plot (plotOpen), the collapsed compensation section
// (compOpen), the opened structural response plot and with it the private
// StructuralPlot's trace construction (structPlotOpen), the issueNote banner
// (written only by Turn on / Turn off / commit handlers), the preset select's
// onChange, the Control sliders' drag/commit handlers, and the segment's
// onClick (the mode-switch logic it calls is covered in xfmode.test.js). Those
// pointer paths belong to the playwright hand-back protocol.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/crossfeed.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { CrossfeedCard } from "../../../hqptuner/static/components/xfeed/Card.js";
import { config, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { discardAll, edit, stagePipelines } from "../../../hqptuner/static/store/actions.js";
import { setShowDescriptions } from "../../../hqptuner/static/store/prefs.js";
import {
  xfMode,
  liveParams,
  remember,
  stageStructural,
  removeStructural,
  structuralBlock,
} from "../../../hqptuner/static/store/xfeed/mode.js";
import { compileRows } from "../../../hqptuner/static/lib/binaural/compile.js";
import { HEAD_RADIUS, SPEAKER_ANGLE } from "../../../hqptuner/static/lib/binaural/geometry.js";
import { staticWire, stagingWire } from "../support/wire.js";
import { hasLabel } from "../support/markup.js";

/**
 * @typedef {import("../../../hqptuner/static/lib/matrixspec.js").PipelineRow} PipelineRow
 * @typedef {Parameters<typeof compileRows>[0]} StructuralControls
 */

const EQ = "iir:type=peak;f=1000;q=1;g=-3";

/**
 * @param {string} source
 * @param {string} mixdown
 * @returns {PipelineRow}
 */
const row = (source, mixdown) => ({ gain: "-3", gainunit: "dB", mixdown, process: EQ, source });
const pair = () => [row("0", "0"), row("1", "1")];

// An installed structural block at the given controls.
/** @param {StructuralControls} [over] */
const structural = (over = {}) =>
  compileRows({
    lambda: 1,
    angle: 30,
    headRadius: HEAD_RADIUS,
    srcA: 0,
    srcB: 1,
    preampDb: -3,
    eqProcess: EQ,
    ...over,
  });

// The structural block a compiled set of rows carries, for the tests that hand
// the recognition back to removeStructural.
/** @param {PipelineRow[]} rows */
const recognized = (rows) => {
  const rec = structuralBlock(rows);
  if (rec === null) throw new Error("the compiled rows carry no structural block");
  return rec;
};

// Full reset every time — every one of these signals outlives a test.
/**
 * @param {{ rows?: PipelineRow[], mode?: "bauer" | "structural" | null, enabled?: boolean,
 *   iir2fir?: string, notes?: boolean }} [opts]
 */
async function reset({ rows = pair(), mode = null, enabled = false, iir2fir = "0", notes = false } = {}) {
  staticWire();
  matrixConfig.value = {
    fields: [
      { name: "post_bauer_enabled", value: enabled },
      { name: "post_bauer_preset", value: "default" },
      { name: "post_bauer_frequency", value: "700" },
      { name: "post_bauer_level", value: "4.5" },
      { name: "iir2fir", value: iir2fir },
    ],
  };
  config.value = { fields: [], file: { matrix_pipelines: JSON.stringify(rows) } };
  setShowDescriptions(notes);
  xfMode.value = mode;
  liveParams.value = null;
  remember({ lambda: 1, angle: SPEAKER_ANGLE, headRadius: HEAD_RADIUS });
  await discardAll();
}

// The contract is the text a user reads, not its HTML encoding.
const card = () =>
  render(html`<${CrossfeedCard} />`)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'");

/** @param {string} out */
const buttons = (out) =>
  out
    .split("<button")
    .slice(1)
    .map((s) => s.split("</button>")[0]);

// A segment button by the wire value it stands for — the view choice's own
// `xfMode` value, or the gate's "0"/"1" — never by the word printed on it
// (docs/testing.md rule 9).
/**
 * @param {string} out
 * @param {string} value
 */
const seg = (out, value) =>
  buttons(out).find((b) => new RegExp(`\\sdata-v="${value}"`).test(b.slice(0, b.indexOf(">"))));

// The compensation strip's Turn on button, identified by the `data-issue` code
// it carries. Undefined when the view renders no such button.
/** @param {string} out */
const turnOn = (out) => buttons(out).find((b) => /\sdata-issue(\s|=|$)/.test(b.slice(0, b.indexOf(">"))));

// The attribute run of a button, which the callers reach only for a button they
// have already established is present.
/** @param {string | undefined} b */
const attrs = (b) => {
  if (b === undefined) throw new Error("no such button in the rendered card");
  return b.slice(0, b.indexOf(">"));
};

// --- the card shell -----------------------------------------------------------

test("test_the_card_opens_expanded_by_default", async () => {
  await reset();
  assert.ok(card().includes('<div class="card-body">'));
});

test("test_the_card_offers_the_bauer_view", async () => {
  await reset();
  assert.notEqual(seg(card(), "bauer"), undefined);
});

test("test_the_card_offers_the_structural_view", async () => {
  await reset();
  assert.notEqual(seg(card(), "structural"), undefined);
});

test("test_the_selected_view_lights_its_segment_button", async () => {
  await reset({ mode: "structural" });
  assert.ok(attrs(seg(card(), "structural")).includes('class="seg active"'));
});

test("test_plain_rows_open_on_the_bauer_view_when_nothing_is_stored", async () => {
  await reset({ rows: pair(), mode: null });
  assert.ok(attrs(seg(card(), "bauer")).includes('class="seg active"'));
});

test("test_an_installed_block_opens_on_the_structural_view_when_nothing_is_stored", async () => {
  await reset({ rows: structural(), mode: null });
  assert.ok(card().includes('class="xfs-controls"'));
});

test("test_a_stored_view_choice_wins_over_the_installed_rows", async () => {
  await reset({ rows: structural(), mode: "bauer" });
  assert.ok(attrs(seg(card(), "bauer")).includes('class="seg active"'));
});

// --- the bauer half -------------------------------------------------------------

test("test_bauer_view_dims_its_body_while_crossfeed_is_off", async () => {
  await reset({ enabled: false });
  assert.ok(card().includes('class="dsp-body off"'));
});

test("test_bauer_view_wakes_its_body_while_crossfeed_is_on", async () => {
  await reset({ enabled: true });
  assert.equal(card().includes('class="dsp-body off"'), false);
});

test("test_bauer_view_keeps_its_response_plot_collapsed", async () => {
  await reset({ enabled: true });
  assert.equal(card().includes('class="dsp-plot"'), false);
});

test("test_bauer_view_opens_the_compensation_strip_by_default", async () => {
  await reset({ enabled: true });
  assert.ok(card().includes('<div class="xfc-strip'));
});

test("test_bauer_view_renders_the_mini_correction_plot_while_crossfeed_is_on", async () => {
  await reset({ enabled: true });
  assert.ok(card().includes('class="xfc-mini"'));
});

// --- the structural readouts ------------------------------------------------------
// Defaults are 30°, an 8.75 cm head and 100% center character; the block below
// is compiled at 45° / 50%. The µs and dB figures are the model's own numbers.

test("test_structural_defaults_report_the_ear_to_ear_delay", async () => {
  await reset({ mode: "structural" });
  assert.ok(card().includes("261 µs"));
});

test("test_structural_defaults_report_the_low_frequency_delay", async () => {
  await reset({ mode: "structural" });
  assert.ok(card().includes("397 µs"));
});

test("test_structural_defaults_report_the_far_ear_treble_shadow", async () => {
  await reset({ mode: "structural" });
  assert.ok(card().includes("-11.0 dB"));
});

test("test_structural_defaults_report_the_center_shift", async () => {
  await reset({ mode: "structural" });
  assert.ok(card().includes("-1.80 dB"));
});

test("test_the_readouts_follow_an_installed_blocks_controls", async () => {
  await reset({ rows: structural({ angle: 45, lambda: 0.5 }), mode: "structural" });
  assert.ok(card().includes("381 µs"));
});

test("test_a_non_negative_center_shift_gains_a_plus_sign", async () => {
  // λ=0 is the only non-negative shift the controls can reach: a neutral center
  // shifts by exactly 0.00 dB, and the card signs it "+" like a gain readout
  await reset({ rows: structural({ lambda: 0 }), mode: "structural" });
  assert.ok(card().includes("+0.00 dB"));
});

// --- the structural controls ------------------------------------------------------

test("test_the_structural_view_draws_the_geometry_diagram", async () => {
  await reset({ mode: "structural" });
  assert.ok(card().includes('class="spk-diagram"'));
});

test("test_the_structural_view_lists_the_named_presets", async () => {
  await reset({ mode: "structural" });
  assert.ok(card().includes('<option value="neutral">Neutral center</option>'));
});

test("test_on_preset_controls_offer_no_custom_option", async () => {
  await reset({ mode: "structural" }); // 30° / 100% is the Anechoic preset
  assert.equal(card().includes('value="custom"'), false);
});

test("test_off_preset_controls_gain_a_custom_option", async () => {
  await reset({ rows: structural({ angle: 33 }), mode: "structural" });
  assert.ok(card().includes('value="custom"'));
});

test("test_the_structural_response_plot_is_collapsed_by_default", async () => {
  await reset({ mode: "structural" });
  assert.equal(card().includes('class="xfs-plot"'), false);
});

test("test_hidden_notes_render_no_control_captions", async () => {
  await reset({ mode: "structural", notes: false });
  assert.equal(card().includes("xfs-caption"), false);
});

test("test_shown_notes_explain_each_physical_control", async () => {
  await reset({ mode: "structural", notes: true });
  assert.ok(card().includes("xfs-caption"));
});

// --- conflict blockers -------------------------------------------------------------
// Each blocker's own sentence is the owner's; WHICH conflict is being reported is
// the key it is built under (lib/binaural-setup.js), which the note carries in
// `data-blockers`, space-joined the way `data-backends` is (docs/testing.md rule
// 9). Reading the key tells the two conditions apart — asking only whether a
// blocker note exists made the two cases below one case written twice.

const BAUER_RUNNING = "crossfeed_enabled";
const LINEAR_PHASE = "matrix_iir2fir";

// The blockers the card is reporting, in sorted order so a case states a set
// rather than a render order. [] when it reports none.
//
// A card that never rendered at all answers a STRING, which no expected list can
// equal: "reports no blocker" and "drew nothing" are the same empty markup, so
// without the sentinel a negative case below would pass by looking at nothing.
// The card is found by the `data-card` its section carries, never by a word in it.
/** @returns {string[] | string} */
const blockers = () => {
  const out = card();
  if (!/\sdata-card="crossfeed"/.test(out)) return "that card was not rendered at all";
  const hit = /\sdata-blockers="([^"]*)"/.exec(out);
  return hit
    ? hit[1]
        .split(" ")
        .filter((key) => key !== "")
        .sort()
    : [];
};

test("test_a_running_bauer_crossfeed_blocks_the_install", async () => {
  await reset({ mode: "structural", enabled: true });
  assert.deepEqual(blockers(), [BAUER_RUNNING]);
});

test("test_linear_phase_conversion_blocks_the_install", async () => {
  await reset({ mode: "structural", iir2fir: "2" });
  assert.deepEqual(blockers(), [LINEAR_PHASE]);
});

// Both conditions at once: the note reports the pair, not whichever it noticed
// first — the case that separates a list from a single verdict.
test("test_both_conflicts_at_once_are_reported_together", async () => {
  await reset({ mode: "structural", enabled: true, iir2fir: "2" });
  assert.deepEqual(blockers(), [BAUER_RUNNING, LINEAR_PHASE].sort());
});

test("test_a_clean_config_shows_no_blocker_note", async () => {
  await reset({ mode: "structural" });
  assert.deepEqual(blockers(), []);
});

test("test_an_installed_block_shows_no_blocker_note", async () => {
  await reset({ rows: structural(), mode: "structural", enabled: true });
  assert.deepEqual(blockers(), []);
});

// --- the card-level gate stack ------------------------------------------------------
// The head is a plain collapse toggle; the ENGAGE|BYPASS gate, the view switch
// and the explanatory caption live in an `xfs-top` stack at the top of the body,
// in both views. The gate reads Bauer's `crossfeed_enabled` in one view and the
// installed-block fact in the other, and carries the staged-edit dirty accent.

// Class list of the gate wrapper element.
/** @param {string} out */
const gateClass = (out) => (out.match(/class="([^"]*\bxfs-gate\b[^"]*)"/) || ["", ""])[1].split(" ");

test("test_the_card_head_carries_no_view_segment", async () => {
  await reset();
  assert.equal(card().split('<div class="card-body">')[0].includes('class="seg'), false);
});

test("test_the_top_stack_precedes_the_per_mode_body", async () => {
  await reset({ mode: "bauer" });
  const out = card();
  assert.ok(out.indexOf('class="xfs-top"') < out.indexOf("dsp-body"), "xfs-top after the Bauer body");
});

test("test_bauer_view_opens_with_the_gate_stack", async () => {
  await reset({ mode: "bauer" });
  assert.ok(card().includes('class="xfs-top"'));
});

test("test_structural_view_opens_with_the_same_gate_stack", async () => {
  await reset({ mode: "structural" });
  assert.ok(card().includes('class="xfs-top"'));
});

// The caption that closed the top stack was the third anchor of the order case
// and the whole subject of two verbatim-copy cases. All three are gone: the
// caption is owner-owned wording with no machine identity beside it, so what
// survives is the order of the two identified controls (rule 9).

test("test_the_top_stack_orders_the_gate_before_the_view_switch", async () => {
  await reset({ mode: "bauer" });
  const out = card();
  const [g, v] = [out.indexOf("xfs-gate"), out.indexOf('data-v="bauer"')];
  assert.ok(g > -1 && v > -1 && g < v, `order gate=${g} switch=${v}`);
});

test("test_bauer_gate_lights_engage_while_crossfeed_is_enabled", async () => {
  await reset({ mode: "bauer", enabled: true });
  assert.ok(attrs(seg(card(), "1")).includes('class="seg active"'));
});

test("test_bauer_gate_lights_bypass_while_crossfeed_is_disabled", async () => {
  await reset({ mode: "bauer", enabled: false });
  assert.ok(attrs(seg(card(), "0")).includes('class="seg active"'));
});

test("test_bauer_gate_follows_a_staged_enable_over_the_applied_baseline", async () => {
  await reset({ mode: "bauer", enabled: false });
  stagingWire();
  await edit("crossfeed_enabled", "1");
  assert.ok(attrs(seg(card(), "1")).includes("active"));
});

test("test_structural_gate_lights_engage_when_a_block_is_installed", async () => {
  await reset({ rows: structural(), mode: "structural" });
  assert.ok(attrs(seg(card(), "1")).includes('class="seg active"'));
});

test("test_structural_gate_lights_bypass_when_no_block_is_installed", async () => {
  await reset({ rows: pair(), mode: "structural" });
  assert.ok(attrs(seg(card(), "0")).includes('class="seg active"'));
});

test("test_a_staged_crossfeed_edit_marks_the_bauer_gate_dirty", async () => {
  await reset({ mode: "bauer", enabled: false });
  stagingWire();
  await edit("crossfeed_enabled", "1");
  assert.ok(gateClass(card()).includes("dirty"));
});

test("test_an_untouched_bauer_gate_is_not_dirty", async () => {
  await reset({ mode: "bauer", enabled: false });
  assert.equal(gateClass(card()).includes("dirty"), false);
});

test("test_a_staged_install_of_the_block_marks_the_structural_gate_dirty", async () => {
  await reset({ rows: pair(), mode: "structural" });
  stagingWire();
  await stageStructural(pair(), { lambda: 1, angle: SPEAKER_ANGLE, headRadius: HEAD_RADIUS });
  assert.ok(gateClass(card()).includes("dirty"));
});

test("test_a_staged_removal_of_the_block_marks_the_structural_gate_dirty", async () => {
  await reset({ rows: structural(), mode: "structural" });
  stagingWire();
  await removeStructural(structural(), recognized(structural()));
  assert.ok(gateClass(card()).includes("dirty"));
});

test("test_row_edits_alone_leave_the_structural_gate_clean", async () => {
  // The block stays installed either way — retuning it is row dirt, not gate dirt.
  await reset({ rows: structural(), mode: "structural" });
  stagingWire();
  await stagePipelines(structural({ angle: 45 }));
  assert.equal(gateClass(card()).includes("dirty"), false);
});

test("test_an_untouched_structural_gate_is_not_dirty", async () => {
  await reset({ rows: pair(), mode: "structural" });
  assert.equal(gateClass(card()).includes("dirty"), false);
});

test("test_the_structural_view_offers_no_turn_on_button", async () => {
  await reset({ rows: pair(), mode: "structural" });
  assert.equal(turnOn(card()), undefined);
});

// The companion case pinning the ABSENCE of a Turn off button is gone with it:
// that button carries no machine identity, so the only way to ask for it was by
// its wording (rule 9).

test("test_the_bauer_view_renders_exactly_one_gate", async () => {
  await reset({ mode: "bauer" });
  assert.equal(card().split("xfs-gate").length - 1, 1);
});

test("test_the_bauer_view_renders_exactly_one_engage_button", async () => {
  // Counted as BUTTONS carrying the "1" wire value, not as occurrences of the
  // string: any other control that gained that value — a combobox option row,
  // a narrow bar label — would otherwise be counted as an engage button.
  await reset({ mode: "bauer" });
  const engage = buttons(card()).filter((b) => /\sdata-v="1"/.test(b.slice(0, b.indexOf(">"))));
  assert.equal(engage.length, 1);
});

test("test_the_bauer_preset_row_keeps_its_preset_dropdown", async () => {
  await reset({ mode: "bauer", enabled: true });
  assert.ok(hasLabel(card(), "crossfeed_preset"));
});
