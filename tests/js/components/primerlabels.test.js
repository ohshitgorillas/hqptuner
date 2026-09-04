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
// `images`, `filter`, `output`) and a Nyquist name carries `data-mark` (one of
// `source`, `output`). `line.primer-nyquist` carries `data-mark` too, so the
// Nyquist reading filters on the tag as well.
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

// 1. The legend names exactly the layers the pane draws, so it shrinks with the
// chain: upsampling names all four, downsampling drops the source's images, and
// no oversampling at all leaves only the source and its images. A fixed
// four-row legend names a filter and an output stream at NOS where neither is
// drawn.

test("test_frequency_legend_names_exactly_the_layers_the_pane_draws", () => {
  baseline();
  const chains = [
    [44100, 176400],
    [192000, 96000],
    [96000, 48000],
    [44100, null],
  ];
  const sweep = chains.map(([hz, out]) => {
    rate.value = hz;
    outputRate.value = out;
    return namedBy("data-layer");
  });
  assert.deepEqual(sweep, [
    ["filter", "images", "music", "output"],
    ["filter", "music", "output"],
    ["filter", "music", "output"],
    ["images", "music"],
  ]);
});

// 2. Each Nyquist mark carries its own name, so a reader can tell the source
// limit from the output limit: two names when the chain oversamples, one when
// it does not. A single shared name for the pair reads the same in both states.

test("test_each_nyquist_mark_carries_its_own_name", () => {
  baseline();
  rate.value = 44100;
  const sweep = [176400, null].map((out) => {
    outputRate.value = out;
    return namedBy("data-mark");
  });
  assert.deepEqual(sweep, [["output", "source"], ["source"]]);
});
