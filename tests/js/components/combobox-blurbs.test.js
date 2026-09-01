// Behavioral suite for the family and variant BLURBS on the Simplified chain
// dropdowns, read off the rendered Field the way combobox-plainnames.test.js
// reads it. The /api/metadata `plain_names` sections now carry the three-key
// shape {entries, families, variants}: `entries` is the per-name display dict
// as before, `families` maps a family name to its blurb and `variants` maps the
// composite "<family>|<variant>" to its blurb. The observable contract:
//
//   Simplified: the family blurb renders as a caption row immediately after
//   that family's header row (before the family's first subheader or option),
//   and the variant blurb as a caption row immediately after that variant's
//   subheader row; a caption row is not an option row; a family or
//   family|variant pair absent from the maps renders its header with nothing
//   between it and its first content.
//
//   Unchanged by the blurb data: Standard mode's rows (raw labels, source
//   order, no blurb wording), the closed-button label, and every join by raw
//   option label — favorites narrowing and rate-graying included.
//
// "Immediately after" and "no caption row" are read off the rendered fragment
// by offsets — which elements sit between the header and the group's first
// content — never by a class the component happens to use (policy
// docs/testing.md; same discipline as combobox-plainnames.test.js).
//
// Every needle below is the fixture's OWN invented data — a blurb, a family
// name, a variant name — never a word the component supplies: the family names
// are deliberately unique tokens so a header can be located without naming the
// word the component appends to it (docs/testing.md rule 9). What the dropdown
// OFFERS is read off the `data-v` wire value each row carries.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/combobox-blurbs.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { elements, classes, attr, text } from "../support/markup.js";
import { rows } from "../support/comborows.js";
import { plainNames } from "../../../hqptuner/static/store/prefs.js";
import { reset, field, optionByValue, attrOf, META } from "../support/field-harness.js";
import { nApod1x, nQuality } from "../../../hqptuner/static/store/narrow/state.js";
import { favoriteFilters, favoritesError, nFavOnly } from "../../../hqptuner/static/store/narrow/favorites.js";
import { favoritesRoutes, favoritesState } from "../support/favoriteswire.js";
import { staticWire } from "../support/wire.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// --- the plain-names data -----------------------------------------------------
// Same entries combobox-plainnames.test.js groups by (built here rather than
// spelled out, the shape being that suite's business), wrapped in the three-key
// shape and given blurbs for SOME of its groups: families Gauss and Sinc carry
// a blurb while Ext does not, and of Gauss's two variants only "Zed tap"
// carries one — so both the present-blurb and the absent-blurb renders are
// observable in one fragment. Blurb strings are invented test data.

const GAUSS_BLURB = "Bells of every width";
const SINC_BLURB = "One long ess";
const ZED_BLURB = "Taps counted from zed";

// Family names chosen so each occurs in exactly one place in the render — its
// own header — which is what lets a header be located without matching the
// word the component appends to it.
const GAUSS = "Famgauss";
const SINC = "Famsinc";
const EXT = "Famext";
const ZED = "Zed tap";
const ALPHA = "Alpha tap";

/**
 * One plain-names entry.
 *
 * @param {string} family
 * @param {string | null} variant
 * @param {string} leaf
 * @param {string} short
 */
const entry = (family, variant, leaf, short) => ({ family, variant, leaf, short, apod: false });

/**
 * One three-key plain-names section, blurb maps empty unless given.
 *
 * @param {Record<string, object>} entries
 * @param {Record<string, string>} [families]
 * @param {Record<string, string>} [variants]
 */
const section = (entries, families = {}, variants = {}) => ({ entries, families, variants });

const META_BLURBS = {
  ...META,
  plain_names: {
    filters: section(
      {
        "sinc-M": entry(SINC, null, "Classic M", "Sinc M"),
        "poly-sinc-gauss-zeta": entry(GAUSS, ZED, "Zeta pick", "Gauss Zeta"),
        "poly-sinc-gauss-long": entry(GAUSS, ZED, "Alpha pick", "Gauss Reg"),
        "poly-sinc-gauss-short": entry(GAUSS, ALPHA, "Shorter", "Gauss Short"),
        "poly-sinc-ext2": { ...entry(EXT, null, "Ext Two", "Ext 2"), apod: true },
      },
      { [GAUSS]: GAUSS_BLURB, [SINC]: SINC_BLURB },
      { [`${GAUSS}|${ZED}`]: ZED_BLURB },
    ),
    dithers: section({ TPDF: entry("Dither", null, "Triangular", "TPDF plain") }),
    modulators: section({
      ASDM7: entry("ASDM", null, "Seventh", "ASDM 7"),
      ASDM7EC: entry("ASDM", null, "Seventh EC", "ASDM 7EC"),
    }),
  },
};

