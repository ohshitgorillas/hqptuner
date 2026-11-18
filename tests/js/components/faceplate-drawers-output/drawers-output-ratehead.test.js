// Rendered suite for the head of the Output drawer's rate dial row, drawn by the generic drawer from the Output schema
// (hqptuner/static/components/faceplate/drawers/output.js): the row carries one header, and beside it a sub-label, the
// same way the DAC bits row does. The DAC bits row is the reference the dial row's head is read against.
//
// Renders through preact-render-to-string with the store driven at the wire by the staging fake. The dial is found by
// its role (`group`) and class, its row as the smallest drawer row enclosing it, the DAC bits row by its catalog key
// (`data-k`); a header is a row label (`b`), a sub-label the head's `s`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers-output/drawers-output-ratehead.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { NETWORK_FILE, loadOutput, outputMarkup, rateRow } from "../../support/rendered/outputdrawer.js";
import { attr, classes, elements } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

/** The DAC bits row of the network backend, the reference head. */
const DAC_BITS_ROW = "net_bits";

beforeEach(async () => {
  await loadOutput(NETWORK_FILE);
});

/** The elements inside the smallest drawer row enclosing the rate dial, or none when no row encloses it. */
function inDialRow() {
  const row = rateRow(outputMarkup());
  return row ? elements(row.html) : [];
}

/** The elements inside the DAC bits row. */
function inDacBitsRow() {
  const row = outputMarkup().find((e) => classes(e).includes("drow") && attr(e, "data-k") === DAC_BITS_ROW);
  return row ? elements(row.html) : [];
}

/** @param {MarkupElement[]} inside */
const headers = (inside) => inside.filter((e) => e.name === "b").length;

test("test_the_dac_bits_row_prints_one_header", () => {
  assert.deepEqual(headers(inDacBitsRow()), 1);
});

test("test_the_rate_dial_row_prints_one_header", () => {
  assert.deepEqual(headers(inDialRow()), 1);
});
