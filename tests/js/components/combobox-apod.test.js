// Behavioral suite for the apodizing badges on the chain filter dropdowns
// (controls/Combobox.js `badge`, wired by binder.js for the `narrow`-carrying
// entries): a filter's class — full-apodizing, half-apodizing, or neither —
// renders as a non-interactive badge, glyph "A" labelled "Apodizing" for full
// and glyph "½" labelled "Half apodizing" for half, and nothing for neither.
// The badges are a SIMPLIFIED-STYLE feature (owner decision): with the pref
// on, every apodizing option row wears its own badge — including when a whole
// family or variant shares one class — and no family header or variant
// subheader ever carries one. Standard option style shows the raw engine
// names with no badge at all. A non-filter combobox — dither, modulator —
// renders no badge in either style.
//
// The class joins by raw engine filter name: the live enumeration's `arg`
// bitfield (bit 0 apodizing, bit 1 half-apodizing; the live daemon serves it
// as a string, full "1", half "2", neither "0") unioned with the static
// overlay's `apodizing` fact ("full" | "half" | "none", data/filters.json) —
// the fixtures serve BOTH, consistent, the way the real wire does, and the
// Simplified entries carry the same class as their `apod` field. A badge is
// found by its ACCESSIBLE LABEL (aria-label "Apodizing" / "Half apodizing"),
// never by a class the component happens to use.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire; rendering through preact-render-to-string reads the closed
// control, whose pop is hidden rather than unmounted. Non-interactivity is
// read off the renderer's own vnode seam (no onClick), the way
// combobox-fav.test.js reads the star's.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/combobox-apod.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { reset, field, optionLabels, META } from "../support/field-harness.js";
import { renderField } from "../support/vnodeseam.js";
import { elements, classes, text } from "../support/markup.js";
import { enums } from "../../../hqptuner/static/store/signals.js";
import { plainNames } from "../../../hqptuner/static/store/prefs.js";
import { nApod1x, nQuality } from "../../../hqptuner/static/store/narrow/state.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// --- the fixtures ---------------------------------------------------------
// One filter of each class for the Standard cases; for the Simplified cases a
// family that is uniformly full ("Uni", one variant, so its subheader is
// observable too) and a family that is not ("Mixed"): one uniformly full
// variant, one uniformly half variant, and one mixed variant.

/** @type {[string, string, string][]} name, enum arg, overlay class */
const STD = [
  ["full-a", "1", "full"],
  ["half-a", "2", "half"],
  ["plain-a", "0", "none"],
];

/** @type {[string, string, string, string, string | null, string][]} name, arg, class, family, variant, leaf */
const SIM = [
  ["uni-a", "1", "full", "Uni", "UV", "U One"],
  ["uni-b", "1", "full", "Uni", "UV", "U Two"],
  ["mix-f1", "1", "full", "Mixed", "Vfull", "MF One"],
  ["mix-f2", "1", "full", "Mixed", "Vfull", "MF Two"],
  ["mix-h1", "2", "half", "Mixed", "Vhalf", "MH One"],
  ["mix-m1", "1", "full", "Mixed", "Vmix", "MM One"],
  ["mix-m2", "0", "none", "Mixed", "Vmix", "MM Two"],
];

/** @param {string[]} names */
const filterFields = (names) => [
  { name: "filter1x", value: "0", options: names.map((label, i) => ({ value: String(i), label })) },
];

// The live enumeration's own shape: `arg` a string bitfield, `apodizing` the
// decoded bit 0, every row rated above the quality facet's floor.
/** @param {[string, string][]} pairs */
const filterEnums = (pairs) => ({
  filters: pairs.map(([name, arg], i) => ({
    index: String(i),
    name,
    value: String(i),
    arg,
    description: "5/5 ⥮ Any",
    apodizing: arg === "1",
  })),
});

// The static overlay's half of the facet union, alongside META's own entries.
/** @param {[string, string][]} pairs name, class */
const overlayMeta = (pairs) => ({
  ...META,
  filters: {
    ...META.filters,
    filters: { ...META.filters.filters, ...Object.fromEntries(pairs.map(([n, c]) => [n, { apodizing: c }])) },
  },
});

const META_STD = overlayMeta(STD.map(([n, , c]) => [n, c]));