const RAW_ORDER = [
  "poly-sinc-gauss-short",
  "unknown-b",
  "poly-sinc-gauss-long",
  "sinc-M",
  "poly-sinc-ext2",
  "unknown-a",
  "poly-sinc-gauss-zeta",
];

// What the dropdown offers, as the SET of wire values its rows carry: each
// option is offered under its index in RAW_ORDER. A sorted set rather than a
// sequence — a grouped list's display order is presentation, which rule 9 keeps
// out of an assertion alongside the labels.
const ALL_VALUES = RAW_ORDER.map((_, i) => String(i)).sort();
const GAUSS_LONG_VALUE = "2";

/** @param {string} value */
const filterFields = (value) => [
  { name: "filter1x", value, options: RAW_ORDER.map((label, i) => ({ value: `${i}`, label })) },
];

/**
 * The 1x filter field with both default facets opened (these cases are about
 * the caption rows, not the narrowing).
 *
 * @param {{ plain?: boolean, value?: string }} [state]
 * @returns {Promise<string>}
 */
async function filterField({ plain = true, value = "0" } = {}) {
  await reset({ fields: filterFields(value), meta: META_BLURBS });
  plainNames.value = plain;
  nQuality.value = 0;
  nApod1x.value = "all";
  return field("pcm_filter_1x");
}

// --- markup readers -----------------------------------------------------------

/**
 * Text a user reads off the closed combobox button (the dd-box element's own
 * content, tags stripped) — same contract combobox-plainnames.test.js pins the
 * closed control with.
 *
 * @param {string} out
 * @returns {string}
 */
function boxText(out) {
  const box = elements(out).find((el) => classes(el).includes("dd-box"));
  if (!box) throw new Error("no closed combobox button in the rendered output");
  return text(box);
}

/**
 * The smallest element whose text includes `needle` — how a caption and a group
 * header are both located, by the fixture's own invented wording. Throws when
 * nothing reads it, so an absence fails loudly instead of comparing against
 * nothing.
 *
 * @param {string} out
 * @param {string} needle
 * @returns {MarkupElement}
 */
function smallestReading(out, needle) {
  /** @type {MarkupElement | undefined} */
  let best;
  for (const el of elements(out)) {
    if (!text(el).includes(needle)) continue;
    if (!best || el.html.length < best.html.length) best = el;
  }
  if (!best) throw new Error(`nothing rendered reads "${needle}"`);
  return best;
}

// A row located by the FIXTURE's own leaf — what the caption-placement cases
// need, since they ask where a caption sits relative to a group's first row.
// Deliberately not named `rowIncluding`: the support helper of that name takes
// a `data-v` wire value, and the two must be distinguishable at a call site.
/**
 * The option row (dd-opt element) whose text includes `needle`. Throws when no
 * row does.
 *
 * @param {string} out
 * @param {string} needle
 * @returns {MarkupElement}
 */
function rowReading(out, needle) {
  for (const el of elements(out)) {
    if (classes(el).includes("dd-opt") && text(el).includes(needle)) return el;
  }
  throw new Error(`no option row reads "${needle}"`);
}

/**
 * @param {MarkupElement} el
 * @returns {number}
 */
const endOf = (el) => el.start + el.html.length;

/**
 * The elements rendered wholly BETWEEN `a` and `b` in the fragment — what sits
 * after a header row and before its group's first content.
 *
 * @param {string} out
 * @param {MarkupElement} a
 * @param {MarkupElement} b
 * @returns {MarkupElement[]}
 */
const between = (out, a, b) => elements(out).filter((el) => el.start >= endOf(a) && endOf(el) <= b.start);

/**
 * The wire values a rendered dropdown offers, sorted.
 *
 * @param {string} out
 * @returns {(string | undefined)[]}
 */
const offered = (out) =>
  rows(out)
    .map((r) => attr(r, "data-v"))
    .sort();

// --- the caption rows ---------------------------------------------------------

// The Gauss family's first content after its header is the "Zed tap" variant
// subheader; the family blurb caption renders between the two.
test("test_a_family_blurb_renders_between_the_family_header_and_its_first_content", async () => {
  const out = await filterField();
  const cap = smallestReading(out, GAUSS_BLURB);
  assert.equal(smallestReading(out, GAUSS).start < cap.start && cap.start < smallestReading(out, ZED).start, true);
});

