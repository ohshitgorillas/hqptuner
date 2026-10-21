// Rendered suite for hqptuner/static/components/faceplate/controls/Head.js, the label head every row draws: the label,
// the restart mark when its setting restarts the engine, then its sublabel, its band tag and a control parked on the
// line; and the restart mark on its own.
//
// Renders through preact-render-to-string. A part is found by the text it carries; the head is the outermost element
// of the render. The tip is a string the test hands in.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-controls/head.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Head, RestartMark } from "../../../../hqptuner/static/components/faceplate/controls/Head.js";
import { attr, classes, elements, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

/** @typedef {{ label: string, sub?: string, band?: string, restarts?: string, tail?: unknown }} Props */

/**
 * Every element of one render of the head.
 *
 * @param {Partial<Props>} [over]
 * @returns {MarkupElement[]}
 */
const markup = (over) => elements(render(html`<${Head} ...${{ label: "LABELPART", ...over }} />`));

/**
 * The head: the outermost element of the render.
 *
 * @param {Partial<Props>} [over]
 */
const head = (over) => markup(over).at(-1);

/**
 * The restart mark of one render of the head.
 *
 * @param {Partial<Props>} [over]
 */
const mark = (over) => markup(over).find((e) => attr(e, "data-testid") === "restart-mark");

// --- the label ---------------------------------------------------------------------------------------------------

test("test_the_head_shows_its_label_in_bold", () => {
  const b = markup().find((e) => e.name === "b");
  assert.equal(b ? text(b) : undefined, "LABELPART");
});

test("test_the_head_is_a_field_head", () => {
  const h = head();
  assert.equal(h ? classes(h).includes("fh") : undefined, true);
});

// --- the restart mark --------------------------------------------------------------------------------------------

const MARKED = [
  { name: "a_head_given_a_restart_tip_draws_the_restart_mark", restarts: "TIPPART", want: true },
  { name: "a_head_given_an_empty_restart_tip_draws_no_restart_mark", restarts: "", want: false },
  { name: "a_head_given_no_restart_tip_draws_no_restart_mark", restarts: undefined, want: false },
];

for (const row of MARKED) {
  test(`test_${row.name}`, () => {
    const h = head({ restarts: row.restarts });
    assert.equal(h ? h.html.includes("restart-mark") : undefined, row.want);
  });
}

const TIPS = [
  { name: "the_restart_mark_carries_the_tip_it_is_given", restarts: "TIPPART" },
  { name: "the_restart_mark_carries_another_tip_when_given_another", restarts: "OTHERTIP" },
];

for (const row of TIPS) {
  test(`test_${row.name}`, () => {
    const m = mark({ restarts: row.restarts });
    assert.equal(m ? attr(m, "title") : undefined, row.restarts);
  });
}

const MARK_ORDER = [
  { name: "the_restart_mark_comes_after_the_label", first: "LABELPART", then: "restart-mark" },
  { name: "the_restart_mark_comes_before_the_sublabel", first: "restart-mark", then: "SUBPART" },
];

for (const row of MARK_ORDER) {
  test(`test_${row.name}`, () => {
    const out = head({ restarts: "TIPPART", sub: "SUBPART" })?.html ?? "";
    assert.equal(out.indexOf(row.first) < out.indexOf(row.then), true);
  });
}

test("test_the_restart_mark_on_its_own_carries_the_tip_it_is_given", () => {
  const m = elements(render(html`<${RestartMark} tip="TIPPART" />`)).at(-1);
  assert.equal(m ? attr(m, "title") : undefined, "TIPPART");
});

test("test_the_restart_mark_on_its_own_is_the_restart_mark", () => {
  const m = elements(render(html`<${RestartMark} tip="TIPPART" />`)).at(-1);
  assert.equal(m ? attr(m, "data-testid") : undefined, "restart-mark");
});

test("test_the_restart_mark_on_its_own_shows_the_restart_glyph", () => {
  const m = elements(render(html`<${RestartMark} tip="TIPPART" />`)).at(-1);
  assert.equal(m ? text(m) : undefined, "↻");
});

// --- sublabel, band and tail -------------------------------------------------------------------------------------

test("test_the_head_shows_its_sublabel", () => {
  const s = markup({ sub: "SUBPART" }).find((e) => classes(e).includes("s"));
  assert.equal(s ? text(s) : undefined, "SUBPART");
});

test("test_a_head_given_no_sublabel_draws_none", () => {
  assert.equal(head()?.html.includes('class="s"'), false);
});

test("test_the_head_shows_its_band_in_capitals", () => {
  const b = markup({ band: "abc" }).find((e) => classes(e).includes("band"));
  assert.equal(b ? text(b) : undefined, "ABC");
});

test("test_a_head_given_no_band_draws_none", () => {
  assert.equal(head()?.html.includes('class="band"'), false);
});

test("test_the_head_shows_the_control_parked_on_its_line", () => {
  assert.equal(head({ tail: html`<i>TAILPART</i>` })?.html.includes("TAILPART"), true);
});

test("test_the_parked_control_comes_after_the_band", () => {
  const out = head({ band: "bandpart", tail: html`<i>TAILPART</i>` })?.html ?? "";
  assert.equal(out.indexOf("BANDPART") < out.indexOf("TAILPART"), true);
});
