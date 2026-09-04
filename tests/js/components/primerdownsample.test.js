// The filter primer where the chain DOWNSAMPLES: the two panes that were
// drawing a frame wider than the chain carries. Written from the approved spec
// block in a tree holding no implementation, so the red run here is the bite
// proof (docs/testing.md rule 8).
//
// Policy (docs/testing.md): behavior only, public API only, one assertion per
// test. The component is driven through the exported signals of
// store/primergraph.js and rendered to a string; every reading below is a
// number or a label pulled out of SVG geometry.
//
// GEOMETRY READ, in the sense tests/js/support/primeredit.js uses that phrase:
//
//   - A pane is the outermost element carrying `data-pane`, one of `impulse`,
//     `delay`, `frequency`.
//   - Axis labels are `text.plot-lbl`. The unit word carries `plot-axis` as
//     well and is not a tick. Frequency labels sit on the bottom edge and take
//     the default `text-anchor="middle"`; the amplitude labels down the left
//     gutter are anchored `end`. That anchor is what separates the two axes
//     here, the delay pane's frequency marks naming no anchor of their own.
//   - The output stream's fill is `path.primer-leak`, whose `d` is a move/line
//     list of absolute `x,y` pairs.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/primerdownsample.test.js

import test from "node:test";
import assert from "node:assert/strict";

const { render } = await import("preact-render-to-string");
const { html } = await import("../../../hqptuner/static/lib/dom.js");
const { PrimerGraph } = await import("../../../hqptuner/static/components/primer/Graph.js");
const { rate, outputRate, phase, lengthMs, rolloff, showMe } =
  await import("../../../hqptuner/static/store/primergraph.js");
const { elements, classes, attr, text } = await import("../support/markup.js");

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

test.afterEach(() => {
  showMe("intro");
});

// --- reading the render ---------------------------------------------------------

/** @returns {string} */
const draw = () => render(html`<${PrimerGraph} />`);

/**
 * @param {MarkupElement} el
 * @param {string} klass
 * @returns {boolean}
 */
const has = (el, klass) => classes(el).includes(klass);

/**
 * Every element inside the pane carrying `data-pane="<name>"`.
 *
 * @param {string} name
 * @returns {MarkupElement[]}
 */
function pane(name) {
  const hits = elements(draw()).filter((el) => attr(el, "data-pane") === name);
  if (hits.length === 0) throw new Error(`no pane "${name}" in the render`);
  return elements(hits.reduce((a, b) => (a.start <= b.start ? a : b)).html);
}

/**
 * The delay pane's frequency tick labels, in document order: the `plot-lbl`
 * texts that are neither the unit word nor an amplitude label.
 *
 * @returns {string[]}
 */
function delayFrequencyLabels() {
  const labels = pane("delay").filter(
    (el) => el.name === "text" && has(el, "plot-lbl") && !has(el, "plot-axis") && attr(el, "text-anchor") === "middle",
  );
  if (labels.length === 0) throw new Error("the delay pane carries no frequency tick labels");
  return labels.map(text);
}

/**
 * The largest x the output stream's fill reaches.
 *
 * @returns {number}
 */
function leakRightX() {
  const [leak] = pane("frequency").filter((el) => el.name === "path" && has(el, "primer-leak"));
  if (!leak) throw new Error("the frequency pane lacks an output fill");
  const xs = (attr(leak, "d") || "")
    .replace(/[MLZ]/g, " ")
    .split(/\s+/)
    .filter((t) => t !== "")
    .map((pair) => Number(pair.split(",")[0]));
  if (xs.length === 0 || xs.some((v) => !Number.isFinite(v))) throw new Error("the output fill carries no x,y pairs");
  return Math.max(...xs);
}

/** The inputs every case fixes unless it names them. */
function baseline() {
  phase.value = "linear";
  lengthMs.value = 2;
  rolloff.value = 0.5;
}

// --- the cases ------------------------------------------------------------------

// 1. The delay pane's frequency axis is the band the chain carries out, not the
// band it takes in: with 192 kHz going in, an output of 48 kHz labels the axis
// 5, 10, 15 and 20 kHz, and an output of 96 kHz labels it 10, 20, 30 and 40
// kHz. An axis topped at half the source rate reads 96 kHz wide in both, so it
// carries the same labels at either output and leaves the curve ending partway
// across an empty frame; an axis cut into a quarter of the frequency pane's
// ticks carries 10 and 20 at 48 and 20 and 40 at 96.

test("test_delay_frequency_axis_follows_the_slower_of_the_two_rates", () => {
  baseline();
  rate.value = 192000;
  const sweep = [48000, 96000].map((hz) => {
    outputRate.value = hz;
    return delayFrequencyLabels();
  });
  assert.deepEqual(sweep, [
    ["5", "10", "15", "20"],
    ["10", "20", "30", "40"],
  ]);
});

// 2. The output stream's fill stops at the output Nyquist, because above it the
// fold repeats the band below and no stream carries anything. At 192 kHz in and
// 48 kHz out that is x 213.5, and at 96 kHz in and 192 kHz out, where the output
// Nyquist is the axis top, it is the plot's right edge at x 764. A fill drawn
// across the whole grid reaches 764 in both.

test("test_output_fill_stops_at_the_output_nyquist", () => {
  baseline();
  const sweep = [
    [192000, 48000],
    [96000, 192000],
  ].map(([source, out]) => {
    rate.value = source;
    outputRate.value = out;
    return leakRightX();
  });
  assert.deepEqual(sweep, [213.5, 764]);
});
