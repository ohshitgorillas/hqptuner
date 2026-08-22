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
//   the plain-names data; an
//   option with no plain-names entry keeps its raw label and sorts after all
//   known groups; within one family+variant group the rows follow the data's
//   own entry order, not the input order; the closed control reads the
//   selection's SHORT, falling back
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
// signal. Headers are found as "the smallest element reading the FIXTURE's own
// family or variant name" — the family names are deliberately unique tokens, so
// a header is located without matching any word the component supplies — and
// what the dropdown offers, and in what order, is read off the `data-v` wire
// value each row carries rather than off the labels (docs/testing.md rule 9).
// A per-option label is only ever compared against the fixture's own invented
// leaf, addressed by that option's wire value.
//
// NOT covered here, SSR reaching the closed state only (docs/testing.md
// "Branches that cannot be reached"): that a header row is not selectable or
// committable and that keyboard navigation skips it — pointer/keyboard
// behavior, browser hand-back protocol. The variant subheader's INDENTATION is
// presentation and is left to the visual hand-back too.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/combobox-plainnames.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { reset, field, optionByValue, attrOf, META } from "../support/field-harness.js";
import { rows } from "../support/comborows.js";
import { staticWire } from "../support/wire.js";
import { favoritesRoutes, favoritesState } from "../support/favoriteswire.js";
import { favoriteFilters, favoritesError, nFavOnly } from "../../../hqptuner/static/store/narrow/favorites.js";
import { nApod1x, nQuality } from "../../../hqptuner/static/store/narrow/state.js";
import { enums } from "../../../hqptuner/static/store/signals.js";
import { plainNames } from "../../../hqptuner/static/store/prefs.js";
import { elements, classes, attr, text } from "../support/markup.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// --- the plain-names data -----------------------------------------------------
// Data order deliberately DISAGREES with the option input order AND with
// alphabetical order, so only the data's own entry order can pass: families
// first appear here as Sinc, Gauss, Ext; within Gauss the "Zed tap" variant is
// introduced before "Alpha tap" (anti-alphabetical, and the input serves an
// Alpha tap row first); WITHIN the Zed tap group the data lists leaf
// "Zeta pick" (raw poly-sinc-gauss-zeta) before "Alpha pick" (raw
// poly-sinc-gauss-long) while the input serves poly-sinc-gauss-long first — so
// data order disagrees with relative input order and with alphabetical order
// of both leaf and raw name, and an alphabetical sort visibly fails.

// Family names are unique tokens that occur nowhere else in a render, so a
// family header can be located by the fixture's own name rather than by the
// word the component appends to it.
const SINC = "Famsinc";
const GAUSS = "Famgauss";
const EXT = "Famext";
const ZED = "Zed tap";
const ALPHA = "Alpha tap";

const PLAIN_FILTERS = {
  "sinc-M": { family: SINC, variant: null, leaf: "Classic M", short: "Sinc M", apod: false },
  "poly-sinc-gauss-zeta": {
    family: GAUSS,
    variant: ZED,
    leaf: "Zeta pick",
    short: "Gauss Zeta",
    apod: false,
  },
  "poly-sinc-gauss-long": { family: GAUSS, variant: ZED, leaf: "Alpha pick", short: "Gauss Reg", apod: false },
  "poly-sinc-gauss-short": {
    family: GAUSS,
    variant: ALPHA,
    leaf: "Shorter",
    short: "Gauss Short",
    apod: false,
  },
  "poly-sinc-ext2": { family: EXT, variant: null, leaf: "Ext Two", short: "Ext 2", apod: true },
};

const META_PLAIN = {
  ...META,
  plain_names: {
    filters: { entries: PLAIN_FILTERS, families: {}, variants: {} },
    dithers: {
      entries: { TPDF: { family: "Dither", variant: null, leaf: "Triangular", short: "TPDF plain" } },
      families: {},
      variants: {},
    },
    modulators: {
      entries: {
        ASDM7: { family: "ASDM", variant: null, leaf: "Seventh", short: "ASDM 7" },
        ASDM7EC: { family: "ASDM", variant: null, leaf: "Seventh EC", short: "ASDM 7EC" },
      },
      families: {},
      variants: {},
    },
  },
};

// Input order interleaves the families and the two unknown names, so grouping
// and the unknown tail are both observable against it; it first serves the
// "Alpha tap" variant (poly-sinc-gauss-short) before any "Zed tap" row, so the
// variant order the rows keep can only come from the data.
const RAW_ORDER = [
  "poly-sinc-gauss-short",
  "unknown-b",
  "poly-sinc-gauss-long",
  "sinc-M",
  "poly-sinc-ext2",
  "unknown-a",
  "poly-sinc-gauss-zeta",
];