const META_SIM = {
  ...overlayMeta(SIM.map(([n, , c]) => [n, c])),
  plain_names: {
    filters: {
      entries: Object.fromEntries(
        SIM.map(([n, , c, family, variant, leaf]) => [n, { family, variant, leaf, short: leaf, apod: c }]),
      ),
      families: {},
      variants: {},
    },
    dithers: { entries: {}, families: {}, variants: {} },
    modulators: {
      entries: {
        ASDM7: { family: "ASDM", variant: null, leaf: "Seventh", short: "ASDM 7", apod: "none" },
        ASDM7EC: { family: "ASDM", variant: null, leaf: "Seventh EC", short: "ASDM 7EC", apod: "none" },
      },
      families: {},
      variants: {},
    },
  },
};

/** @param {boolean} plain */
async function filterField(plain) {
  const rows = plain ? SIM : STD;
  await reset({ fields: filterFields(rows.map(([n]) => n)), meta: plain ? META_SIM : META_STD });
  enums.value = filterEnums(rows.map(([n, arg]) => [n, arg]));
  nApod1x.value = "all";
  nQuality.value = 0;
  plainNames.value = plain;
  return field("pcm_filter_1x");
}

const standardField = () => filterField(false);
const simplifiedField = () => filterField(true);

// --- markup readers ---------------------------------------------------------

/** @param {MarkupElement} el */
const ariaOf = (el) => (/aria-label="([^"]*)"/.exec(el.attrs) || [])[1];

/** @param {MarkupElement} el */
const isBadge = (el) => ariaOf(el) === "Apodizing" || ariaOf(el) === "Half apodizing";

/** @param {string} out */
const badges = (out) => elements(out).filter(isBadge);

/** @param {MarkupElement} el */
const endOf = (el) => el.start + el.html.length;

/**
 * Whether `a` encloses `b` in the fragment (and is not `b` itself).
 *
 * @param {MarkupElement} a
 * @param {MarkupElement} b
 */
const encloses = (a, b) =>
  a.start <= b.start && endOf(a) >= endOf(b) && !(a.start === b.start && a.html.length === b.html.length);

/**
 * @param {string} out
 * @param {MarkupElement} box
 */
const badgesIn = (out, box) => badges(out).filter((b) => encloses(box, b));

/** The dd-opt rows of a render, in document order. */
/** @param {string} out */
const rows = (out) =>
  elements(out)
    .filter((el) => classes(el).includes("dd-opt"))
    .sort((a, b) => a.start - b.start);

/**
 * The option row whose text includes `needle`. Throws when no row does, so an
 * absence fails loudly instead of comparing against nothing.
 *
 * @param {string} out
 * @param {string} needle
 */
function rowIncluding(out, needle) {
  const hit = rows(out).find((el) => text(el).includes(needle));
  if (!hit) throw new Error(`no option row reads "${needle}"`);
  return hit;
}

/**
 * The one badge of a region; anything but exactly one match throws.
 *
 * @param {string} out
 * @param {MarkupElement} box
 */
function onlyBadgeIn(out, box) {
  const found = badgesIn(out, box);
  if (found.length !== 1) throw new Error(`expected one badge, found ${found.length}`);
  return found[0];
}

/**
 * The favorite star of a row, by the dd-fav marking combobox-fav.test.js pins.
 *
 * @param {string} out
 * @param {MarkupElement} row
 */
function starOf(out, row) {
  const hit = elements(out).find((el) => classes(el).includes("dd-fav") && encloses(row, el));
  if (!hit) throw new Error("no favorite star inside the row");
  return hit;
}

// --- Simplified style: the badge, its label and its glyph ------------------------
// Driven on the Simplified fixture throughout: the badges are a
// Simplified-style feature, so the presence, label, glyph, position and
// non-interactivity contracts all hold with the pref ON. "U One" is a
// full-apodizing row, "MH One" a half-apodizing one, "MM Two" neither.

test("test_a_full_apodizing_row_carries_a_badge_labelled_apodizing", async () => {
  const out = await simplifiedField();
  assert.equal(ariaOf(onlyBadgeIn(out, rowIncluding(out, "U One"))), "Apodizing");
});

test("test_the_apodizing_badge_glyph_reads_a", async () => {
  const out = await simplifiedField();
  assert.equal(text(onlyBadgeIn(out, rowIncluding(out, "U One"))), "A");
});

test("test_a_half_apodizing_row_carries_a_badge_labelled_half_apodizing", async () => {
  const out = await simplifiedField();
  assert.equal(ariaOf(onlyBadgeIn(out, rowIncluding(out, "MH One"))), "Half apodizing");
});

test("test_the_half_apodizing_badge_glyph_reads_the_half_sign", async () => {
  const out = await simplifiedField();
  assert.equal(text(onlyBadgeIn(out, rowIncluding(out, "MH One"))), "½");
});

