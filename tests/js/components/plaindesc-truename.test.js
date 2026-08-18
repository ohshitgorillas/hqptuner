// Behavioral suite for the Simplified option style showing the TRUE raw engine
// name (spec plain-desc-truename): with the pref ON and a selection the
// plain-names overlay knows, the field's `.field-desc` line carries a child
// element classed `field-desc-name` reading the raw engine name ahead of the
// description prose, and a known option's tip markup carries the raw name in a
// `dd-tip-name` element ahead of its `.dd-tip-desc` prose. Standard mode and
// overlay-unknown names render neither element.
//
// Fixtures ride the field harness the plain-names suites use
// (tests/js/components/combobox-plainnames.test.js): the overlay arrives on the
// /api/metadata payload (`plain_names`), the pref is the exported signal, and
// everything is read off the SSR-rendered Field. The spec's "tip markup" is
// read off that same rendered output; if an implementation renders tips only in
// the pointer-opened popup, these cases cannot see them — a reachability
// question for the orchestrator, noted rather than papered over.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Elements are found by class token via the shared markup scanner;
// presence helpers throw, so an absence fails loudly.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/plaindesc-truename.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { reset, field, META } from "../support/field-harness.js";
import { nApod1x, nQuality } from "../../../hqptuner/static/store/narrow/state.js";
import { plainNames } from "../../../hqptuner/static/store/prefs.js";
import { elements, classes, text } from "../support/markup.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// The overlay knows sinc-M (whose manual prose META already carries, so the
// field-desc line has description text to precede) and does NOT know
// poly-sinc-xtr-mp, which still resolves manual prose through the alias — the
// unknown cases show the NAME element absent while the description renders.
const META_PLAIN = {
  ...META,
  plain_names: {
    filters: { "sinc-M": { family: "Sinc", variant: null, leaf: "Classic M", short: "Sinc M" } },
    dithers: {},
    modulators: {},
  },
};

/**
 * The 1x filter field holding one option, selected, with both default facets
 * opened (these cases are about the desc line and the tip, not narrowing).
 *
 * @param {{ plain?: boolean, label?: string }} [state]
 * @returns {Promise<string>}
 */
async function oneOptionField({ plain = true, label = "sinc-M" } = {}) {
  await reset({
    fields: [{ name: "filter1x", value: "0", options: [{ value: "0", label }] }],
    meta: META_PLAIN,
  });
  nApod1x.value = "all";
  nQuality.value = 0;
  plainNames.value = plain;
  return field("pcm_filter_1x");
}

/**
 * Every element of a fragment carrying `cls` as a whole class token.
 *
 * @param {string} fragment
 * @param {string} cls
 * @returns {MarkupElement[]}
 */
const byClass = (fragment, cls) => elements(fragment).filter((el) => classes(el).includes(cls));

/**
 * The one element of a fragment carrying `cls` — throws when nothing does, so
 * a missing element fails loudly instead of comparing against nothing.
 *
 * @param {string} fragment
 * @param {string} cls
 * @returns {MarkupElement}
 */
function oneByClass(fragment, cls) {
  const [hit] = byClass(fragment, cls);
  if (!hit) throw new Error(`no element with class "${cls}" in the fragment`);
  return hit;
}

// --- simplified ON, selection known to the overlay ----------------------------

test("test_simplified_on_the_field_desc_name_reads_the_raw_engine_name", async () => {
  assert.equal(text(oneByClass(await oneOptionField(), "field-desc-name")), "sinc-M");
});

test("test_simplified_on_the_name_element_is_a_child_of_the_field_desc", async () => {
  const desc = oneByClass(await oneOptionField(), "field-desc");
  assert.equal(
    elements(desc.html).some((el) => classes(el).includes("field-desc-name")),
    true,
  );
});

test("test_simplified_on_the_name_precedes_the_description_prose_in_the_field_desc", async () => {
  const desc = oneByClass(await oneOptionField(), "field-desc").html;
  const prose = desc.indexOf("A very long sinc.");
  if (prose < 0) throw new Error("the field-desc carries no description prose");
  assert.equal(oneByClass(desc, "field-desc-name").start < prose, true);
});

// --- simplified ON, a known option's tip --------------------------------------

test("test_simplified_on_a_known_options_tip_name_reads_the_raw_engine_name", async () => {
  assert.equal(text(oneByClass(await oneOptionField(), "dd-tip-name")), "sinc-M");
});

test("test_simplified_on_the_tip_name_precedes_the_tip_desc_prose_element", async () => {
  const out = await oneOptionField();
  assert.equal(oneByClass(out, "dd-tip-name").start < oneByClass(out, "dd-tip-desc").start, true);
});

// --- standard mode: neither element renders anywhere --------------------------

test("test_standard_mode_renders_no_field_desc_name_element", async () => {
  assert.deepEqual(byClass(await oneOptionField({ plain: false }), "field-desc-name"), []);
});

test("test_standard_mode_renders_no_dd_tip_name_element", async () => {
  assert.deepEqual(byClass(await oneOptionField({ plain: false }), "dd-tip-name"), []);
});

// --- simplified ON, selection the overlay does not know -----------------------

test("test_simplified_on_an_unknown_selection_renders_no_field_desc_name_element", async () => {
  assert.deepEqual(byClass(await oneOptionField({ label: "poly-sinc-xtr-mp" }), "field-desc-name"), []);
});

test("test_simplified_on_an_unknown_options_tip_renders_no_dd_tip_name_element", async () => {
  assert.deepEqual(byClass(await oneOptionField({ label: "poly-sinc-xtr-mp" }), "dd-tip-name"), []);
});
