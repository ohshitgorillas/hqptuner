// Behavioral suite for components/xfeed/Comp.js — the crossfeed-compensation
// control strip. Written BEFORE the complexity refactor of XfeedStrip (13) and
// the private pairInfo (11).
//
// `pairInfo` is not exported and stays that way: it is a pure function of the
// pipeline rows, and every one of its verdicts surfaces on the Turn on button —
// its disabled state and the `data-issue` code it carries. So the whole function
// is reachable through the rendered strip, which is also where a user meets it.
// The code is what the cases below read; the sentence in the button's title says
// the same thing in words the owner may reword at will (docs/testing.md rule 9).
//
// The strip's inputs are the exported `effectivePipelines` computed (over the
// staged buffer and the config file's canonical pipeline JSON), the /matrix
// crossfeed form fields behind `effective()`, and the notes preference. `reset()`
// reassigns all of them every time — module signals outlive a test.
//
// Pipeline rows are built with lib/xfeed.js's own compiler rather than hand-typed
// wire text: an eight-row block is the daemon's serialization, not a fixture, and
// a hand-typed one would pin byte layout instead of behavior.

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { XfeedStrip, xfeedLensTraces, lensOn } from "../../../hqptuner/static/components/xfeed/Comp.js";
import { config, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { setShowDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { msCompile, fitComp, BAUER_PRESETS } from "../../../hqptuner/static/lib/xfeed.js";
import { staticWire, stagingWire } from "../support/wire.js";

/** @typedef {import("../../../hqptuner/static/lib/matrixspec.js").PipelineRow} PipelineRow */

const DEF = BAUER_PRESETS.default;
const EQ = "iir:type=peak;f=1000;q=1;g=-3";
const EQ2 = "iir:type=peak;f=2000;q=1;g=-3";

// Only the pending-buffer endpoints are touched (discardAll); an empty buffer is
// the whole response either way.
function wire() {
  staticWire();
}

// A plain stereo EQ row, the shape an AutoEq import leaves behind.
/**
 * @param {string} source
 * @param {string} mixdown
 * @param {{ process?: string, gain?: string, gainunit?: string }} [over]
 * @returns {PipelineRow}
 */
const row = (source, mixdown, { process = EQ, gain = "-3", gainunit = "dB" } = {}) => ({
  gain,
  gainunit,
  mixdown,
  process,
  source,
});

const pair = () => [row("0", "0"), row("1", "1")];

// A compiled compensation block at the given crossfeed settings and strength.
const block = (p = DEF, s = 1) => msCompile(EQ, 0, { fit: fitComp(p.fc, p.feed), s }, { a: 0, b: 1 });

// Full reset every time.
/**
 * @param {{ rows?: PipelineRow[], enabled?: boolean, preset?: string, notes?: boolean }} [over]
 * @returns {Promise<void>}
 */
async function reset({ rows = [], enabled = true, preset = "default", notes = false } = {}) {
  wire();
  matrixConfig.value = {
    fields: [
      // the daemon sends "0"/"1" on the wire, never a JS boolean
      { name: "post_bauer_enabled", value: String(enabled ? 1 : 0) },
      { name: "post_bauer_preset", value: preset },
      { name: "post_bauer_frequency", value: "700" },
      { name: "post_bauer_level", value: "4.5" },
    ],
  };
  config.value = { fields: [], file: { matrix_pipelines: JSON.stringify(rows) } };
  setShowDescriptions(notes);
  // The lens toggle outlives a test like every other module signal, and its
  // product default is OFF — so reset it here and let each case that asserts on
  // drawn traces turn it on itself.
  lensOn.value = false;
  await discardAll();
}

// The contract is the text a user reads, not its HTML encoding.
const strip = () =>
  render(html`<${XfeedStrip} />`)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

/**
 * @param {string} out
 * @returns {string[]}
 */
const buttons = (out) =>
  out
    .split("<button")
    .slice(1)
    .map((s) => s.split("</button>")[0]);

// The Turn on button, identified by the `data-issue` code it carries — the
// machine identity of the eligibility verdict, empty string when the pair is
// eligible. Undefined when the strip renders no such button at all.
/**
 * @param {string} out
 * @returns {string | undefined}
 */
const turnOn = (out) => buttons(out).find((b) => /\sdata-issue(\s|=|$)/.test(b.slice(0, b.indexOf(">"))));

// The verdict that button reports, or null when it was not rendered. SSR emits
// an empty-string attribute bare, so an eligible pair reads as "".
/**
 * @param {string} out
 * @returns {string | null}
 */
const issue = (out) => {
  const b = turnOn(out);
  return b === undefined ? null : (/\sdata-issue="([^"]*)"/.exec(attrs(b)) || ["", ""])[1];
};

// The attribute text of a button a case has gone on to read. A case reading
// attributes off a button the render never produced is already failing, and the
// missing button is what it should fail on — so the lookup is taken at its word
// here rather than answering for a button that is not there.
/**
 * @param {string | undefined} b
 * @returns {string}
 */
const attrs = (b) => {
  const found = /** @type {string} */ (b);
  return found.slice(0, found.indexOf(">"));
};

/**
 * @param {string} out
 * @returns {number}
 */
const sliderPct = (out) => Number((/class="rng"[^>]*value="(\d+)"/.exec(out) || [])[1]);

// --- crossfeed off ----------------------------------------------------------

test("test_crossfeed_off_with_no_correction_installed_renders_the_dead_strip", async () => {
  await reset({ rows: pair(), enabled: false });
  assert.ok(strip().includes('<div class="xfc-strip off">'));
});

// The dead strip's sentence saying there is nothing to correct is owner-owned
// copy over a state the case above already pins by class, so the case that
// pinned its wording is gone (docs/testing.md rule 9).

test("test_crossfeed_off_with_a_correction_installed_still_renders_the_controls", async () => {
  await reset({ rows: block(), enabled: false });
  assert.ok(strip().includes('<div class="xfc-strip">'));
});

// --- eligibility of the stereo pair (pairInfo) -------------------------------

test("test_a_symmetric_stereo_pair_offers_to_turn_the_correction_on", async () => {
  await reset({ rows: pair() });
  assert.notEqual(turnOn(strip()), undefined);
});

test("test_a_symmetric_stereo_pair_enables_turn_on", async () => {
  await reset({ rows: pair() });
  assert.equal(attrs(turnOn(strip())).includes("disabled"), false);
});

test("test_a_symmetric_stereo_pair_reports_no_issue", async () => {
  await reset({ rows: pair() });
  assert.equal(issue(strip()), "");
});

test("test_a_stereo_pair_arriving_in_reverse_channel_order_is_accepted", async () => {
  await reset({ rows: [row("1", "1"), row("0", "0")] });
  assert.equal(attrs(turnOn(strip())).includes("disabled"), false);
});

test("test_a_lone_pipeline_disables_turn_on", async () => {
  await reset({ rows: [row("0", "0")] });
  assert.ok(attrs(turnOn(strip())).includes("disabled"));
});

test("test_a_lone_pipeline_reports_the_missing_pair", async () => {
  await reset({ rows: [row("0", "0")] });
  assert.equal(issue(strip()), "no-pair");
});

test("test_a_cross_routed_pair_reports_the_routing_it_wants", async () => {
  await reset({ rows: [row("0", "1"), row("1", "0")] });
  assert.equal(issue(strip()), "not-straight");
});

test("test_a_pair_with_linear_gains_reports_the_gain_unit", async () => {
  await reset({
    rows: [row("0", "0", { gain: "0.5", gainunit: "Lin" }), row("1", "1", { gain: "0.5", gainunit: "Lin" })],
  });
  assert.equal(issue(strip()), "gain-unit");
});

test("test_a_pair_carrying_different_eq_chains_is_rejected_as_asymmetric", async () => {
  await reset({ rows: [row("0", "0"), row("1", "1", { process: EQ2 })] });
  assert.equal(issue(strip()), "asymmetric");
});

test("test_a_pair_carrying_different_gains_is_rejected_as_asymmetric", async () => {
  await reset({ rows: [row("0", "0"), row("1", "1", { gain: "-6" })] });
  assert.equal(issue(strip()), "asymmetric");
});

// --- the strength control ---------------------------------------------------

test("test_an_uninstalled_correction_starts_at_full_strength", async () => {
  await reset({ rows: pair() });
  assert.equal(sliderPct(strip()), 100);
});

test("test_an_installed_correction_sets_the_strength_to_its_own", async () => {
  // wire gains are 2-dp quantized, so the recovered fraction carries ~1% of slack
  await reset({ rows: block(DEF, 0.5) });
  const pct = sliderPct(strip());
  assert.ok(Math.abs(pct - 50) <= 1, `strength reads ${pct}%, want ~50%`);
});

// The figure is the model's own; the sentence around it is the owner's, so only
// the figure is asserted (docs/testing.md rule 9).
test("test_the_strip_reports_how_much_the_crossfeed_dulls_the_center", async () => {
  await reset({ rows: pair() });
  assert.ok(strip().includes("1.8 dB"));
});

// --- an installed block -----------------------------------------------------

// Three cases stood here asking for a button by the word on it: that an
// installed correction offers Turn off, and that a correction built for other
// crossfeed settings offers a Rebuild while a matching one does not. Only the
// Turn on button carries a machine identity (`data-issue`), so those three had
// nothing left once the wording came out (docs/testing.md rule 9).

test("test_an_installed_correction_no_longer_offers_to_turn_it_on", async () => {
  await reset({ rows: block() });
  assert.equal(turnOn(strip()), undefined);
});

// --- the lens ---------------------------------------------------------------
//
// The strip's own lens button is gone: by product decision the toggle lives in
// the Matrix response card head and its default flipped to off, so the two cases
// that stood here (the button lit by default inside the strip) had nothing left
// to assert. Both properties are pinned in xfeedlens.test.js — the strip's
// ABSENCE of a button, the button's label, and when it carries "active".

// --- inline notes -----------------------------------------------------------

test("test_hidden_notes_render_no_explanation", async () => {
  await reset({ rows: pair(), notes: false });
  assert.equal(strip().includes("xfc-note"), false);
});

test("test_shown_notes_explain_what_the_crossfeed_does", async () => {
  await reset({ rows: pair(), notes: true });
  assert.ok(strip().includes("xfc-note"));
});

// --- the lens traces (xfeedLensTraces) ----------------------------------------
//
// The exported trace builder for the RESPONSE plot. It has TWO gates and the
// cases below are all about the first: the crossfeed-enabled state, which
// staging can move (the same path a user's Apply rides), so both sides of it are
// reachable here.
//
// The second gate is the "what you hear" toggle, now a public signal (`lensOn`)
// and off by default. Every case here sets it explicitly, including the ones
// asserting NO traces — with the toggle left off those would pass for the wrong
// reason, and they exist to pin the crossfeed gate. The toggle's own contract
// lives in xfeedlens.test.js; only its button's onClick stays with the playwright
// hand-back, since SSR fires no handlers.

const bounds = () => ({ min: 0, max: 0 });

test("test_the_lens_draws_three_traces_for_an_eligible_pair", async () => {
  await reset({ rows: pair() });
  lensOn.value = true;
  assert.equal(xfeedLensTraces(pair(), bounds()).length, 3);
});

test("test_the_lens_hides_while_crossfeed_is_off", async () => {
  await reset({ rows: pair(), enabled: false });
  lensOn.value = true;
  assert.equal(xfeedLensTraces(pair(), bounds()).length, 0);
});

test("test_the_lens_draws_nothing_for_an_ineligible_pair", async () => {
  await reset({ rows: [row("0", "0")] });
  lensOn.value = true;
  assert.equal(xfeedLensTraces([row("0", "0")], bounds()).length, 0);
});

// A trace's legend label is the owner's wording; the correction STRENGTH it
// reports is a number, and that is all the cases below read (rule 9). The two
// cases that pinned the ghost trace's and the sides trace's wording alone are
// gone: neither carries an identity that says which trace it is.

test("test_an_uninstalled_pair_corrects_at_full_strength_by_default", async () => {
  await reset({ rows: pair() });
  lensOn.value = true;
  assert.ok(xfeedLensTraces(pair(), bounds())[1].label.includes("100%"));
});

test("test_the_corrected_trace_reads_the_installed_blocks_strength", async () => {
  // wire gains are 2-dp quantized, so the recovered percentage carries ~1 of slack
  await reset({ rows: block(DEF, 0.5) });
  lensOn.value = true;
  assert.match(xfeedLensTraces(block(DEF, 0.5), bounds())[1].label, /\b(49|50|51)%/);
});

test("test_a_lens_trace_spans_the_plot_band", async () => {
  await reset({ rows: pair() });
  lensOn.value = true;
  assert.equal(xfeedLensTraces(pair(), bounds())[0].points.length, 160);
});

test("test_the_lens_updates_the_shared_plot_bounds", async () => {
  await reset({ rows: pair() });
  lensOn.value = true;
  const b = bounds();
  xfeedLensTraces(pair(), b);
  assert.ok(b.min < -2, `expected the -3 dB EQ plus the crossfeed dip to pull bounds.min below -2, got ${b.min}`);
});

test("test_staging_crossfeed_off_hides_the_lens", async () => {
  await reset({ rows: pair(), enabled: true });
  lensOn.value = true;
  stagingWire();
  await edit("crossfeed_enabled", "0");
  assert.equal(xfeedLensTraces(pair(), bounds()).length, 0);
});

test("test_staging_crossfeed_on_restores_the_lens", async () => {
  await reset({ rows: pair(), enabled: false });
  lensOn.value = true;
  stagingWire();
  await edit("crossfeed_enabled", "1");
  assert.equal(xfeedLensTraces(pair(), bounds()).length, 3);
});