/** @param {string} value */
const filterFields = (value) => [
  {
    name: "filter1x",
    value,
    options: RAW_ORDER.map((label, i) => ({ value: String(i), label })),
  },
];

// The wire value each raw name is offered under, and the two orders the rows
// are read in: the input order Standard keeps, and the grouped order Simplified
// computes from the plain-names data.
const VALUE = Object.fromEntries(RAW_ORDER.map((name, i) => [name, String(i)]));
const INPUT_VALUES = RAW_ORDER.map((name) => VALUE[name]);
const PLAIN_VALUES = [
  "sinc-M",
  "poly-sinc-gauss-zeta",
  "poly-sinc-gauss-long",
  "poly-sinc-gauss-short",
  "poly-sinc-ext2",
  "unknown-b",
  "unknown-a",
].map((name) => VALUE[name]);

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
 * The smallest element whose text reads the fixture's own `needle` — how a
 * family or variant header row is found. Throws when nothing reads it, so an
 * absence fails loudly instead of comparing against nothing.
 *
 * @param {string} out
 * @param {string} needle
 * @returns {MarkupElement}
 */
function headerReading(out, needle) {
  const hits = elements(out).filter((el) => text(el).includes(needle));
  if (hits.length === 0) throw new Error(`nothing rendered reads "${needle}"`);
  return hits.reduce((a, b) => (a.html.length <= b.html.length ? a : b));
}

/**
 * The wire values a rendered dropdown offers, in document order.
 *
 * @param {string} out
 * @returns {(string | undefined)[]}
 */
const offeredOrder = (out) => rows(out).map((r) => attr(r, "data-v"));

// A row located by the FIXTURE's own leaf, which is what the grouping and
// ordering cases need: they ask where a row sits relative to a header, and the
// leaf is the test's own invented data. Deliberately not named `rowIncluding` —
// the support helper of that name takes a `data-v` wire value, and a reader
// must be able to tell the two apart at the call site.
/**
 * The option row (dd-opt element) whose text includes `needle`. Throws when no
 * row does.
 *
 * @param {string} out
 * @param {string} needle
 * @returns {MarkupElement}
 */
function rowReading(out, needle) {
  const hit = elements(out).find((el) => classes(el).includes("dd-opt") && text(el).includes(needle));
  if (!hit) throw new Error(`no option row reads "${needle}"`);
  return hit;
}

// --- the default -----------------------------------------------------------------
// This process has no localStorage at all (plain node), which IS the
// storage-unset case. The value the module loads with is read off a FRESH
// instance imported under a `.fresh-<tag>.js` specifier (resolved by
// tests/js/support/vendor-resolve.js to the real module's source under a URL
// node has not cached), so the case holds wherever it runs in the file — no
// dependence on being registered before any case writes the live signal. The
// specifier is built rather than literal because it names a file that is not
// on disk, which `tsc -p jsconfig.json` refuses as a literal (TS2307).

const PREFS_MODULE = new URL("../../../hqptuner/static/store/prefs.js", import.meta.url).href;

test("test_an_unset_storage_reads_as_standard", async () => {
  const fresh = await import(`${PREFS_MODULE.replace(/\.js$/, ".fresh-unset.js")}`);
  assert.equal(fresh.plainNames.value, false);
});

// --- pref off: exactly as before ----------------------------------------------

test("test_pref_off_option_rows_keep_source_order", async () => {
  assert.deepEqual(offeredOrder(await filterField({ plain: false })), INPUT_VALUES);
});

test("test_pref_off_renders_no_family_header_row", async () => {
  const out = await filterField({ plain: false });
  assert.deepEqual(
    elements(out).filter((el) => text(el).includes(GAUSS)),
    [],
  );
});

test("test_pref_off_the_closed_control_shows_the_raw_label", async () => {
  assert.equal(boxText(await filterField({ plain: false })), "poly-sinc-gauss-short");
});

// --- pref on: plain leaves, grouped and ordered by the data ---------------------

test("test_pref_on_option_rows_are_grouped_by_family_then_variant", async () => {
  assert.deepEqual(offeredOrder(await filterField()), PLAIN_VALUES);
});

// A known row reads the fixture's own invented leaf rather than its raw name:
// the round-trip of the overlay through the component, addressed by the row's
// wire value.
test("test_pref_on_a_known_options_row_reads_the_fixtures_own_leaf", async () => {
  const out = await filterField();
  assert.equal(optionByValue(out, VALUE["poly-sinc-gauss-zeta"])?.label, PLAIN_FILTERS["poly-sinc-gauss-zeta"].leaf);
});

