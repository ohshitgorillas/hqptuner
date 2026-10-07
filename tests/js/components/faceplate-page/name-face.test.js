// Rendered suite for hqptuner/static/components/faceplate/NameFace.js: the shared nameplate face the page's chain
// pickers, the drawer's list rows and the Setting Switcher's list slots draw. A family line (`.cpf`) sits over the
// leaf line (`.cpl`); an option whose plain-names overlay is flat carries an empty family, and its leaf stands alone.
//
// Renders through preact-render-to-string. The family line is found by its class; the family and leaf strings are the
// fixture's own.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/name-face.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { NameFace } from "../../../../hqptuner/static/components/faceplate/NameFace.js";
import { classes, elements } from "../../support/markup.js";

const LEAF = "Leaf x";
const FAMILY = "Fam x";
const FLAT = "";

/**
 * The family lines a NameFace draws for `fam` over the fixture's leaf.
 *
 * @param {string} fam
 */
const familyLines = (fam) =>
  elements(render(html`<${NameFace} fam=${fam} variant=${null} leaf=${LEAF} />`)).filter((e) =>
    classes(e).includes("cpf"),
  );

test("test_an_empty_family_draws_no_family_line", () => {
  assert.equal(familyLines(FLAT).length, 0);
});

test("test_a_named_family_draws_one_family_line", () => {
  assert.equal(familyLines(FAMILY).length, 1);
});