test("test_a_row_of_neither_class_carries_no_badge", async () => {
  const out = await simplifiedField();
  assert.equal(badgesIn(out, rowIncluding(out, "MM Two")).length, 0);
});

// --- the badge is a marking, not an affordance ---------------------------------

test("test_the_badge_carries_no_click_handler", async () => {
  await simplifiedField();
  const { seen } = renderField("pcm_filter_1x");
  const badge = seen.find((v) => v && v.props && v.props["aria-label"] === "Apodizing");
  if (!badge) throw new Error("no vnode carries the Apodizing label");
  assert.equal(typeof badge.props.onClick === "function", false);
});

// --- the badge sits between the row's text and the star ---------------------------

test("test_the_badge_renders_after_the_rows_own_text", async () => {
  const out = await simplifiedField();
  const row = rowIncluding(out, "U One");
  const at = out.indexOf("U One", row.start);
  if (at < 0) throw new Error("the row's own text is not in the fragment");
  assert.equal(onlyBadgeIn(out, row).start > at, true);
});

test("test_the_badge_precedes_the_favorite_star_in_document_order", async () => {
  const out = await simplifiedField();
  const row = rowIncluding(out, "U One");
  assert.equal(onlyBadgeIn(out, row).start < starOf(out, row).start, true);
});

// --- Standard style: raw names, no badges, ever ------------------------------------
// The fixture's classes are fully known — enum arg bits and overlay facts both
// served — yet none may render: the badge is Simplified-only.

test("test_standard_style_renders_no_badge_on_any_row", async () => {
  const out = await standardField();
  assert.equal(badges(out).length, 0);
});

test("test_standard_style_keeps_the_raw_flat_list", async () => {
  const out = await standardField();
  assert.deepEqual(optionLabels(out), ["full-a", "half-a", "plain-a"]);
});

// --- non-filter comboboxes carry no badge ---------------------------------------

test("test_a_dither_dropdown_renders_no_badge_on_any_row", async () => {
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
    meta: META_STD,
  });
  plainNames.value = false;
  assert.equal(badges(field("pcm_dither")).length, 0);
});

test("test_a_modulator_dropdown_renders_no_badge_on_any_row", async () => {
  await reset({
    fields: [
      { name: "defaults_bitrate", value: "49152000" },
      {
        name: "modulator",
        value: "0",
        options: [
          { value: "0", label: "ASDM7" },
          { value: "1", label: "ASDM7EC" },
        ],
      },
    ],
    meta: META_SIM,
  });
  plainNames.value = true;
  assert.equal(badges(field("sdm_modulator")).length, 0);
});

// --- Simplified style: badges stay on the rows, never on headers ------------------
// Badge hoisting is withdrawn (owner decision): a family or variant that is
// uniformly one class still badges each of its own rows. Row order is the
// plain-names data order the plainnames suite pins: U One, U Two, MF One,
// MF Two, MH One, MM One, MM Two.

test("test_simplified_style_badges_every_apodizing_row_individually", async () => {
  const out = await simplifiedField();
  assert.deepEqual(
    rows(out).map((r) => badgesIn(out, r).length),
    [1, 1, 1, 1, 1, 1, 0],
  );
});

test("test_a_uniform_familys_rows_each_carry_their_own_badge", async () => {
  const out = await simplifiedField();
  assert.deepEqual(
    [rowIncluding(out, "U One"), rowIncluding(out, "U Two")].map((r) => badgesIn(out, r).length),
    [1, 1],
  );
});

test("test_a_uniform_variants_rows_each_carry_their_own_badge", async () => {
  const out = await simplifiedField();
  assert.deepEqual(
    [rowIncluding(out, "MF One"), rowIncluding(out, "MF Two")].map((r) => badgesIn(out, r).length),
    [1, 1],
  );
});

test("test_a_mixed_variant_badges_each_apodizing_row_individually", async () => {
  const out = await simplifiedField();
  assert.deepEqual(
    [rowIncluding(out, "MM One"), rowIncluding(out, "MM Two")].map((r) => badgesIn(out, r).length),
    [1, 0],
  );
});

// A badge no option row encloses would be a header's, a subheader's or a
// blurb's — family headers and variant subheaders never carry one, so every
// badge of the fragment must sit inside a row. Uniform groups included: the
// fixture's Uni family and Vfull/Vhalf variants are exactly the groups a
// leftover hoist would badge.
test("test_no_badge_renders_outside_an_option_row", async () => {
  const out = await simplifiedField();
  assert.deepEqual(
    badges(out).filter((b) => !rows(out).some((r) => encloses(r, b))),
    [],
  );
});
