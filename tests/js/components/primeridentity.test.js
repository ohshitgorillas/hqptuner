// Behavioral suite for what the filter primer's graph draws when the chain's
// ratio is one (components/primer/Graph.js), written blind from a spec block:
// no graph source was read. The component is driven through the exported
// signals of store/primergraph.js and rendered to a string.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. Rule 9: no assertion here reads a name's text; what is
// counted is the number of curves and of trace names the delay pane carries,
// both wire markings (`plot-trace`, `data-trace`).
//
// MARKUP READ. Inside the pane carrying `data-pane="delay"`, each phase's curve
// is `path.plot-trace` and each phase name is `text.plot-tlbl[data-trace]`.
// The pane is the outermost element carrying the `data-pane` value.
//
// Every test sets every signal it depends on (signals persist for the life of
// the file) and leaves the store as it found it: `showMe("intro")` after each.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/primeridentity.test.js

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
 * The outermost element carrying `data-pane="delay"`.
 *
 * @returns {MarkupElement}
 */
function delayPane() {
  const hits = elements(draw()).filter((el) => attr(el, "data-pane") === "delay");
  if (hits.length === 0) throw new Error('no pane "delay" in the render');
  return hits.reduce((a, b) => (a.start <= b.start ? a : b));
}

/**
 * How many `path.plot-trace` curves the delay pane draws.
 *
 * @returns {number}
 */
function traceCount() {
  return elements(delayPane().html).filter((el) => el.name === "path" && classes(el).includes("plot-trace")).length;
}

/**
 * How many `text.plot-tlbl[data-trace]` names the delay pane carries.
 *
 * @returns {number}
 */
function traceNameCount() {
  return elements(delayPane().html).filter(
    (el) => el.name === "text" && classes(el).includes("plot-tlbl") && attr(el, "data-trace") !== undefined,
  ).length;
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

// 2. A chain whose ratio is one draws the delay pane as no oversampling does:
// one curve, the same as output null, where a real oversampling chain draws
// two. An implementation that keys "oversampling" on the output rate being set
// draws two curves at 44100 -> 44100.

test("test_delay_pane_draws_one_trace_at_ratio_one_as_at_no_output", () => {
  baseline();
  rate.value = 44100;
  const sweep = [null, 44100, 176400].map((out) => {
    outputRate.value = out;
    return traceCount();
  });
  assert.deepEqual(sweep, [1, 1, 2]);
});

// 3. Trace names follow the same rule: none at output null, none at a ratio of
// one, one per phase when the chain oversamples. An implementation that names
// traces whenever an output rate is set carries names at 44100 -> 44100.

test("test_delay_pane_names_no_trace_at_ratio_one_as_at_no_output", () => {
  baseline();
  rate.value = 44100;
  const sweep = [null, 44100, 176400].map((out) => {
    outputRate.value = out;
    return traceNameCount();
  });
  assert.deepEqual(sweep, [0, 0, 2]);
});
