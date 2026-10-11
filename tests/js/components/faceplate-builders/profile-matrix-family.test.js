// Rendered suite for the chain picture of hqptuner/static/components/faceplate/builders/ProfileOverview.js against the
// drawer family: the stages the overview lights as the matrix part are exactly the rail stages whose drawer
// (components/faceplate/drawers/index.js) declares itself a member of the matrix family. A stage joining or leaving the
// family without the overview following, or the overview lighting a stage the family does not hold, turns it red.
//
// A picture's entry is joined to its rail stage by the stage's name as the store's rail reports it, never retyped.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-builders/profile-matrix-family.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { ProfileOverview } from "../../../../hqptuner/static/components/faceplate/builders/ProfileOverview.js";
import { stageDrawer } from "../../../../hqptuner/static/components/faceplate/drawers/index.js";
import { railNow, railStages } from "../../../../hqptuner/static/store/faceplate/chain.js";
import { elements, classes, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

const FAMILY = "matrix";
//: The state class the chain picture marks a stage of the matrix part with.
const LIT = "mx";

/** @type {Record<string, string>} */
const ENTITY = { quot: '"', "#39": "'", lt: "<", gt: ">", amp: "&" };

/** What a reader sees inside an element, the renderer's entities decoded. @param {MarkupElement} e */
const said = (e) => text(e).replace(/&(quot|#39|lt|gt|amp);/g, (_, k) => ENTITY[k]);

/**
 * The ids of the rail stages the overview's chain picture lights, sorted.
 *
 * @returns {string[]}
 */
function litStages() {
  const all = elements(render(html`<${ProfileOverview} />`));
  const chain = all.find((e) => e.name === "ol");
  const lit = chain ? elements(chain.html).filter((e) => e.name === "li" && classes(e).includes(LIT)) : [];
  const names = new Set(lit.map(said));
  return railStages(railNow())
    .filter((st) => names.has(st.name))
    .map((st) => st.id)
    .sort();
}

/**
 * The ids of the rail stages whose drawer declares the matrix family, sorted.
 *
 * @returns {string[]}
 */
const familyStages = () =>
  railStages(railNow())
    .filter((st) => stageDrawer(st).schema.family === FAMILY)
    .map((st) => st.id)
    .sort();

test("test_the_overview_lights_exactly_the_stages_whose_drawers_are_matrix_family_members", () => {
  assert.deepEqual(litStages(), familyStages());
});
