// Behavioral suite for optionProse(entry, option, meta): an option's manual prose split into the text that reads inline
// and the paragraphs held back behind "see more". A two-stage filter's shared two-stage note is held back; the filter's
// own prose reads inline. Pure of everything except the /api/metadata overlay signal, which the field-harness reset()
// seeds with its worked META payload.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/prose-more.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { optionProse } from "../../../hqptuner/static/store/prose.js";
import { schema } from "../../../hqptuner/static/store/schema.js";
import { reset, META } from "../support/field-harness.js";

const FILTER_META = META.settings.dsp.filter_1x;

/** @param {string} label */
const prose = (label) => optionProse(schema.pcm_filter_1x, { value: "0", label }, FILTER_META);

test("test_a_two_stage_filter_holds_the_two_stage_note_back_in_standard", async () => {
  await reset({ plain: false });
  assert.deepEqual(prose("sinc-M-2s").more, [META.filters.two_stage_note]);
});

test("test_a_two_stage_filter_reads_inline_as_its_single_stage_twin_in_standard", async () => {
  await reset({ plain: false });
  assert.equal(prose("sinc-M-2s").text, prose("sinc-M").text);
});
