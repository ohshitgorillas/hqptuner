// Behavioral suite for the Simplified option style showing the TRUE raw engine
// name (spec plain-desc-truename): with the pref ON and a selection the
// plain-names overlay knows, the field's `.field-desc` line carries a child
// element classed `field-desc-name` reading the raw engine name ahead of the
// description prose, and a known option's tip carries the raw name. Standard
// mode and overlay-unknown names surface neither.
//
// Fixtures ride the field harness the plain-names suites use
// (tests/js/components/combobox-plainnames.test.js): the overlay arrives on the
// /api/metadata payload (`plain_names`), the pref is the exported signal, and
// the field-desc block is read off the SSR-rendered Field. The TIP is pinned
// through the public resolver instead — tipsFor(entry, meta)'s TipContent now
// leads with `name`, the raw engine name for a Simplified overlay-known option
// and "" otherwise — because the tip markup (.dd-tip-name/.dd-tip-desc) mounts
// only while the pop is open with a highlighted option, which SSR of a closed
// field never reaches (docs/testing.md "Branches that cannot be reached").
// Deliberate gap, adjudicated: the DOM ordering of .dd-tip-name before
// .dd-tip-desc is unreachable here and is left to the browser hand-back
// protocol.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Elements are found by class token via the shared markup scanner;
// presence helpers throw, so an absence fails loudly.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/plaindesc-truename.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { schema } from "../../../hqptuner/static/store/schema.js";
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

// --- the option tip, through the public resolver ------------------------------

// tipsFor lives in components/binder.js (the file-length extraction out of
// Field.js); the specifier is built rather than literal because a checkout
// that predates the extraction has no such file on disk, which `tsc -p
// jsconfig.json` refuses as a literal (TS2307) — same convention as the
// plain-names suite's fresh-instance specifiers.
const BINDER = new URL("../../../hqptuner/static/components/binder.js", import.meta.url).href;

/**
 * One filter option's TipContent under a seeded overlay and pref — the same
 * resolver route the facet-tip suite drives, throwing (not asserting) when the
 * entry yields no resolver so the one assert stays at the call site.
 *
 * @param {{ plain?: boolean, label?: string }} [state]
 * @returns {Promise<{ name: string }>}
 */
async function filterTip({ plain = true, label = "sinc-M" } = {}) {
  const { tipsFor } = await import(`${BINDER}`);
  await reset({ meta: META_PLAIN });
  plainNames.value = plain;
  const tip = tipsFor(schema.pcm_filter_1x, META.settings.dsp.filter_1x);
  if (!tip) throw new Error("expected a tip resolver for the 1x filter entry");
  return tip({ value: "0", label });
}

test("test_simplified_on_a_known_options_tip_name_is_the_raw_engine_name", async () => {
  assert.equal((await filterTip()).name, "sinc-M");
});

// --- standard mode: neither surface carries the name --------------------------

test("test_standard_mode_renders_no_field_desc_name_element", async () => {
  assert.deepEqual(byClass(await oneOptionField({ plain: false }), "field-desc-name"), []);
});

test("test_standard_mode_a_known_options_tip_name_is_empty", async () => {
  assert.equal((await filterTip({ plain: false })).name, "");
});

// --- simplified ON, selection the overlay does not know -----------------------

test("test_simplified_on_an_unknown_selection_renders_no_field_desc_name_element", async () => {
  assert.deepEqual(byClass(await oneOptionField({ label: "poly-sinc-xtr-mp" }), "field-desc-name"), []);
});

test("test_simplified_on_an_unknown_options_tip_name_is_empty", async () => {
  assert.equal((await filterTip({ label: "poly-sinc-xtr-mp" })).name, "");
});
