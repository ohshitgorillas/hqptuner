// Behavioral suite for the "matrix bypassed" note — the line the Matrix tab
// shows when HQPlayer's matrix engine is switched out of the signal path, so
// that everything authored on the tab is inert.
//
// The note is one of two KINDS, forked on whether the card's own feature is
// engaged, and each kind names itself in `data-note`
// (components/matrix/BypassNote.js):
//
//     matrix-bypass-settings: the feature is engaged, so its settings are inert
//     matrix-bypass-engage:   the feature is off, so the note points at the switch
//
// A card whose feature is switched off still has grayed controls on screen, so it
// still gets an explanation — the engage note, which points at the engine rather
// than claiming settings the user is not using are inert.
//
// A card only says its settings have no effect when those settings are actually
// engaged: a user who has a feature switched off gets the engage note instead.
//
// The Pipelines card has no feature switch of its own — its contents ARE the
// matrix pipeline rows — so a bypassed engine always puts the settings note on
// it, rows or no rows, and it never carries the engage one. The Crossfeed card in
// its Structural view takes the settings note when a structural block is
// installed in the effective rows (structural crossfeed is sixteen compiled
// pipeline rows) and the engage note when none is. The Headphone Auto EQ card
// takes neither, ever.
//
// The Matrix response card takes a note of its own, worded for a picture rather
// than for controls — `matrix-bypass-custom`, the override kind — and takes it
// CONDITIONALLY: a plot with nothing drawn on it has nothing to call unapplied,
// so a bare passthrough pipeline set stays silent even while the engine is
// bypassed.
//
// WHAT any of the three says is owner copy and is named nowhere in this file. The
// two control sentences share an opening clause, so a classifier running one
// `includes()` per sentence reported "both" for the shorter of the two the moment
// the owner trimmed the other — a copy edit turning a suite red (rule 9).
//
// One exclusion, with a negative case rather than a silence: the Speakers card.
// HQPlayer's `<speakers>` element carries its own `enabled` attribute independent
// of `<matrix enabled>` (hqplayerd-readme.txt §1.9), so the level and distance
// trims still take effect while the matrix engine is bypassed and the note would
// be a false claim there.
//
// The Crossfeed card's Bauer view takes the note on the same two conditions,
// with `crossfeed_enabled` as the feature switch, and
// matrix-postprocess-gating.test.js is where that is pinned: `<post_process>`
// nests inside `<matrix>` (§1.11.2) and §1.11's `enabled` is the matrix
// processing switch, so a bypassed matrix runs the Bauer plugin no more than it
// runs structural rows. The DAC correction and Loudness cards are pinned there
// too, against `dac_correction_enabled` and `loudness_enabled`.
//
// Policy (docs/testing.md): public API only, one assertion per test. Every case
// renders the exported `MatrixTab` or the exported `SpeakersCard`, driven by the
// exported store signals carrying the daemon's own /matrix form (`enabled` is
// the daemon field behind the `matrix_enabled` schema key), by the exported
// crossfeed view signal (`xfMode`, store/xfeed/mode.js) and by `edit()` over the
// staging wire fake on the real REST paths (tests/js/support/wire.js). Nothing
// is stubbed and no module private is touched.
//
// The note's PLACEMENT is not asserted: which element carries the marking and
// which class it wears are free to change, so the cases ask only which kinds the
// card's rendered output carries. Every card lookup goes through `notesIn`, which
// answers a STRING rather than a list when the card was not rendered at all — so
// a negative case cannot pass by looking at nothing.
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
import { MatrixTab } from "../../../hqptuner/static/components/matrix/Tab.js";
import { SpeakersCard, chooseSet } from "../../../hqptuner/static/components/speakers/Card.js";
import { config, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { speakers } from "../../../hqptuner/static/store/matrix/speakers.js";
import { matrixMode } from "../../../hqptuner/static/store/matrix/mode.js";
import { xfMode } from "../../../hqptuner/static/store/xfeed/mode.js";
import { compileRows } from "../../../hqptuner/static/lib/binaural/compile.js";
import { HEAD_RADIUS, SPEAKER_ANGLE } from "../../../hqptuner/static/lib/binaural/geometry.js";
import { BAUER_PRESETS } from "../../../hqptuner/static/lib/xfeed.js";
import { edit, discardAll } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { plottedRows, previewEq } from "../../../hqptuner/static/components/matrix/Plot.js";
import { selectedStage } from "../../../hqptuner/static/components/matrix/BandStrip.js";
import { stagingWire } from "../support/wire.js";
import { section } from "../support/tabform.js";
import { elements, attr, text } from "../support/markup.js";

// The three notes by the kind each one carries, `data-note` — the identity the
// component derives from its inputs, not from the sentence it produced
// (components/matrix/BypassNote.js). No sentence of the three is named anywhere
// in this file: the two control notes share an opening clause, so shortening one
// of them — an ordinary copy edit — used to reclassify every card showing the
// other (docs/testing.md rule 9).
const SETTINGS = "matrix-bypass-settings";
const ENGAGE = "matrix-bypass-engage";
const CUSTOM = "matrix-bypass-custom";

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

// The same tab, undecoded: the markup scanner below reads attribute runs, and
// decoding an escaped quote back into a bare one puts a quote inside an
// attribute value where the scanner cannot see the tag end.
const tabMarkup = () => render(html`<${MatrixTab} />`);

// Every bypass note a card renders, by kind and in render order — the whole list
// rather than one question at a time, so a single assertion pins the note that
// belongs there AND the absence of the two that do not. A card showing two notes,
// or the wrong one, answers a different list and fails.
//
// Only notes of this feature are collected: `data-note` marks explanatory notes
// across the app (`narrow-intro`, `poll-quick`, …), and a card is free to carry
// one of those without carrying a bypass note.
//
// A card that was never rendered answers a STRING, which no expected list can
// equal — so a "this card says nothing" case cannot pass by looking at nothing.
/**
 * @param {string} frag
 * @returns {string[] | string}
 */
const notesIn = (frag) => {
  if (frag === "") return "that card was not rendered at all";
  return [...frag.matchAll(/\sdata-note="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((kind) => kind.startsWith("matrix-bypass-"));
};

// What the marked element actually shows a reader, markup stripped. The marking
// says which note the card CHOSE; on its own it cannot say the card explained
// itself, so a note element rendered with no children would satisfy every case
// above while the user sees nothing. Empty string when the card does not carry
// exactly one bypass note, so a missing or doubled note fails here too.
/**
 * @param {string} frag
 * @returns {string}
 */
const noteText = (frag) => {
  const marked = elements(frag).filter((el) => (attr(el, "data-note") || "").startsWith("matrix-bypass-"));
  return marked.length === 1 ? text(marked[0]) : "";
};

// Cards by the id their section carries (docs/testing.md rule 9). No card in
// this file is picked out by a word any more.
/** @param {string} out */
const pipelinesCard = (out) => section(out, "pipelines");
/** @param {string} out */
const autoEqCard = (out) => section(out, "headphone-auto-eq");
/** @param {string} out */
const crossfeedCard = (out) => section(out, "crossfeed");
/** @param {string} out */
const responseCard = (out) => section(out, "matrix-response");

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

// ============================================================================
// the Pipelines card
// ============================================================================

test("test_a_bypassed_matrix_engine_tells_the_pipelines_card_its_settings_are_inert", async () => {
  await reset({ on: "0" });
  assert.deepEqual(notesIn(pipelinesCard(tab())), [SETTINGS]);
});

// The one case that reads the note's own text — non-emptiness only. WHAT it says
// stays the owner's (rule 9); THAT the card said anything at all is state, and no
// other case in this file can see it.
test("test_the_bypass_note_the_pipelines_card_shows_is_not_empty", async () => {
  await reset({ on: "0" });
  const shown = noteText(pipelinesCard(tabMarkup()));
  assert.ok(shown.length > 0, `the pipelines card's bypass note reads ${JSON.stringify(shown)}`);
});

// The Pipelines card has no feature switch of its own, so there is no "switched
// off" state that could put sentence B on it: an empty pipeline set is still an
// editor whose contents the engine will not run.
test("test_a_bypassed_matrix_engine_tells_the_pipelines_card_its_settings_are_inert_with_no_rows", async () => {
  await reset({ on: "0", rows: [] });
  assert.deepEqual(notesIn(pipelinesCard(tab())), [SETTINGS]);
});

test("test_an_engaged_matrix_engine_leaves_the_pipelines_card_without_the_note", async () => {
  await reset({ on: "1" });
  assert.deepEqual(notesIn(pipelinesCard(tab())), []);
});

// The note follows the EFFECTIVE value — what the user has staged over the
// daemon's running value — rather than the value the daemon is running.
test("test_the_note_clears_when_the_effective_matrix_gate_is_staged_on", async () => {
  await reset({ on: "0" });
  await edit("matrix_enabled", "1");
  assert.deepEqual(notesIn(pipelinesCard(tab())), []);
});

test("test_the_note_appears_when_the_effective_matrix_gate_is_staged_off", async () => {
  await reset({ on: "1" });
  await edit("matrix_enabled", "0");
  assert.deepEqual(notesIn(pipelinesCard(tab())), [SETTINGS]);
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

// A second case stood here asking the same of the "+ Add pipeline" button. The
// only handle on that button is the word printed on it, so it is gone (rule 9);
// the row controls above carry the product rule for the card.

// ============================================================================
// the Headphone Auto EQ card
// ============================================================================

// The Headphone Auto EQ card carries NEITHER sentence, whatever the engine is
// doing — so the bypassed engine gets a negative case of its own rather than
// silence.
test("test_a_bypassed_matrix_engine_leaves_the_headphone_auto_eq_card_without_either_sentence", async () => {
  await reset({ on: "0" });
  assert.deepEqual(notesIn(autoEqCard(tab())), []);
});

// ============================================================================
// the Crossfeed card
// ============================================================================
// Structural crossfeed IS matrix pipeline rows, so a bypassed engine takes it
// out of the signal path with everything else — but the wording forks on whether
// a block is actually installed. Installed, the user's settings are inert (A);
// not installed, there are no settings of theirs to call inert and the card tells
// them what to do about it instead (B).

test("test_a_bypassed_matrix_engine_tells_the_structural_crossfeed_view_its_settings_are_inert", async () => {
  await reset({ on: "0", rows: STRUCTURAL(), view: "structural" });
  assert.deepEqual(notesIn(crossfeedCard(tab())), [SETTINGS]);
});

// A bare stereo passthrough pair carries no structural block, so the structural
// view's feature is off and the card asks for the engine rather than claiming
// settings have no effect.
test("test_a_bypassed_matrix_engine_asks_an_uninstalled_structural_crossfeed_view_to_engage_it", async () => {
  await reset({ on: "0", rows: BARE, view: "structural" });
  assert.deepEqual(notesIn(crossfeedCard(tab())), [ENGAGE]);
});

test("test_an_engaged_matrix_engine_leaves_the_structural_crossfeed_view_without_either_sentence", async () => {
  await reset({ on: "1", rows: STRUCTURAL(), view: "structural" });
  assert.deepEqual(notesIn(crossfeedCard(tab())), []);
});

// And with the engine engaged and no block installed, still nothing: an engaged
// engine silences both sentences whatever the feature switch says.
test("test_an_engaged_matrix_engine_leaves_an_uninstalled_structural_crossfeed_view_without_either_sentence", async () => {
  await reset({ on: "1", rows: BARE, view: "structural" });
  assert.deepEqual(notesIn(crossfeedCard(tab())), []);
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
  assert.deepEqual(notesIn(responseCard(tab())), [CUSTOM]);
});

// The conditional, and the case that carries the feature: nothing drawn means
// nothing to call unapplied, bypassed engine or not.
test("test_a_bypassed_matrix_engine_says_nothing_on_a_response_card_with_nothing_drawn", async () => {
  await reset({ on: "0", rows: BARE });
  assert.deepEqual(notesIn(responseCard(tab())), []);
});

test("test_an_engaged_matrix_engine_leaves_the_response_card_without_a_note", async () => {
  await reset({ on: "1", rows: ROWS });
  assert.deepEqual(notesIn(responseCard(tab())), []);
});

// The case that stood here asked separately that the response card falls back to
// neither control note. `notesIn` answers the card's WHOLE note list, so the case
// above already states it: `[CUSTOM]` is not `[SETTINGS]` and not `[ENGAGE]`.
// Kept as two assertions it would have been the same assertion twice.

// ============================================================================
// the card that is NOT about the matrix engine
// ============================================================================
// The speaker trims are HQPlayer's own `<speakers>` element, gated by its own
// `enabled` attribute (hqplayerd-readme.txt §1.9). They keep working while the
// matrix engine is bypassed, so claiming otherwise would be a lie on screen.

test("test_a_bypassed_matrix_engine_leaves_the_speakers_card_without_any_bypass_note", async () => {
  await reset({ on: "0", mode: "speakers" });
  assert.deepEqual(notesIn(speakerCard()), []);
});

// A second case stood here for the response card's own note. `notesIn` collects
// every bypass kind, the custom one included, so the empty list above covers all
// three and the second case was the same assertion written twice.
