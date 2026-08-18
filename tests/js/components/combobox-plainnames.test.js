// Behavioral suite for the "Simplified names" option style on the chain
// dropdowns, read off the rendered Field the way every combobox suite reads it
// (tests/js/components/combobox.test.js). The pref is one signal; the observable
// contract is what the rows and the closed button say in each of its states:
//
//   OFF (Standard): the dropdown renders exactly as before — raw engine labels,
//   source order, no header rows.
//
//   ON (Simplified): each option row reads its plain LEAF; a family header row
//   precedes each family's first option and a variant subheader precedes each
//   non-null variant's first option, and a header row is not an option row;
//   options order by family first-appearance then variant first-appearance in
//   the plain-names data, keeping relative input order within one group; an
//   option with no plain-names entry keeps its raw label and sorts after all
//   known groups; the closed control reads the selection's SHORT, falling back
//   to the raw label for a selection the data does not know. Toggling the pref
//   changes none of narrowing, favorites, or rate-graying.
//
// The plain-names data rides the /api/metadata payload (`plain_names`, keyed
// filters/dithers/modulators, raw name -> {family, variant, leaf, short}), so
// it is driven here through the harness's metadata fixture — the running engine
// stays the enumeration authority and the data only annotates, joined by name
// (docs/architecture.md §2).
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire; state driven through the field harness plus the pref's exported
// signal. Headers are found as "the smallest element reading exactly the family
// or variant text", never by a class the component happens to use.
//
// NOT covered here, SSR reaching the closed state only (docs/testing.md
// "Branches that cannot be reached"): that a header row is not selectable or
// committable and that keyboard navigation skips it — pointer/keyboard
// behaviour, browser hand-back protocol. The variant subheader's INDENTATION is
// presentation and is left to the visual hand-back too.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/combobox-plainnames.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { reset, field, optionLabels, optionByLabel, attrOf, META } from "../support/field-harness.js";
import { staticWire } from "../support/wire.js";
import { favoritesRoutes, favoritesState } from "../support/favoriteswire.js";
import { favoriteFilters, favoritesError, nFavOnly } from "../../../hqptuner/static/store/narrow/favorites.js";
import { nApod1x, nQuality } from "../../../hqptuner/static/store/narrow/state.js";
import { enums } from "../../../hqptuner/static/store/signals.js";
import { plainNames } from "../../../hqptuner/static/store/prefs.js";
import { elements, classes, text } from "../support/markup.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// --- the plain-names data -----------------------------------------------------
// Data order deliberately DISAGREES with the option input order, so the family
// regrouping is observable: families first appear here as Sinc, Gauss, Ext, and
// within Gauss the "Long tap" variant before "Short tap". WITHIN the Long tap
// group the data lists Hires LP before Regular while the input order has
// Regular first, so a sort keeping data order instead of relative input order
// visibly reverses the pair.

const PLAIN_FILTERS = {
  "sinc-M": { family: "Sinc", variant: null, leaf: "Classic M", short: "Sinc M", apod: false },
  "poly-sinc-gauss-hires-lp": {
    family: "Gauss",
    variant: "Long tap",
    leaf: "Hires LP",
    short: "Gauss Hires",
    apod: false,
  },
  "poly-sinc-gauss-long": { family: "Gauss", variant: "Long tap", leaf: "Regular", short: "Gauss Reg", apod: false },
  "poly-sinc-gauss-short": {
    family: "Gauss",
    variant: "Short tap",
    leaf: "Shorter",
    short: "Gauss Short",
    apod: false,
  },
  "poly-sinc-ext2": { family: "Ext", variant: null, leaf: "Ext Two", short: "Ext 2", apod: true },
};

const META_PLAIN = {
  ...META,
  plain_names: {
    filters: PLAIN_FILTERS,
    dithers: { TPDF: { family: "Dither", variant: null, leaf: "Triangular", short: "TPDF plain" } },
    modulators: {
      ASDM7: { family: "ASDM", variant: null, leaf: "Seventh", short: "ASDM 7" },
      ASDM7EC: { family: "ASDM", variant: null, leaf: "Seventh EC", short: "ASDM 7EC" },
    },
  },
};

// Input order interleaves the families and the two unknown names, so grouping
// and the unknown tail are both observable against it.
const RAW_ORDER = [
  "poly-sinc-gauss-long",
  "unknown-b",
  "poly-sinc-gauss-short",
  "sinc-M",
  "poly-sinc-ext2",
  "unknown-a",
  "poly-sinc-gauss-hires-lp",
];

/** @param {string} value */
const filterFields = (value) => [
  {
    name: "filter1x",
    value,
    options: RAW_ORDER.map((label, i) => ({ value: String(i), label })),
  },
];

