// Behavioral suite for the filter primer's output readout
// (components/primer/Controls.js), written from a spec block: no control source
// was read while writing it.
//
// The product rule: the output readout names the output rate itself. Every rate
// the output segment offers is a rate some source really produces, and a readout
// that rounds to three significant figures names a 44.1-family rate as one no
// source produces — 176 kHz for 176.4, 353 kHz for 352.8.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. Rule 9: the readout is found by its wire marking, never by
// the word beside it. WIRE MARKING, spec fact: each readout value carries
// `data-readout="<key>"`, the output rate's being `data-readout="output"` — the
// same contract Bin G fixed for the frequency legend's `data-layer` and the
// Nyquist marks' `data-mark`. The reading taken is the NUMBER out of that
// element; the unit word beside it is copy and is not asserted on.
//
// The sweep is every numeric output rate the segment offers at the three source
// rates, as (source, output, kilohertz) literals. No-oversampling is not in it:
// it produces no output rate to name.
//
// Every test leaves the store as it found it: `showMe("intro")` after each.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/primerreadouts.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

const { html } = await import("../../../hqptuner/static/lib/dom.js");
const { PrimerControls } = await import("../../../hqptuner/static/components/primer/Controls.js");
const { rate, outputRate, showMe } = await import("../../../hqptuner/static/store/primergraph.js");
const { elements, attr, text } = await import("../support/markup.js");

test.afterEach(() => {
  showMe("intro");
});

/**
 * The number the readout marked `key` shows, with the unit word dropped.
 *
 * Throws rather than asserting where the marking is missing or ambiguous: a case
 * that read nothing must not pass for having found no mismatch.
 *
 * @param {string} key
 * @returns {number}
 */
function figure(key) {
  const out = render(html`<${PrimerControls} />`);
  const hits = elements(out).filter((el) => attr(el, "data-readout") === key);
  if (hits.length !== 1) throw new Error(`expected one data-readout="${key}" in the render, found ${hits.length}`);
  const shown = text(hits[0]);
  const num = /-?[0-9.]+/.exec(shown);
  if (num === null) throw new Error(`no number in the ${key} readout: ${JSON.stringify(shown)}`);
  return Number(num[0]);
}

// Source rate, output rate, and the figure in kilohertz the readout has to show.
const CASES = [
  [44100, 88200, 88.2],
  [44100, 176400, 176.4],
  [44100, 352800, 352.8],
  [96000, 48000, 48],
  [96000, 192000, 192],
  [96000, 384000, 384],
  [192000, 48000, 48],
  [192000, 96000, 96],
  [192000, 384000, 384],
];

test("test_output_readout_names_every_offered_output_rate", () => {
  const sweep = CASES.map(([source, out]) => {
    rate.value = source;
    outputRate.value = out;
    return figure("output");
  });
  assert.deepEqual(
    sweep,
    CASES.map(([, , khz]) => khz),
  );
});
