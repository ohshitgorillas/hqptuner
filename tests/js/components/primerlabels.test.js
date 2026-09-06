// Behavioral suite for the names the filter primer's graph paints on its panes
// (components/primer/Graph.js), written blind from a spec block: no graph
// source was read. The component is driven through the exported signals of
// store/primergraph.js and rendered to a string.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. Rule 9 governs everything here: the words inside a name
// element are owner-approved copy, so no assertion below reads a name's text.
// What is asserted is which wire marking a name carries — `data-layer` on a
// legend row, `data-mark` on a Nyquist name — and those markings are contract.
//
// MARKUP READ. Inside the pane carrying `data-pane="frequency"`, both kinds of
// name are `text.plot-tlbl`: a legend row carries `data-layer` (one of `music`,
// `images`, `filter`, `output`, `analog`) and a dashed mark's name carries
// `data-mark` (one of `source`, `output`, `hearing`). `line.primer-nyquist`
// carries `data-mark` too, so the mark reading filters on the tag as well.
//
// Every test sets every signal it depends on (signals persist for the life of
// the file) and leaves the store as it found it: `showMe("intro")` after each.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/primerlabels.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

const { html } = await import("../../../hqptuner/static/lib/dom.js");
const { PrimerGraph } = await import("../../../hqptuner/static/components/primer/Graph.js");
const { rate, outputRate, phase, lengthMs, rolloff, transientUs, content, showMe } =
  await import("../../../hqptuner/static/store/primergraph.js");
const { elements, classes, attr } = await import("../support/markup.js");

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

test.afterEach(() => {
  showMe("intro");
});

// --- reading the render ---------------------------------------------------------

/** @returns {string} */
const draw = () => render(html`<${PrimerGraph} />`);

/**
 * The outermost element carrying `data-pane="frequency"`.
 *
 * @returns {MarkupElement}
 */
function frequencyPane() {
  const hits = elements(draw()).filter((el) => attr(el, "data-pane") === "frequency");
  if (hits.length === 0) throw new Error('no pane "frequency" in the render');
  return hits.reduce((a, b) => (a.start <= b.start ? a : b));
}

/**
 * The set of values the frequency pane's name elements carry under one
 * attribute, sorted so two renders compare as one value.
 *
 * @param {string} name
 * @returns {string[]}
 */
function namedBy(name) {
  const marked = elements(frequencyPane().html)
    .filter((el) => el.name === "text" && classes(el).includes("plot-tlbl"))
    .map((el) => attr(el, name))
    .filter((v) => v !== undefined);
  return [...new Set(marked)].sort();
}

/**
 * The inputs the spec fixes for every line below unless the line says otherwise.
 *
 * @returns {void}
 */
function baseline() {
  phase.value = "linear";
  rolloff.value = 0.5;
  transientUs.value = 100;
  content.value = { spurs: false, fakeHires: false, risingNoise: false };
  lengthMs.value = 2;
}

// --- the cases ------------------------------------------------------------------

// 1. The legend names the analog layer, the images, the music and the output in
// every state, and the filter only where the chain resamples: five rows where a
// filter runs, four at no oversampling and where the output rate is the source
// rate. Naming the stage only where a filter runs leaves the one state that is
// nothing but analog reconstruction, a NOS DAC, the state that never names it;
// dropping the images where the chain decimates hides a band that is now on
// frame.

test("test_frequency_legend_names_exactly_the_layers_the_pane_draws", () => {
  baseline();
  const chains = [
    [44100, 176400],
    [192000, 96000],
    [96000, 48000],
    [44100, null],
    [96000, 96000],
  ];
  const sweep = chains.map(([hz, out]) => {
    rate.value = hz;
    outputRate.value = out;
    return namedBy("data-layer");
  });
  assert.deepEqual(sweep, [
    ["analog", "filter", "images", "music", "output"],
    ["analog", "filter", "images", "music", "output"],
    ["analog", "filter", "images", "music", "output"],
    ["analog", "images", "music", "output"],
    ["analog", "images", "music", "output"],
  ]);
});

// 2. The dashed marks are the hearing limit and the source Nyquist in every
// state, joined by the output Nyquist only where that Nyquist falls below the
// axis top: at 44.1 kHz into 88.2 kHz the names are hearing, output and source,
// and into 176.4 kHz, where the output Nyquist IS the axis top, hearing and
// source. Marking every output rate that differs from the source puts that mark
// and its name at or past the right frame edge from a 4x ratio up.

test("test_each_nyquist_mark_carries_its_own_name", () => {
  baseline();
  rate.value = 44100;
  const sweep = [88200, 176400].map((out) => {
    outputRate.value = out;
    return namedBy("data-mark");
  });
  assert.deepEqual(sweep, [
    ["hearing", "output", "source"],
    ["hearing", "source"],
  ]);
});
