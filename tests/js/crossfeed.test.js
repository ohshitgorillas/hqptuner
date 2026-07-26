// Behavioral suite for components/Crossfeed.js — the one crossfeed card: the
// Bauer/Structural view segment, the Bauer half (fields + compensation strip),
// the structural half (controls, geometry, readouts), and the conflict note.
//
// Inputs are the exported store signals the exemplar suites drive: the config
// baseline carries the pipeline rows (`effectivePipelines`), `matrixConfig`
// carries the /matrix form fields, `xfMode`/`liveParams`/`remember` (lib/xfmode.js)
// carry the view choice and the structural controls' memory — all public, all
// reset every test. Blocks are built with the real compiler, never hand-typed.
//
// The readout numbers asserted here are physics of the published model (Brown &
// Duda via lib/binaural.js) at stated control values — contract facts a listener
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

import { html } from "../../hqptuner/static/lib/dom.js";
import { CrossfeedCard } from "../../hqptuner/static/components/Crossfeed.js";
import { config, matrixConfig, discardAll } from "../../hqptuner/static/store/state.js";
import { setShowDescriptions } from "../../hqptuner/static/store/prefs.js";
import { xfMode, liveParams, remember } from "../../hqptuner/static/lib/xfmode.js";
import { compileRows, HEAD_RADIUS, SPEAKER_ANGLE } from "../../hqptuner/static/lib/binaural.js";
import { staticWire } from "./wire.js";

const EQ = "iir:type=peak;f=1000;q=1;g=-3";

const row = (source, mixdown) => ({ gain: "-3", gainunit: "dB", mixdown, process: EQ, source });
const pair = () => [row("0", "0"), row("1", "1")];

// An installed structural block at the given controls.
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

// Full reset every time — every one of these signals outlives a test.
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

const buttons = (out) =>
  out
    .split("<button")
    .slice(1)
    .map((s) => s.split("</button>")[0]);
const button = (out, text) => buttons(out).find((b) => b.slice(b.indexOf(">") + 1).trim() === text);
const attrs = (b) => b.slice(0, b.indexOf(">"));

// --- the card shell -----------------------------------------------------------

test("test_the_card_opens_expanded_by_default", async () => {
  await reset();
  assert.ok(card().includes('<div class="card-body">'));
});

test("test_the_card_head_offers_the_bauer_view", async () => {
  await reset();
  assert.notEqual(button(card(), "Bauer"), undefined);
});

test("test_the_card_head_offers_the_structural_view", async () => {
  await reset();
  assert.notEqual(button(card(), "Structural"), undefined);
});

test("test_the_selected_view_lights_its_segment_button", async () => {
  await reset({ mode: "structural" });
  assert.ok(attrs(button(card(), "Structural")).includes('class="seg active"'));
});

test("test_plain_rows_open_on_the_bauer_view_when_nothing_is_stored", async () => {
  await reset({ rows: pair(), mode: null });
  assert.ok(card().includes("Crossfeed compensation"));
});

test("test_an_installed_block_opens_on_the_structural_view_when_nothing_is_stored", async () => {
  await reset({ rows: structural(), mode: null });
  assert.ok(card().includes('class="xfs-controls"'));
});

test("test_a_stored_view_choice_wins_over_the_installed_rows", async () => {
  await reset({ rows: structural(), mode: "bauer" });
  assert.ok(card().includes("Crossfeed compensation"));
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
  assert.ok(card().includes("397 µs at low frequencies"));
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

test("test_structural_without_a_block_offers_turn_on", async () => {
  await reset({ mode: "structural" });
  assert.notEqual(button(card(), "Turn on"), undefined);
});

test("test_structural_with_a_block_offers_turn_off", async () => {
  await reset({ rows: structural(), mode: "structural" });
  assert.notEqual(button(card(), "Turn off"), undefined);
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
  assert.ok(card().includes("hat sizes"));
});

// --- conflict blockers -------------------------------------------------------------

test("test_a_running_bauer_crossfeed_blocks_the_install_with_its_reason", async () => {
  await reset({ mode: "structural", enabled: true });
  assert.ok(card().includes("two crossfeeds in series."));
});

test("test_linear_phase_conversion_blocks_the_install_with_its_reason", async () => {
  await reset({ mode: "structural", iir2fir: "2" });
  assert.ok(card().includes("Linear-phase conversion flattens the group delay"));
});

test("test_a_clean_config_shows_no_blocker_note", async () => {
  await reset({ mode: "structural" });
  assert.equal(card().includes("xfs-blocked"), false);
});

test("test_an_installed_block_shows_no_blocker_note", async () => {
  await reset({ rows: structural(), mode: "structural", enabled: true });
  assert.equal(card().includes("xfs-blocked"), false);
});
