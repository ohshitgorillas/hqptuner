// Behavioural suite for the "∿ what you hear" lens toggle — the one control that
// turns the crossfeed lens curves on and off over the Matrix response plot.
//
// The binding product rule for this control is that THE UI MUST NOT SHIFT. The
// button lives in the Crossfeed card's BODY, on the row that already carries the
// enable gate and the Bauer|Structural segment, pushed to that row's right edge,
// and it is rendered there always: in both crossfeed views, with crossfeed
// running and with crossfeed off. When neither crossfeed has anything for the
// lens to draw the button is disabled IN PLACE — never removed, never
// accompanied by an appearing/disappearing reason line, and its tooltip is one
// static string that does not change with its state.
//
// Everything here goes through the exported `MatrixTab`, so both cards under
// discussion — Crossfeed and Matrix response — come out of one render and their
// relative placement is a fact of the same DOM a user meets. Inputs are the
// exported store signals (`config`, `matrixConfig`, `matrixMode`, `showDescriptions`,
// the plot's `plottedRows`/`previewEq`, the view choice `xfMode`) over the real
// REST paths of the staging wire fake. Nothing is stubbed and no module private
// is touched.
//
// Placement is asserted as DOM ADJACENCY, not as pixel geometry: SSR has no
// layout, so what a unit test can honestly pin is that the button renders after
// the Bauer|Structural segment and before the caption closing that stack — i.e.
// on that row rather than merely somewhere in the card. Which edge of the row it
// is flushed to is a measurement, and belongs to the visual hand-back.
//
// Two readings taken where the spec left room, both reported in the hand-back:
//
//   * "pressing the button" is driven through the exported `lensOn` signal
//     (components/XfeedComp.js), the same public seam the trace-builder suites
//     use. SSR fires no onClick, so the click itself belongs to the playwright
//     hand-back protocol; what is pinned here is the toggle's observable effect
//     on the response plot, which is the behaviour the button exists for. The
//     product DEFAULT is read off the freshly imported module rather than
//     written by a fixture and read back, which would assert nothing.
//
//   * "with nothing to draw" is exercised in both of its halves: Bauer off with
//     plain rows (nothing to draw either way, so dead), and Bauer off with a
//     structural block installed (the structural lens has curves, so live).
//
// Deliberately NOT here: a second press putting the curves away again. SSR keeps
// no history, so that render is the same render as the never-pressed one and the
// case could not fail on its own — an honest gap, covered by the browser
// hand-back, beats a test that pins nothing.
//
// Every card lookup answers a STRING when the card was not rendered at all, so a
// negative case cannot pass by looking at nothing (the `says` pattern from
// matrix-bypass-note.test.js).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/xfeedlens.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { MatrixTab } from "../../../hqptuner/static/components/MatrixTab.js";
import { lensOn } from "../../../hqptuner/static/components/XfeedComp.js";
import { plottedRows, previewEq } from "../../../hqptuner/static/components/MatrixPlot.js";
import { selectedStage } from "../../../hqptuner/static/components/BandStrip.js";
import { config, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { matrixMode } from "../../../hqptuner/static/store/matrixmode.js";
import { showDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { xfMode } from "../../../hqptuner/static/store/xfmode.js";
import { BAUER_PRESETS } from "../../../hqptuner/static/lib/xfeed.js";
import { compileRows } from "../../../hqptuner/static/lib/binaural/compile.js";
import { HEAD_RADIUS, SPEAKER_ANGLE } from "../../../hqptuner/static/lib/binaural/geometry.js";
import { stagingWire } from "../support/wire.js";

// The lens's shipped default, read at import time — before any fixture in this
// file has touched the signal. A default asserted after a fixture wrote it is a
// tautology an implementation shipping the lens ON would pass.
const SHIPPED_DEFAULT = lensOn.value;

// The button's visible label, as the changelog states it.
const LABEL = "∿ what you hear";

// One of the Bauer lens's own curve names (xfeedcomp.test.js pins the set of
// three); its presence in the response card is the lens being drawn.
const LENS_CURVE = "stereo sides";

// The caption that closes the crossfeed card's top stack, verbatim
// (crossfeed.test.js). It is the anchor for "the gate row ends here".
const CAPTION =
  "Bauer crossfeed is built into HQPlayer and is the default. " +
  "Structural crossfeed is HQPTuner's own and uses the Matrix pipelines.";

const DEF = BAUER_PRESETS.default;
const PEAK = "iir:type=peak;f=1000;q=1;g=-3";

// A symmetric stereo EQ pair — rows the Bauer lens accepts, and rows the plot
// has something to draw for.
const ROW = (patch) => ({ source: "0", gain: "-3", gainunit: "dB", mixdown: "0", process: PEAK, ...patch });
const PAIR = () => [ROW({}), ROW({ source: "1", mixdown: "1" })];

// An installed structural crossfeed block, built with the real compiler — the
// daemon's own serialization, not a fixture. Rows the STRUCTURAL lens draws for.
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

// Full reset every time — every signal touched here outlives a test file.
async function reset({ enabled = true, view = "bauer", rows = PAIR(), lens = false } = {}) {
  stagingWire();
  showDescriptions.value = false;
  plottedRows.value = new Set();
  previewEq.value = null;
  selectedStage.value = null;
  matrixConfig.value = {
    fields: [
      // the daemon sends "0"/"1" on the wire, never a JS boolean
      { name: "enabled", value: "1" },
      { name: "post_bauer_enabled", value: String(enabled ? 1 : 0) },
      { name: "post_bauer_preset", value: "default" },
      { name: "post_bauer_frequency", value: String(DEF.fc) },
      { name: "post_bauer_level", value: String(DEF.feed) },
      { name: "iir2fir", value: "0" },
    ],
    rows: [],
  };
  config.value = { fields: [], file: { matrix_pipelines: JSON.stringify(rows) }, active: "", profiles: null };
  await discardAll();
  matrixMode.value = "headphones";
  xfMode.value = view;
  lensOn.value = lens;
}

// SSR escapes entities; the contract is the text a user reads, not its encoding.
const decode = (out) =>
  out
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

// Browsers collapse runs of whitespace, so the comparisons here do too rather
// than pinning the source's line breaks.
const collapsed = (s) => s.replace(/\s+/g, " ");

const raw = () => render(html`<${MatrixTab} />`);
const tab = () => decode(raw());

// One card's rendered output, picked by the heading it carries — cards are
// `<section class="card ...">` with the title in the head above the body.
const cardsOf = (out) => out.split('<section class="card').slice(1);
const headOf = (frag) => {
  const at = frag.indexOf('<div class="card-body"');
  return at < 0 ? frag : frag.slice(0, at);
};
const bodyOf = (frag) => {
  const at = frag.indexOf('<div class="card-body"');
  return at < 0 ? "" : frag.slice(at);
};
const cardTitled = (out, re) => cardsOf(out).find((frag) => re.test(headOf(frag))) || "";
const crossfeedCard = (out) => cardTitled(out, /Crossfeed/i);
const responseCard = (out) => cardTitled(out, /Matrix response/i);

const buttonsOf = (frag) =>
  frag
    .split("<button")
    .slice(1)
    .map((s) => s.split("</button>")[0]);
const labelOf = (b) => b.slice(b.indexOf(">") + 1).trim();
const attrsOf = (b) => b.slice(0, b.indexOf(">"));
// The lens button, or "" when it was not rendered where we looked.
const lensButton = (frag) => buttonsOf(frag).find((b) => labelOf(b) === LABEL) || "";
const isDisabled = (b) => /\bdisabled\b/.test(attrsOf(b));
const titleOf = (b) => (/ title="([^"]*)"/.exec(attrsOf(b)) || [])[1] || "";

// The lens button of the crossfeed card's BODY, or "" — one string, so a missing
// button and a present one are told apart by every case below.
const lensInCrossfeedBody = (out) => lensButton(bodyOf(crossfeedCard(out)));

// Where the button stands relative to the row it must stand on: after the
// Bauer|Structural segment, and before the caption that closes that stack.
const placement = (out) => {
  const body = collapsed(bodyOf(crossfeedCard(out)));
  return { seg: body.indexOf(">Structural<"), lens: body.indexOf(LABEL), cap: body.indexOf(CAPTION) };
};

// The text of the gate row itself — everything a user reads from the top of the
// card body down to the caption, tags and attribute values gone. This is the
// strip of UI that must not gain or lose a word when the lens goes dead.
const gateRowText = (out) => {
  const body = collapsed(bodyOf(crossfeedCard(out)));
  const cap = body.indexOf(CAPTION);
  return collapsed((cap < 0 ? body : body.slice(0, cap)).replace(/<[^<>]*>/g, " ")).trim();
};

// Whether the response card's HEAD carries the button — or a sentence saying the
// card was never rendered, which equals neither true nor false.
const lensInResponseHead = (out) => {
  const frag = responseCard(out);
  return frag === "" ? "the Matrix response card was not rendered at all" : lensButton(headOf(frag)) !== "";
};

// Whether the response card draws the lens curves — same guard. The search runs
// over the card's TEXT, attribute values stripped: the toggle's own tooltip
// names the curves in prose, so a naive substring search finds the lens wherever
// the button happens to stand and never fails.
const textOf = (frag) => frag.replace(/="[^"]*"/g, "");
const lensCurvesDrawn = (out) => {
  const frag = responseCard(out);
  return frag === "" ? "the Matrix response card was not rendered at all" : textOf(frag).includes(LENS_CURVE);
};

// [ok, message] for spreading into ONE assert.ok — the house pattern for a
// condition that needs a helper to build.
const onTheGateRow = (p, where) => [
  p.seg > -1 && p.cap > -1 && p.lens > p.seg && p.lens < p.cap,
  `${where}: segment at ${p.seg}, lens button at ${p.lens}, caption at ${p.cap}`,
];
const liveButton = (b, where) => [
  b !== "" && !isDisabled(b),
  b === "" ? `no lens button at all ${where}` : `lens button is disabled ${where}`,
];
const sameTooltip = (a, b) => [a !== "" && a === b, `tooltip off=${JSON.stringify(a)} on=${JSON.stringify(b)}`];
const unchangedText = (a, b) => [
  a !== "" && a.includes(LABEL) && a === b,
  `gate row reads\n  dead: ${JSON.stringify(a)}\n  live: ${JSON.stringify(b)}`,
];

// --- where the toggle lives ---------------------------------------------------

test("test_the_lens_toggle_stands_on_the_gate_row_after_the_segment_in_the_bauer_view", async () => {
  await reset({ view: "bauer" });
  assert.ok(...onTheGateRow(placement(tab()), "Bauer view"));
});

test("test_the_lens_toggle_stands_on_the_gate_row_after_the_segment_in_the_structural_view", async () => {
  await reset({ view: "structural" });
  assert.ok(...onTheGateRow(placement(tab()), "Structural view"));
});

test("test_the_lens_toggle_does_not_render_in_the_matrix_response_card_head", async () => {
  await reset({ view: "bauer" });
  assert.equal(lensInResponseHead(tab()), false);
});

// --- what the toggle does -----------------------------------------------------

test("test_the_lens_ships_switched_off", () => {
  assert.equal(SHIPPED_DEFAULT, false);
});

test("test_turning_the_lens_on_adds_the_lens_curves_to_the_response_plot", async () => {
  await reset({ enabled: true, view: "bauer" });
  lensOn.value = true;
  assert.equal(lensCurvesDrawn(tab()), true);
});

// --- nothing to draw: disabled in place, never removed --------------------------

test("test_the_lens_toggle_still_stands_on_the_gate_row_while_crossfeed_is_off", async () => {
  await reset({ enabled: false, view: "bauer", rows: PAIR() });
  assert.ok(...onTheGateRow(placement(tab()), "crossfeed off"));
});

test("test_the_lens_toggle_is_disabled_when_neither_crossfeed_has_anything_to_draw", async () => {
  await reset({ enabled: false, view: "bauer", rows: PAIR() });
  assert.ok(isDisabled(lensInCrossfeedBody(tab())), "lens button is not disabled with nothing to draw");
});

test("test_the_lens_toggle_is_live_when_only_the_structural_crossfeed_has_something_to_draw", async () => {
  // Bauer is switched off, but an installed structural block gives the lens its
  // curves — a toggle gating on Bauer alone would sit dead over drawable ones.
  await reset({ enabled: false, view: "structural", rows: STRUCTURAL() });
  assert.ok(...liveButton(lensInCrossfeedBody(tab()), "with a structural block installed"));
});

test("test_the_lens_tooltip_is_the_same_string_whether_the_toggle_is_live_or_dead", async () => {
  await reset({ enabled: false, view: "bauer", rows: PAIR() });
  const off = titleOf(lensButton(bodyOf(crossfeedCard(raw()))));
  await reset({ enabled: true, view: "bauer", rows: PAIR() });
  const on = titleOf(lensButton(bodyOf(crossfeedCard(raw()))));
  assert.ok(...sameTooltip(off, on));
});

test("test_a_dead_lens_toggle_swaps_no_text_into_the_gate_row", async () => {
  // Nothing beside the button may appear or disappear when it goes dead: an
  // added reason line is the same UI shift as an added button.
  await reset({ enabled: false, view: "bauer", rows: PAIR() });
  const dead = gateRowText(tab());
  await reset({ enabled: true, view: "bauer", rows: PAIR() });
  assert.ok(...unchangedText(dead, gateRowText(tab())));
});

test("test_turning_crossfeed_on_enables_the_toggle_where_it_already_stood", async () => {
  await reset({ enabled: true, view: "bauer", rows: PAIR() });
  assert.ok(...liveButton(lensInCrossfeedBody(tab()), "with crossfeed running"));
});