const PLAIN_ORDER = ["Classic M", "Regular", "Hires LP", "Shorter", "Ext Two", "unknown-b", "unknown-a"];

/**
 * The 1x filter field with both default facets opened (the stage narrows to
 * apodizing and a 3/5 quality floor by default; these cases are about the rows).
 *
 * @param {{ plain?: boolean, value?: string }} [state]
 * @returns {Promise<string>}
 */
async function filterField({ plain = true, value = "0" } = {}) {
  await reset({ fields: filterFields(value), meta: META_PLAIN });
  nApod1x.value = "all";
  nQuality.value = 0;
  plainNames.value = plain;
  return field("pcm_filter_1x");
}

// --- markup readers -----------------------------------------------------------

// Text a user reads off the closed combobox button (the dd-box element's own
// content, tags stripped) — same reader combobox-narrowed-current.test.js pins
// EQUALITY with, because "names the selection" is only half the contract.
/**
 * @param {string} out
 * @returns {string}
 */
function boxText(out) {
  const m = /<button\b[^<>]*\bclass="[^"]*\bdd-box\b[^"]*"[^<>]*>([\s\S]*?)<\/button>/.exec(out || "");
  if (!m) throw new Error("no closed combobox button in the rendered output");
  return m[1].replace(/<[^<>]*>/g, "").trim();
}

/**
 * The smallest element whose whole text reads exactly `wording` — how a header
 * row is found, by what a reader sees rather than by class. Throws when nothing
 * reads it, so an absence fails loudly instead of comparing against nothing.
 *
 * @param {string} out
 * @param {string} wording
 * @returns {MarkupElement}
 */
function readingExactly(out, wording) {
  const hits = elements(out).filter((el) => text(el) === wording);
  if (hits.length === 0) throw new Error(`nothing rendered reads exactly "${wording}"`);
  return hits.reduce((a, b) => (a.html.length <= b.html.length ? a : b));
}

/**
 * The option row (dd-opt element) whose text includes `needle`. Throws when no
 * row does.
 *
 * @param {string} out
 * @param {string} needle
 * @returns {MarkupElement}
 */
function rowIncluding(out, needle) {
  const hit = elements(out).find((el) => classes(el).includes("dd-opt") && text(el).includes(needle));
  if (!hit) throw new Error(`no option row reads "${needle}"`);
  return hit;
}

// --- the default -----------------------------------------------------------------
// This process has no localStorage at all (plain node), which IS the
// storage-unset case: registered FIRST, before any case below writes the
// signal, so the value read here is the one the module loaded with.

test("test_an_unset_storage_reads_as_standard", () => {
  assert.equal(plainNames.value, false);
});

// --- pref off: exactly as before ----------------------------------------------

test("test_pref_off_option_rows_keep_raw_labels_in_source_order", async () => {
  assert.deepEqual(optionLabels(await filterField({ plain: false })), RAW_ORDER);
});

test("test_pref_off_renders_no_family_header_row", async () => {
  const out = await filterField({ plain: false });
  assert.deepEqual(
    elements(out).filter((el) => text(el) === "Gauss"),
    [],
  );
});

test("test_pref_off_the_closed_control_shows_the_raw_label", async () => {
  assert.equal(boxText(await filterField({ plain: false })), "poly-sinc-gauss-long");
});

// --- pref on: plain leaves, grouped and ordered by the data ---------------------

test("test_pref_on_option_rows_read_plain_leaves_grouped_by_family_then_variant", async () => {
  assert.deepEqual(optionLabels(await filterField()), PLAIN_ORDER);
});

test("test_pref_on_no_option_row_reads_a_known_raw_name", async () => {
  assert.equal(optionLabels(await filterField()).includes("sinc-M"), false);
});

test("test_unknown_options_keep_raw_labels_after_all_known_groups_in_input_order", async () => {
  assert.deepEqual(optionLabels(await filterField()).slice(-2), ["unknown-b", "unknown-a"]);
});

// The data lists Hires LP before Regular within the Long tap group; the rows
// keep the INPUT order, Regular first.
test("test_within_one_group_rows_keep_relative_input_order_not_data_order", async () => {
  const labels = optionLabels(await filterField());
  assert.equal(labels.indexOf("Regular") < labels.indexOf("Hires LP"), true);
});

// --- pref on: the header rows ---------------------------------------------------

test("test_pref_on_a_family_header_precedes_the_familys_first_option", async () => {
  const out = await filterField();
  assert.equal(readingExactly(out, "Gauss").start < rowIncluding(out, "Regular").start, true);
});

test("test_pref_on_a_variant_subheader_precedes_the_variants_first_option", async () => {
  const out = await filterField();
  assert.equal(readingExactly(out, "Short tap").start < rowIncluding(out, "Shorter").start, true);
});

