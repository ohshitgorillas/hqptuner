// Behavioral suite for the source-relative output-rate control of the filter
// primer (store/primergraph.js and the control block components/primer/Graph.js
// renders), written blind from a spec block: no primer source was read. The
// store is driven through its exported signals and functions; the control is
// read out of a server-rendered string.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. Rule 9: an option is addressed and read by the wire value
// it carries, never by the word printed on it, and the control block is found
// by its `data-control` marking rather than by its title.
//
// MARKUP READ. The control block carries `data-control="output"`; inside it each
// option of the segment renders as an element carrying its own value in
// `data-v` (the convention every other segment suite here reads, e.g.
// tests/js/components/segment-tips.test.js). SSR hands attribute values back as
// strings, so a numeric factor is coerced back to a number and the "nos" token
// is left as it arrives.
//
// Every test sets every signal it depends on (module-level signals persist for
// the life of the file) and leaves the store as it found it: `showMe("intro")`
// after each.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/primerrates.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

const { html } = await import("../../../hqptuner/static/lib/dom.js");
const { PrimerGraph } = await import("../../../hqptuner/static/components/primer/Graph.js");
const {
  RATES,
  rate,
  outputRate,
  phase,
  lengthMs,
  rolloff,
  transientUs,
  content,
  outputFactors,
  outputRateFor,
  setRate,
  showMe,
} = await import("../../../hqptuner/static/store/primergraph.js");
const { elements, attr } = await import("../support/markup.js");

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

test.afterEach(() => {
  showMe("intro");
});

// --- reading the render ---------------------------------------------------------

/** @returns {string} */
const draw = () => render(html`<${PrimerGraph} />`);

/**
 * The outermost element carrying `data-control="<name>"`.
 *
 * @param {string} name
 * @returns {MarkupElement}
 */
function control(name) {
  const hits = elements(draw()).filter((el) => attr(el, "data-control") === name);
  if (hits.length === 0) throw new Error(`no control "${name}" in the render`);
  return hits.reduce((a, b) => (a.start <= b.start ? a : b));
}

/**
 * The values the output-rate segment offers, in the order it renders them: the
 * `data-v` of every option inside the control, numbers coerced back from the
 * strings SSR hands over, any other token left as it arrives.
 *
 * @returns {(number | string)[]}
 */
function outputOptionValues() {
  const box = control("output");
  const seen = elements(box.html)
    .filter((el) => el.start > 0)
    .sort((a, b) => a.start - b.start)
    .map((el) => attr(el, "data-v"))
    .filter((/** @type {string | undefined} */ v) => v !== undefined);
  if (seen.length === 0) throw new Error("the output control offers no option carrying data-v");
  return seen.map((v) => (v !== "" && Number.isFinite(Number(v)) ? Number(v) : v));
}

/**
 * The inputs the spec fixes for every line below unless the line says otherwise.
 *
 * @returns {void}
 */
function baseline() {
  phase.value = "linear";
  lengthMs.value = 2;
  rolloff.value = 0.5;
  transientUs.value = 100;
  content.value = { spurs: false, fakeHires: false, risingNoise: false };
}

// --- the cases ------------------------------------------------------------------

// 1. The factors offered at a source rate, and the rate each one produces, are
// source-relative and bounded: the same list at every rate, or a rate computed
// over the family base rather than over the source, both differ here.

test("test_output_factors_produce_source_relative_bounded_rates", () => {
  assert.deepEqual(
    RATES.map((hz) => outputFactors(hz).map((f) => outputRateFor(hz, f))),
    [
      [null, 88200, 176400, 352800],
      [48000, null, 192000, 384000],
      [48000, 96000, null, 384000],
    ],
  );
});

// 2. The rendered output-rate segment offers exactly those factors as its
// option values, so a control keeping one hardcoded list — never offering a
// decimating option — differs.

test("test_output_segment_offers_the_factors_of_the_current_source_rate", () => {
  baseline();
  const sweep = [
    [44100, 88200],
    [96000, 192000],
    [192000, 384000],
  ].map(([hz, out]) => {
    rate.value = hz;
    outputRate.value = out;
    return outputOptionValues();
  });
  assert.deepEqual(sweep, [
    ["nos", 2, 4, 8],
    [-2, "nos", 2, 4],
    [-4, -2, "nos", 2],
  ]);
});

// 3. Changing the source rate holds the output rate at the same source-relative
// factor: from 2x at 192k, each new source rate lands on its own 2x rather than
// carrying the absolute rate or the family-base factor over.

test("test_changing_source_rate_holds_the_output_at_the_same_factor", () => {
  baseline();
  rate.value = 192000;
  outputRate.value = 384000;
  const sweep = [44100, 96000, 192000].map((hz) => {
    setRate(hz);
    return outputRate.value;
  });
  assert.deepEqual(sweep, [88200, 192000, 384000]);
});

// 4. The Roll-off scene is an oversampling chain, not the identity: a scene
// left at 96k in and 96k out draws no filter for the prose to describe.

test("test_rolloff_scene_sets_an_oversampling_chain", () => {
  baseline();
  rate.value = 44100;
  outputRate.value = null;
  showMe("roll-off");
  assert.deepEqual([rate.value, outputRate.value], [96000, 192000]);
});