test("test_unknown_options_sort_after_all_known_groups_in_input_order", async () => {
  assert.deepEqual(offeredOrder(await filterField()).slice(-2), [VALUE["unknown-b"], VALUE["unknown-a"]]);
});

// An option the data does not know keeps its raw engine name.
test("test_an_unknown_options_row_keeps_its_raw_name", async () => {
  const out = await filterField();
  assert.equal(optionByValue(out, VALUE["unknown-b"])?.label, "unknown-b");
});

// The data lists Zeta pick before Alpha pick within the Zed tap group while the
// input order (and the alphabetical order of both leaf and raw name) has the
// Alpha row first; the rows keep the DATA order, Zeta pick first.
test("test_within_one_group_rows_keep_data_order_not_relative_input_order", async () => {
  const order = offeredOrder(await filterField());
  assert.equal(order.indexOf(VALUE["poly-sinc-gauss-zeta"]) < order.indexOf(VALUE["poly-sinc-gauss-long"]), true);
});

// --- pref on: the header rows ---------------------------------------------------

test("test_pref_on_a_family_header_precedes_the_familys_first_option", async () => {
  const out = await filterField();
  assert.equal(headerReading(out, GAUSS).start < rowReading(out, "Zeta pick").start, true);
});

test("test_pref_on_a_variant_subheader_precedes_the_variants_first_option", async () => {
  const out = await filterField();
  assert.equal(headerReading(out, ALPHA).start < rowReading(out, "Shorter").start, true);
});

test("test_a_family_header_row_is_not_an_option_row", async () => {
  assert.equal(classes(headerReading(await filterField(), GAUSS)).includes("dd-opt"), false);
});

test("test_a_variant_subheader_row_is_not_an_option_row", async () => {
  assert.equal(classes(headerReading(await filterField(), ALPHA)).includes("dd-opt"), false);
});

// Ext holds a single option; its family header still renders before that row.
test("test_a_single_option_family_still_gets_its_family_header", async () => {
  const out = await filterField();
  assert.equal(headerReading(out, EXT).start < rowReading(out, "Ext Two").start, true);
});

// Sinc's and Ext's variants are null: no element stringifies the missing
// variant into wording a reader would see. (That their rows also skip the
// variant SUBCONTAINER is pinned structurally below, in the nested-grouping
// section.)
test("test_a_null_variant_stringifies_no_placeholder_wording", async () => {
  const out = await filterField();
  assert.deepEqual(
    elements(out).filter((el) => text(el) === "null" || text(el) === "undefined"),
    [],
  );
});

// --- pref on: the closed control ------------------------------------------------

test("test_pref_on_the_closed_control_shows_the_selections_short", async () => {
  assert.equal(boxText(await filterField()), "Gauss Short");
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
  assert.deepEqual(offeredOrder(field("pcm_filter_1x")), [VALUE["poly-sinc-gauss-long"]]);
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
  assert.deepEqual(offeredOrder(field("pcm_filter_1x")), [VALUE["poly-sinc-ext2"]]);
});

test("test_pref_on_keeps_the_favorite_star_affordance_on_a_named_row", async () => {
  assert.equal(/\bdd-fav\b/.test(rowReading(await filterField(), "Alpha pick").html), true);
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
  const row = optionByValue(field("sdm_modulator"), "1");
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
  const out = field("pcm_dither");
  assert.deepEqual(
    ["0", "1"].map((v) => optionByValue(out, v)?.label),
    ["Triangular", "NS9"],
  );
});

// --- the overlay missing entirely -------------------------------------------------
// A metadata payload with no `plain_names` key at all (older backend, or the
// static data absent): the pref being ON must not reorder or relabel anything —
// every row keeps its raw label in the input order, identity with pref off.

test("test_pref_on_without_plain_names_data_rows_keep_input_order", async () => {
  await reset({ fields: filterFields("0"), meta: META });
  nApod1x.value = "all";
  nQuality.value = 0;
  plainNames.value = true;
  assert.deepEqual(offeredOrder(field("pcm_filter_1x")), INPUT_VALUES);
});

test("test_pref_on_without_plain_names_data_a_row_keeps_its_raw_name", async () => {
  await reset({ fields: filterFields("0"), meta: META });
  nApod1x.value = "all";
  nQuality.value = 0;
  plainNames.value = true;
  assert.equal(optionByValue(field("pcm_filter_1x"), VALUE["sinc-M"])?.label, "sinc-M");
});

// --- nested grouping (spec plain-dd-structure) -----------------
// The rows NEST rather than
// flatten: every option row is a descendant of the container its family's
// header starts, and each variant's rows sit in that variant's own
// subcontainer. Ancestry is read off the rendered fragment by offsets (which
// element encloses which), never by class.