test("test_a_family_header_row_is_not_an_option_row", async () => {
  assert.equal(classes(readingExactly(await filterField(), "Gauss")).includes("dd-opt"), false);
});

test("test_a_variant_subheader_row_is_not_an_option_row", async () => {
  assert.equal(classes(readingExactly(await filterField(), "Short tap")).includes("dd-opt"), false);
});

// Ext holds a single option; its family header still renders before that row.
test("test_a_single_option_family_still_gets_its_family_header", async () => {
  const out = await filterField();
  assert.equal(readingExactly(out, "Ext").start < rowIncluding(out, "Ext Two").start, true);
});

// Sinc's and Ext's variants are null: no subheader renders for them, so no
// element stringifies the missing variant into wording a reader would see.
test("test_a_null_variant_renders_no_subheader_row", async () => {
  const out = await filterField();
  assert.deepEqual(
    elements(out).filter((el) => text(el) === "null" || text(el) === "undefined"),
    [],
  );
});

// --- pref on: the closed control ------------------------------------------------

test("test_pref_on_the_closed_control_shows_the_selections_short", async () => {
  assert.equal(boxText(await filterField()), "Gauss Reg");
});

test("test_pref_on_an_unknown_selection_keeps_its_raw_label_on_the_closed_control", async () => {
  assert.equal(boxText(await filterField({ value: "1" })), "unknown-b");
});

// --- the pref changes nothing else ----------------------------------------------

test("test_pref_on_favorites_narrowing_still_hides_the_same_options", async () => {
  await reset({ fields: filterFields("0"), meta: META_PLAIN });
  nApod1x.value = "all";
  nQuality.value = 0;
  staticWire({ live: {}, http: {} }, favoritesRoutes(favoritesState()));
  favoriteFilters.value = new Set(["poly-sinc-gauss-long"]);
  favoritesError.value = "";
  nFavOnly.value = true;
  plainNames.value = true;
  assert.deepEqual(optionLabels(field("pcm_filter_1x")), ["Regular"]);
});

// An engaged FACET narrows the same way favorites do: apodizing-only (the 1x
// stage's own default) keeps only the one apodizing filter of the enumeration,
// and its row reads its plain leaf. Classification rides the live enumeration
// (`arg` bit 0 = apodizing, protocol.md), same seam field.test.js narrows on.
test("test_pref_on_an_engaged_apodizing_facet_still_hides_non_apodizing_rows", async () => {
  await reset({ fields: filterFields("0"), meta: META_PLAIN });
  enums.value = {
    filters: RAW_ORDER.map((name, i) => ({
      index: String(i),
      name,
      value: String(i),
      arg: name === "poly-sinc-ext2" ? 1 : 0,
      description: "5/5 ⥮ Any",
      apodizing: name === "poly-sinc-ext2",
    })),
  };
  nApod1x.value = "only";
  nQuality.value = 0;
  nFavOnly.value = false;
  plainNames.value = true;
  assert.deepEqual(optionLabels(field("pcm_filter_1x")), ["Ext Two"]);
});

test("test_pref_on_keeps_the_favorite_star_affordance_on_a_named_row", async () => {
  assert.equal(/\bdd-fav\b/.test(rowIncluding(await filterField(), "Regular").html), true);
});

// A DSD512 rate leaves ASDM7EC below its 40.96 MHz floor, so its row is
// rate-grayed (same wire setup as combobox.test.js's rate-gray cases); the
// simplified row must gray the same way the raw one does.
test("test_pref_on_a_rate_grayed_modulator_row_stays_disabled", async () => {
  await reset({
    fields: [
      { name: "defaults_bitrate", value: "24576000" },
      {
        name: "modulator",
        value: "0",
        options: [
          { value: "0", label: "ASDM7" },
          { value: "1", label: "ASDM7EC" },
        ],
      },
    ],
    meta: META_PLAIN,
  });
  plainNames.value = true;
  const row = optionByLabel(field("sdm_modulator"), "Seventh EC");
  assert.equal(attrOf(row?.a || "", "aria-disabled"), "true");
});

// --- the other shaper dropdown joins the same way --------------------------------

test("test_pref_on_a_dither_row_reads_its_plain_leaf_and_an_unknown_keeps_its_raw_name", async () => {
  await reset({
    fields: [
      { name: "defaults_samplerate", value: "384000" },
      {
        name: "dither",
        value: "0",
        options: [
          { value: "0", label: "TPDF" },
          { value: "1", label: "NS9" },
        ],
      },
    ],
    meta: META_PLAIN,
  });
  plainNames.value = true;
  assert.deepEqual(optionLabels(field("pcm_dither")), ["Triangular", "NS9"]);
});
