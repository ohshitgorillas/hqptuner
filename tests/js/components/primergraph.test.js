// Behavioral suite for the filter primer's graph (components/primer/Graph.js),
// written blind from a spec block: no graph source was read. The component is
// driven through the exported signals of store/primergraph.js and rendered to a
// string; the reading below is a number pulled out of SVG geometry, never a word.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. Rule 9: the elements are found by their classes and
// `data-pane` markings (wire identifiers).
//
// GEOMETRY READ. Inside the frequency pane the Nyquist mark is
// `line.primer-nyquist` and the result fill is `path.primer-leak`, absolute
// coordinates only, larger y meaning lower dB.
//
// Every test leaves the store as it found it: `showMe("intro")` after each.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/primergraph.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

const { html } = await import("../../../hqptuner/static/lib/dom.js");
const { PrimerGraph } = await import("../../../hqptuner/static/components/primer/Graph.js");
const { rate, lengthMs, LENGTH_CHIPS, showMe } = await import("../../../hqptuner/static/store/primergraph.js");
const { elements, classes, attr } = await import("../support/markup.js");

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

test.afterEach(() => {
  showMe("intro");
});

// --- reading the render ---------------------------------------------------------

/** @returns {string} */
const draw = () => render(html`<${PrimerGraph} />`);

/**
 * The outermost element carrying `data-pane="<name>"`.
 *
 * @param {string} name
 * @returns {MarkupElement}
 */
function pane(name) {
  const hits = elements(draw()).filter((el) => attr(el, "data-pane") === name);
  if (hits.length === 0) throw new Error(`no pane "${name}" in the render`);
  return hits.reduce((a, b) => (a.start <= b.start ? a : b));
}

/**
 * Every element inside a pane whose class list carries all of `want`.
 *
 * @param {MarkupElement} box
 * @param {string} tag
 * @param {string[]} want
 * @returns {MarkupElement[]}
 */
const inside = (box, tag, want) =>
  elements(box.html).filter((el) => el.name === tag && want.every((c) => classes(el).includes(c)));

/**
 * @param {MarkupElement} el
 * @param {string} name
 * @returns {number}
 */
function num(el, name) {
  const v = Number(attr(el, name));
  if (!Number.isFinite(v)) throw new Error(`<${el.name}> carries no numeric ${name}`);
  return v;
}

/**
 * Every "x,y" pair in a points list or an absolute path `d`, as numbers.
 *
 * @param {string} s
 * @returns {[number, number][]}
 */
function pairs(s) {
  const nums = s
    .replace(/[A-DF-Za-df-z]/g, " ")
    .split(/[\s,]+/)
    .filter((t) => t !== "")
    .map(Number);
  if (nums.some((v) => !Number.isFinite(v)) || nums.length % 2 !== 0) throw new Error(`not a list of x,y pairs: ${s}`);
  /** @type {[number, number][]} */
  const out = [];
  for (let i = 0; i < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

/**
 * The smallest y (highest level) of the leak fill beyond the Nyquist mark.
 *
 * @returns {number}
 */
function leakTop() {
  const box = pane("frequency");
  const [mark] = inside(box, "line", ["primer-nyquist"]);
  const [leak] = inside(box, "path", ["primer-leak"]);
  if (!mark || !leak) throw new Error("the frequency pane lacks a Nyquist mark or a leak fill");
  const nyquist = num(mark, "x1");
  const beyond = pairs(attr(leak, "d") || "").filter(([x]) => x > nyquist);
  if (beyond.length === 0) throw new Error("the leak fill has no vertex beyond the Nyquist mark");
  return Math.min(...beyond.map(([, y]) => y));
}

// --- the case -------------------------------------------------------------------

// A longer filter leaks less past Nyquist: the fill's top edge beyond the mark
// sits lower (larger y) with the long filter than with the short one.

test("test_long_filter_leaks_less_past_nyquist_than_short_filter", () => {
  rate.value = 96000;
  lengthMs.value = LENGTH_CHIPS.short;
  const short = leakTop();
  lengthMs.value = LENGTH_CHIPS.long;
  const long = leakTop();
  assert.ok(long > short, `long ${long} vs short ${short}`);
});