/**
 * @param {MarkupElement} el
 * @returns {number}
 */
const endOf = (el) => el.start + el.html.length;

/**
 * Whether `a` encloses `b` in the fragment (and is not `b` itself).
 *
 * @param {MarkupElement} a
 * @param {MarkupElement} b
 * @returns {boolean}
 */
const encloses = (a, b) =>
  a.start <= b.start && endOf(a) >= endOf(b) && !(a.start === b.start && a.html.length === b.html.length);

/**
 * The smallest element enclosing both `a` and `b` — the group container two
 * pieces of one family (or of one variant) share. Throws when nothing encloses
 * both, so a missing container fails loudly.
 *
 * @param {string} out
 * @param {MarkupElement} a
 * @param {MarkupElement} b
 * @returns {MarkupElement}
 */
function commonContainer(out, a, b) {
  const around = elements(out).filter((el) => encloses(el, a) && encloses(el, b));
  if (around.length === 0) throw new Error("nothing in the fragment encloses both elements");
  return around.reduce((x, y) => (x.html.length <= y.html.length ? x : y));
}

test("test_a_family_header_row_carries_no_option_role", async () => {
  assert.equal(/\brole="option"/.test(headerReading(await filterField(), GAUSS).attrs), false);
});

test("test_a_variant_subheader_row_carries_no_option_role", async () => {
  assert.equal(/\brole="option"/.test(headerReading(await filterField(), ALPHA).attrs), false);
});

// The container the Gauss header shares with a Gauss row holds none of Sinc's
// rows: families are grouped, not a flat sibling list.
test("test_a_familys_rows_share_a_container_that_excludes_other_families_rows", async () => {
  const out = await filterField();
  const grp = commonContainer(out, headerReading(out, GAUSS), rowReading(out, "Zeta pick"));
  assert.equal(encloses(grp, rowReading(out, "Classic M")), false);
});

// That same family container holds BOTH of Gauss's variants ("Shorter" is the
// Alpha tap row): the variant split happens inside the family group.
test("test_a_family_container_holds_the_rows_of_all_of_that_familys_variants", async () => {
  const out = await filterField();
  const grp = commonContainer(out, headerReading(out, GAUSS), rowReading(out, "Zeta pick"));
  assert.equal(encloses(grp, rowReading(out, "Shorter")), true);
});

// The container the Zed tap subheader shares with its own row excludes the
// sibling variant's row: each variant nests in its own subcontainer.
test("test_a_variants_rows_sit_in_a_subcontainer_that_excludes_the_other_variants_rows", async () => {
  const out = await filterField();
  const vgrp = commonContainer(out, headerReading(out, ZED), rowReading(out, "Zeta pick"));
  assert.equal(encloses(vgrp, rowReading(out, "Shorter")), false);
});

// The container classes are the one place the spec anchors a class, because
// the pref-OFF absence below has no ancestry to read. These two ground the
// tokens: the containers the ancestry tests above find are the dd-grp/dd-vgrp
// elements, so the OFF test's class filter looks for the same containers the
// ON state actually renders.
test("test_the_family_container_found_by_ancestry_carries_class_dd_grp", async () => {
  const out = await filterField();
  const grp = commonContainer(out, headerReading(out, GAUSS), rowReading(out, "Zeta pick"));
  assert.equal(classes(grp).includes("dd-grp"), true);
});

test("test_the_variant_subcontainer_found_by_ancestry_carries_class_dd_vgrp", async () => {
  const out = await filterField();
  const vgrp = commonContainer(out, headerReading(out, ZED), rowReading(out, "Zeta pick"));
  assert.equal(classes(vgrp).includes("dd-vgrp"), true);
});

// A null-variant family's rows sit directly in the family group: nothing
// carrying the (grounded) variant-subcontainer class encloses Sinc's row.
test("test_a_null_variant_rows_sit_in_no_variant_subcontainer", async () => {
  const out = await filterField();
  const row = rowReading(out, "Classic M");
  assert.deepEqual(
    elements(out).filter((el) => classes(el).includes("dd-vgrp") && encloses(el, row)),
    [],
  );
});

// Pref OFF stays a flat option list: no family or variant group container
// renders at all (the container classes grounded just above, because an
// absence has no ancestry to read).
test("test_pref_off_renders_no_group_container_element", async () => {
  assert.deepEqual(
    elements(await filterField({ plain: false })).filter(
      (el) => classes(el).includes("dd-grp") || classes(el).includes("dd-vgrp"),
    ),
    [],
  );
});