// Sinc holds a single null-variant option; its blurb still renders between the
// header and that first option row.
test("test_a_null_variant_familys_blurb_renders_before_its_first_option_row", async () => {
  const out = await filterField();
  const cap = smallestReading(out, SINC_BLURB);
  assert.equal(smallestReading(out, SINC).start < cap.start && cap.start < rowReading(out, "Classic M").start, true);
});

test("test_a_variant_blurb_renders_between_the_subheader_and_the_variants_first_row", async () => {
  const out = await filterField();
  const cap = smallestReading(out, ZED_BLURB);
  assert.equal(smallestReading(out, ZED).start < cap.start && cap.start < rowReading(out, "Zeta pick").start, true);
});

test("test_a_family_blurb_caption_is_not_an_option_row", async () => {
  assert.equal(classes(smallestReading(await filterField(), GAUSS_BLURB)).includes("dd-opt"), false);
});

test("test_a_variant_blurb_caption_is_not_an_option_row", async () => {
  assert.equal(classes(smallestReading(await filterField(), ZED_BLURB)).includes("dd-opt"), false);
});

test("test_a_family_blurb_caption_carries_no_option_role", async () => {
  assert.equal(/\brole="option"/.test(smallestReading(await filterField(), GAUSS_BLURB).attrs), false);
});

// --- a group the maps do not know ---------------------------------------------
// Ext has no family blurb: nothing at all renders between its header and its
// first (and only) option row. Alpha tap has no variant blurb: nothing renders
// between its subheader and its first row.

test("test_a_family_absent_from_the_map_renders_nothing_between_header_and_first_row", async () => {
  const out = await filterField();
  assert.deepEqual(between(out, smallestReading(out, EXT), rowReading(out, "Ext Two")), []);
});

test("test_a_variant_pair_absent_from_the_map_renders_nothing_between_subheader_and_first_row", async () => {
  const out = await filterField();
  assert.deepEqual(between(out, smallestReading(out, ALPHA), rowReading(out, "Shorter")), []);
});

// --- the blurb data changes nothing else ----------------------------------------

// The caption rows are not option rows anywhere: the option list reads exactly
// as it did without blurbs.
test("test_blurb_captions_add_no_option_rows", async () => {
  assert.deepEqual(offered(await filterField()), ALL_VALUES);
});

test("test_standard_mode_still_offers_every_option_with_blurb_data", async () => {
  assert.deepEqual(offered(await filterField({ plain: false })), ALL_VALUES);
});

test("test_standard_mode_renders_no_blurb_wording", async () => {
  const out = await filterField({ plain: false });
  assert.deepEqual(
    [GAUSS_BLURB, SINC_BLURB, ZED_BLURB].filter((blurb) => out.includes(blurb)),
    [],
  );
});

test("test_the_closed_control_still_reads_the_selections_short_with_blurb_data", async () => {
  assert.equal(boxText(await filterField()), "Gauss Short");
});

test("test_favorites_narrowing_still_joins_by_raw_label_with_blurb_data", async () => {
  await reset({ fields: filterFields("0"), meta: META_BLURBS });
  staticWire({ live: {}, http: {} }, favoritesRoutes(favoritesState()));
  plainNames.value = true;
  nFavOnly.value = true;
  nQuality.value = 0;
  nApod1x.value = "all";
  favoritesError.value = "";
  favoriteFilters.value = new Set(["poly-sinc-gauss-long"]);
  assert.deepEqual(offered(field("pcm_filter_1x")), [GAUSS_LONG_VALUE]);
});

// A DSD512 rate leaves ASDM7EC below its 40.96 MHz floor (same wire setup as
// combobox.test.js's rate-gray cases); the join grays the same row with the
// three-key shape carrying empty blurb maps.
test("test_a_rate_grayed_modulator_row_stays_disabled_with_blurb_data", async () => {
  const options = ["ASDM7", "ASDM7EC"].map((label, i) => ({ value: `${i}`, label }));
  await reset({
    fields: [
      { name: "defaults_bitrate", value: "24576000" },
      { name: "modulator", value: "0", options },
    ],
    meta: META_BLURBS,
  });
  plainNames.value = true;
  const row = optionByValue(field("sdm_modulator"), "1");
  assert.equal(attrOf(row?.a || "", "aria-disabled"), "true");
});
