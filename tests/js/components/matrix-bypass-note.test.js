// Behavioural suite for the "matrix bypassed" note — the line the Matrix tab
// shows when HQPlayer's matrix engine is switched out of the signal path, so
// that everything authored on the tab is inert.
//
// The note reads exactly:
//
//     Matrix engine is bypassed. These settings have no effect.
//
// and belongs to the cards whose contents ARE matrix pipeline rows: Pipelines,
// Headphone Auto EQ, and the Crossfeed card in its Structural view (structural
// crossfeed is sixteen compiled pipeline rows).
//
// The Matrix response card takes a note of its own, worded for a picture rather
// than for controls:
//
//     Matrix engine is bypassed. The changes below are not applied.
//
// and takes it CONDITIONALLY: a plot with nothing drawn on it has no "below" to
// be unapplied, so a bare passthrough pipeline set stays silent even while the
// engine is bypassed.
//
// One exclusion, with a negative case rather than a silence: the Speakers card.
// HQPlayer's `<speakers>` element carries its own `enabled` attribute independent
// of `<matrix enabled>` (hqplayerd-readme.txt §1.9), so the level and distance
// trims still take effect while the matrix engine is bypassed and the note would
// be a false claim there.
//
// The Crossfeed card's Bauer view takes the note in both views, and
// matrix-postprocess-gating.test.js is where that is pinned: `<post_process>`
// nests inside `<matrix>` (§1.11.2) and §1.11's `enabled` is the matrix
// processing switch, so a bypassed matrix runs the Bauer plugin no more than it
// runs structural rows.
//
// Policy (docs/testing.md): public API only, one assertion per test. Every case
// renders the exported `MatrixTab` or the exported `SpeakersCard`, driven by the
// exported store signals carrying the daemon's own /matrix form (`enabled` is
// the daemon field behind the `matrix_enabled` schema key), by the exported
// crossfeed view signal (`xfMode`, store/xfmode.js) and by `edit()` over the
// staging wire fake on the real REST paths (tests/js/support/wire.js). Nothing
// is stubbed and no module private is touched.
//
// The note's PLACEMENT is not asserted: which element carries it and which class
// it wears are free to change, so the cases ask only whether the text is present
// in the card's rendered output. Every card lookup goes through `noteIn`, which
// answers a STRING rather than a boolean when the card was not rendered at all —
// so a negative case cannot pass by looking at nothing.
//
// One reading taken where the spec left room, reported in the hand-back: "no
// pipeline row control renders disabled" is asserted as *the bypass changes
// nothing about what is disabled*, the row controls compared against the same
// rows under an ENGAGED engine. A literal "nothing in a row is disabled" cannot
// hold for reasons that predate this feature and have nothing to do with it
// (Import EQ is disabled until EQ text is loaded, an untouched pipeline cannot
// be cleared), so it would fail on a correct implementation. The claim that
// matters — the note informs and never gates — is exactly the difference being
// zero.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/matrix-bypass-note.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { MatrixTab } from "../../../hqptuner/static/components/MatrixTab.js";
import { SpeakersCard, chooseSet } from "../../../hqptuner/static/components/SpeakersCard.js";
import { config, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { speakers } from "../../../hqptuner/static/store/speakers.js";
import { matrixMode } from "../../../hqptuner/static/store/matrixmode.js";
import { xfMode } from "../../../hqptuner/static/store/xfmode.js";
import { compileRows } from "../../../hqptuner/static/lib/binaural/compile.js";
import { HEAD_RADIUS, SPEAKER_ANGLE } from "../../../hqptuner/static/lib/binaural/geometry.js";
import { BAUER_PRESETS } from "../../../hqptuner/static/lib/xfeed.js";
import { edit, discardAll } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { plottedRows, previewEq } from "../../../hqptuner/static/components/MatrixPlot.js";
import { selectedStage } from "../../../hqptuner/static/components/BandStrip.js";
import { stagingWire } from "../support/wire.js";

const NOTE = "Matrix engine is bypassed. These settings have no effect.";
const PLOT_NOTE = "Matrix engine is bypassed. The changes below are not applied.";

const PEAK = "iir:type=peak;f=100;q=1;g=-3";
/** @typedef {import("../../../hqptuner/static/lib/matrixspec.js").PipelineRow} PipelineRow */

/** @param {Partial<PipelineRow>} patch */
const ROW = (patch) => ({ source: "0", gain: "0", gainunit: "dB", mixdown: "0", process: "", ...patch });
// A stereo pair carrying EQ, so there is a curve to draw; and the same pair as
// bare passthrough, so there is not.
const ROWS = [ROW({ process: PEAK }), ROW({ source: "1", mixdown: "1", process: PEAK })];
const BARE = [ROW({}), ROW({ source: "1", mixdown: "1" })];

// An installed structural crossfeed block, built with the real compiler — the
// daemon's own serialization, not a fixture.
const STRUCTURAL = () =>
  compileRows({
    lambda: 1,
    angle: SPEAKER_ANGLE,
    headRadius: HEAD_RADIUS,
    srcA: 0,
    srcB: 1,
    preampDb: -3,
    eqProcess: PEAK,
  });

const DEF = BAUER_PRESETS.default;

// A placed speaker set in the daemon's own /speakers shape, so the speaker card
// has channels to draw.
/**
 * @param {number} index
 * @param {string} label
 */
const CH = (index, label) => ({
  index,
  label,
  level: 0,
  distance: 300,
  level_min: -60,
  level_max: 0,
  level_step: 0.1,
  distance_min: 0,
  distance_max: 5000,
});
const NAMES = ["Left", "Right", "Center", "LFE", "Left rear", "Right rear", "Left side", "Right side"];
const SPK = { enabled: false, channels: NAMES.map((n, i) => CH(i, n)) };

// Full reset every time — every signal touched here outlives a test. The default
// DSP mode is headphones, the mode the Headphone Auto EQ and Crossfeed cards
// render in; the Pipelines card renders in both.
/**
 * @param {{
 *   on?: string,
 *   rows?: PipelineRow[],
 *   mode?: string,
 *   view?: string | null,
 * }} [fixture]
 * @returns {Promise<void>}
 */
async function reset({ on = "0", rows = ROWS, mode = "headphones", view = null } = {}) {
  stagingWire();
  showDescriptions.value = false;
  // An empty set is "auto-select whatever has something to draw", and no staged
  // preview curve — the plot's content is then the pipeline rows and nothing else.
  plottedRows.value = new Set();
  previewEq.value = null;
  selectedStage.value = null;
  speakers.value = SPK;
  matrixConfig.value = {
    fields: [
      { name: "enabled", value: on },
      { name: "post_bauer_enabled", value: "0" },
      { name: "post_bauer_preset", value: "default" },
      { name: "post_bauer_frequency", value: String(DEF.fc) },
      { name: "post_bauer_level", value: String(DEF.feed) },
    ],
    rows: [],
  };
  config.value = {
    fields: [],
    file: { matrix_pipelines: JSON.stringify(rows) },
    active: "",
    profiles: null,
  };
  await discardAll();
  matrixMode.value = mode;
  xfMode.value = view;
  chooseSet("2.0");
}

// --- rendering ----------------------------------------------------------------
// SSR escapes entities; the contract is the text a user reads, not its encoding.

/** @param {string} out */
const decode = (out) =>
  out
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const tab = () => decode(render(html`<${MatrixTab} />`));
const speakerCard = () => decode(render(html`<${SpeakersCard} />`));

// One card's rendered output, picked by the heading it carries. Cards are
// `<section class="card ...">` with the title in the head above the body
// (tests/js/components/common.test.js), so a split on the section start yields
// one fragment per card and the head is whatever precedes its body.
/** @param {string} out */
const cardsOf = (out) => out.split('<section class="card').slice(1);
/** @param {string} frag */
const headOf = (frag) => {
  const at = frag.indexOf('<div class="card-body"');
  return at < 0 ? frag : frag.slice(0, at);
};
/**
 * @param {string} out
 * @param {RegExp} re
 */
const cardTitled = (out, re) => cardsOf(out).find((frag) => re.test(headOf(frag))) || "";

// Whether a card carries a given sentence — or a sentence saying the card was
// never rendered, which equals neither true nor false and so fails either way
// round.
/**
 * @param {string} frag
 * @param {string} text
 * @returns {boolean | string}
 */
const says = (frag, text) => (frag === "" ? "that card was not rendered at all" : frag.includes(text));
/** @param {string} frag */
const noteIn = (frag) => says(frag, NOTE);
/** @param {string} frag */
const plotNoteIn = (frag) => says(frag, PLOT_NOTE);

/** @param {string} out */
const pipelinesCard = (out) => cardTitled(out, /Pipelines/);
/** @param {string} out */
const autoEqCard = (out) => cardTitled(out, /Headphone\s*Auto\s*EQ/i);
/** @param {string} out */
const crossfeedCard = (out) => cardTitled(out, /Crossfeed/i);
/** @param {string} out */
const responseCard = (out) => cardTitled(out, /Matrix response/i);

// The pipeline rows of the pipelines card, and the disabled state of every
// control inside each one, in render order.
/** @param {string} out */
const rowsOf = (out) => out.split('<div class="mtx-row ').slice(1);
/** @param {string} tag */
const isDisabled = (tag) => /\bdisabled\b/.test(tag);
/**
 * @param {string} out
 * @returns {boolean[][]}
 */
const rowControlStates = (out) =>
  rowsOf(pipelinesCard(out)).map((row) => (row.match(/<(?:button|input|select)[^>]*>/g) || []).map(isDisabled));

/** @param {string} out */
const buttonsOf = (out) =>
  out
    .split("<button")
    .slice(1)
    .map((s) => s.split("</button>")[0]);
/** @param {string} out */
const addPipelineButton = (out) => buttonsOf(pipelinesCard(out)).find((b) => b.includes("Add pipeline"));

// ============================================================================
// the Pipelines card
// ============================================================================

test("test_a_bypassed_matrix_engine_tells_the_pipelines_card_its_settings_are_inert", async () => {
  await reset({ on: "0" });
  assert.equal(noteIn(pipelinesCard(tab())), true);
});

test("test_an_engaged_matrix_engine_leaves_the_pipelines_card_without_the_note", async () => {
  await reset({ on: "1" });
  assert.equal(noteIn(pipelinesCard(tab())), false);
});

// The note follows the EFFECTIVE value — what the user has staged over the
// daemon's running value — rather than the value the daemon is running.
test("test_the_note_clears_when_the_effective_matrix_gate_is_staged_on", async () => {
  await reset({ on: "0" });
  await edit("matrix_enabled", "1");
  assert.equal(noteIn(pipelinesCard(tab())), false);
});

test("test_the_note_appears_when_the_effective_matrix_gate_is_staged_off", async () => {
  await reset({ on: "1" });
  await edit("matrix_enabled", "0");
  assert.equal(noteIn(pipelinesCard(tab())), true);
});

// ============================================================================
// the note informs, it never gates
// ============================================================================
// Binding product rule: HQPTuner never disables a user action, whatever the
// daemon is doing. A bypassed engine leaves the editor exactly as usable as an
// engaged one — asserted as the difference between the two being nil, over a row
// set proved to be there and to carry controls.

test("test_a_bypassed_matrix_engine_leaves_row_control_disabled_states_unchanged", async () => {
  await reset({ on: "0" });
  const bypassed = rowControlStates(tab());
  await reset({ on: "1" });
  const engaged = rowControlStates(tab());
  assert.ok(
    bypassed.length === ROWS.length &&
      bypassed.every((row) => row.length > 0) &&
      JSON.stringify(bypassed) === JSON.stringify(engaged),
    `bypassed rows ${JSON.stringify(bypassed)} vs engaged rows ${JSON.stringify(engaged)}`,
  );
});

test("test_a_bypassed_matrix_engine_leaves_add_pipeline_enabled", async () => {
  await reset({ on: "0" });
  const add = addPipelineButton(tab());
  assert.ok(
    add !== undefined && !isDisabled(add),
    add === undefined ? "no + Add pipeline button was rendered" : "+ Add pipeline rendered disabled",
  );
});

// ============================================================================
// the Headphone Auto EQ card
// ============================================================================

test("test_a_bypassed_matrix_engine_tells_the_headphone_auto_eq_card_its_settings_are_inert", async () => {
  await reset({ on: "0" });
  assert.equal(noteIn(autoEqCard(tab())), true);
});

test("test_an_engaged_matrix_engine_leaves_the_headphone_auto_eq_card_without_the_note", async () => {
  await reset({ on: "1" });
  assert.equal(noteIn(autoEqCard(tab())), false);
});

// ============================================================================
// the Crossfeed card
// ============================================================================
// Structural crossfeed IS matrix pipeline rows, so a bypassed engine takes it
// out of the signal path with everything else.

test("test_a_bypassed_matrix_engine_tells_the_structural_crossfeed_view_its_settings_are_inert", async () => {
  await reset({ on: "0", rows: STRUCTURAL(), view: "structural" });
  assert.equal(noteIn(crossfeedCard(tab())), true);
});

test("test_an_engaged_matrix_engine_leaves_the_structural_crossfeed_view_without_the_note", async () => {
  await reset({ on: "1", rows: STRUCTURAL(), view: "structural" });
  assert.equal(noteIn(crossfeedCard(tab())), false);
});

// ============================================================================
// the Matrix response card
// ============================================================================
// A picture, not controls — so its sentence is about the curve being unapplied,
// and it is only said when there is a curve. The plot's content comes from the
// effective pipeline rows: a pair carrying an iir stage draws something, a bare
// passthrough pair draws nothing.

test("test_a_bypassed_matrix_engine_tells_the_response_card_its_curve_is_not_applied", async () => {
  await reset({ on: "0", rows: ROWS });
  assert.equal(plotNoteIn(responseCard(tab())), true);
});

// The conditional, and the case that carries the feature: nothing drawn means
// nothing to call unapplied, bypassed engine or not.
test("test_a_bypassed_matrix_engine_says_nothing_on_a_response_card_with_nothing_drawn", async () => {
  await reset({ on: "0", rows: BARE });
  assert.equal(plotNoteIn(responseCard(tab())), false);
});

test("test_an_engaged_matrix_engine_leaves_the_response_card_without_a_note", async () => {
  await reset({ on: "1", rows: ROWS });
  assert.equal(plotNoteIn(responseCard(tab())), false);
});

// The two sentences stay two sentences: the response card never falls back to
// the controls wording, which would tell the user their settings have no effect
// while pointing at a picture.
test("test_the_response_card_does_not_use_the_settings_wording", async () => {
  await reset({ on: "0", rows: ROWS });
  assert.equal(noteIn(responseCard(tab())), false);
});

// ============================================================================
// the card that is NOT about the matrix engine
// ============================================================================
// The speaker trims are HQPlayer's own `<speakers>` element, gated by its own
// `enabled` attribute (hqplayerd-readme.txt §1.9). They keep working while the
// matrix engine is bypassed, so claiming otherwise would be a lie on screen.

test("test_a_bypassed_matrix_engine_leaves_the_speakers_card_without_the_note", async () => {
  await reset({ on: "0", mode: "speakers" });
  assert.equal(noteIn(speakerCard()), false);
});
