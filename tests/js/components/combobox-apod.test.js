// Behavioral suite for the apodizing badges on the chain filter dropdowns
// (controls/Combobox.js `badge`, wired by binder.js for the `narrow`-carrying
// entries): a filter's class — full-apodizing, half-apodizing, or neither —
// renders as a non-interactive badge labeled "Apodizing" for full and "Half
// apodizing" for half, and nothing for neither. The glyph is baked vector
// geometry — one <path> per badge, distinct per class, never font text.
// The badges render in BOTH option styles (owner decision): with the pref
// on, every apodizing option row wears its own badge — including when a whole
// family or variant shares one class — and no family header or variant
// subheader ever carries one. Standard option style shows the raw engine
// names, each apodizing row carrying the same badge after its name.
// A non-filter combobox — dither, modulator — renders no badge in either
// style.
//
// The class joins by raw engine filter name: the live enumeration's `arg`
// bitfield (bit 0 apodizing, bit 1 half-apodizing; the live daemon serves it
// as a string, full "1", half "2", neither "0") unioned with the static
// overlay's `apodizing` fact ("full" | "half" | "none", data/filters.json) —
// the fixtures serve BOTH, consistent, the way the real wire does, and the
// Simplified entries carry the same class as their `apod` field. A badge is
// found by the `dd-apod` class it wears, and full is told from half by the
// vector path each draws — never by the accessible wording, which is the
// owner's to reword (docs/testing.md rule 9). Rows are addressed by the
// `data-v` wire value each carries.
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

import { reset, field, META } from "../support/field-harness.js";
import { renderField } from "../support/vnodeseam.js";
import { elements, classes, attr, text } from "../support/markup.js";
import { endOf, encloses, rows, rowIncluding, classTokens } from "../support/comborows.js";
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

// Each fixture offers its filters under their index, and a dd-opt row is
// addressed by the `data-v` wire value it carries (docs/testing.md rule 9).
const [U_FULL, U_FULL_2, MF_1, MF_2, MH_HALF, MM_1, MM_NONE] = SIM.map((_, i) => String(i));
const [STD_FULL, STD_HALF, STD_NONE] = STD.map((_, i) => String(i));

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

// Non-filter entries CARRYING an apodizing class, served the same way the
// filter fixtures serve theirs — the overlay's `apodizing` fact plus the
// Simplified entry's own `apod` — so the badge's absence in the non-filter
// tests below pins the dropdown-type rule, not a classless fixture.
const META_SIM_APOD_NONFILTER = {
  ...META_SIM,
  shapers: {
    ...META.shapers,
    pcm_dithers: {
      ...META.shapers.pcm_dithers,
      TPDF: { description: "Triangular dither.", apodizing: "full" },
    },
    sdm_modulators: {
      ...META.shapers.sdm_modulators,
      ASDM7: { description: "Seventh order modulator.", apodizing: "full" },
    },
  },
  plain_names: {
    ...META_SIM.plain_names,
    dithers: {
      entries: {
        TPDF: { family: "TPDF", variant: null, leaf: "TPDF", short: "TPDF", apod: "full" },
        NS9: { family: "NS", variant: null, leaf: "Ninth", short: "NS 9", apod: "none" },
      },
      families: {},
      variants: {},
    },
    modulators: {
      entries: {
        ASDM7: { family: "ASDM", variant: null, leaf: "Seventh", short: "ASDM 7", apod: "full" },
        ASDM7EC: { family: "ASDM", variant: null, leaf: "Seventh EC", short: "ASDM 7EC", apod: "none" },
      },
      families: {},
      variants: {},
    },
  },
};

/** @param {boolean} plain */
async function filterField(plain) {
  const fixture = plain ? SIM : STD;
  await reset({ fields: filterFields(fixture.map(([n]) => n)), meta: plain ? META_SIM : META_STD });
  enums.value = filterEnums(fixture.map(([n, arg]) => [n, arg]));
  nApod1x.value = "all";
  nQuality.value = 0;
  plainNames.value = plain;
  return field("pcm_filter_1x");
}

const standardField = () => filterField(false);
const simplifiedField = () => filterField(true);

// --- markup readers ---------------------------------------------------------

/** @param {MarkupElement} el */
const roleOf = (el) => (/(?:^|\s)role="([^"]*)"/.exec(el.attrs) || [])[1];

// The class the apodizing badge wears. A class token is contract; the wording
// inside the badge's accessible label is not.
const BADGE_CLASS = "dd-apod";

/** @param {MarkupElement} el */
const isBadge = (el) => classes(el).includes(BADGE_CLASS);

/** @param {string} out */
const badges = (out) => elements(out).filter(isBadge);

// The fixture guard the style cases lean on: the rows rendered in the style the
// case is about, told apart by a name only that style produces. The needles are
// the fixture's own invented data, never a word the component supplies.
/**
 * @param {string} out
 * @param {string} needle
 */
function assertRowReads(out, needle) {
  if (!rows(out).some((r) => text(r).includes(needle))) throw new Error(`no option row reads "${needle}"`);
}

/**
 * @param {string} out
 * @param {MarkupElement} box
 */
const badgesIn = (out, box) => badges(out).filter((b) => encloses(box, b));

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

/** @param {MarkupElement} el */
const paths = (el) => elements(el.html).filter((p) => p.name === "path");

/**
 * Whether an <svg> of the badge encloses the path — both scanned from the
 * badge's own html, so their offsets share one origin.
 *
 * @param {MarkupElement} badge
 * @param {MarkupElement} p
 */
const svgEncloses = (badge, p) => elements(badge.html).some((el) => el.name === "svg" && encloses(el, p));

/**
 * The one <path> of a badge's vector glyph; anything but exactly one throws.
 *
 * @param {MarkupElement} badge
 */
function glyphPathOf(badge) {
  const found = paths(badge);
  if (found.length !== 1) throw new Error(`expected one path in the badge, found ${found.length}`);
  return found[0];
}

/** @param {MarkupElement} el */
const pathData = (el) => (/(?:^|\s)d="([^"]*)"/.exec(el.attrs) || [])[1];

/**
 * Offset of `needle` where it renders as VISIBLE TEXT of the row — a match
 * inside a tag's attribute run (between a "<" and its ">") is skipped, so an
 * aria-label or title carrying the label never anchors the position. Throws
 * when the row shows no such text.
 *
 * @param {string} out
 * @param {MarkupElement} row
 * @param {string} needle
 */
function visibleTextAt(out, row, needle) {
  for (let at = out.indexOf(needle, row.start); at >= 0 && at < endOf(row); at = out.indexOf(needle, at + 1)) {
    if (out.lastIndexOf(">", at) > out.lastIndexOf("<", at)) return at;
  }
  throw new Error(`"${needle}" is not visible text of the row`);
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

test("test_a_full_apodizing_row_carries_exactly_one_badge", async () => {
  const out = await simplifiedField();
  assert.equal(badgesIn(out, rowIncluding(out, U_FULL)).length, 1);
});

test("test_the_badge_glyph_is_exactly_one_vector_path_inside_an_svg", async () => {
  const out = await simplifiedField();
  const badge = onlyBadgeIn(out, rowIncluding(out, U_FULL));
  assert.deepEqual(
    paths(badge).map((p) => svgEncloses(badge, p)),
    [true],
  );
});

test("test_the_full_badge_renders_role_img", async () => {
  const out = await simplifiedField();
  assert.equal(roleOf(onlyBadgeIn(out, rowIncluding(out, U_FULL))), "img");
});

test("test_a_half_apodizing_row_carries_exactly_one_badge", async () => {
  const out = await simplifiedField();
  assert.equal(badgesIn(out, rowIncluding(out, MH_HALF)).length, 1);
});

test("test_the_half_badge_glyph_is_exactly_one_vector_path_inside_an_svg", async () => {
  const out = await simplifiedField();
  const badge = onlyBadgeIn(out, rowIncluding(out, MH_HALF));
  assert.deepEqual(
    paths(badge).map((p) => svgEncloses(badge, p)),
    [true],
  );
});

test("test_the_half_badge_renders_role_img", async () => {
  const out = await simplifiedField();
  assert.equal(roleOf(onlyBadgeIn(out, rowIncluding(out, MH_HALF))), "img");
});

test("test_the_badge_contains_no_text_element", async () => {
  const out = await simplifiedField();
  assert.equal(elements(onlyBadgeIn(out, rowIncluding(out, U_FULL)).html).filter((el) => el.name === "text").length, 0);
});

test("test_the_badge_shows_no_text_content", async () => {
  const out = await simplifiedField();
  assert.equal(text(onlyBadgeIn(out, rowIncluding(out, U_FULL))), "");
});

test("test_the_full_and_half_badges_draw_distinct_glyphs", async () => {
  const out = await simplifiedField();
  assert.notEqual(
    pathData(glyphPathOf(onlyBadgeIn(out, rowIncluding(out, U_FULL)))),
    pathData(glyphPathOf(onlyBadgeIn(out, rowIncluding(out, MH_HALF)))),
  );
});

test("test_a_row_of_neither_class_carries_no_badge", async () => {
  const out = await simplifiedField();
  assert.equal(badgesIn(out, rowIncluding(out, MM_NONE)).length, 0);
});

// --- the badge is a marking, not an affordance ---------------------------------

test("test_the_badge_carries_no_click_handler", async () => {
  await simplifiedField();
  const { seen } = renderField("pcm_filter_1x");
  const badge = seen.find((v) => v && v.props && classTokens(v).includes(BADGE_CLASS));
  if (!badge) throw new Error(`no vnode wears ${BADGE_CLASS}`);
  assert.equal(typeof badge.props.onClick === "function", false);
});

// --- the badge sits between the row's text and the star ---------------------------

test("test_the_badge_renders_after_the_rows_own_text", async () => {
  const out = await simplifiedField();
  const row = rowIncluding(out, U_FULL);
  assert.equal(onlyBadgeIn(out, row).start > visibleTextAt(out, row, "U One"), true);
});

test("test_the_badge_precedes_the_favorite_star_in_document_order", async () => {
  const out = await simplifiedField();
  const row = rowIncluding(out, U_FULL);
  assert.equal(onlyBadgeIn(out, row).start < starOf(out, row).start, true);
});

// --- Standard style: raw names, badges too ------------------------------------
// The fixture's classes are fully known — enum arg bits and overlay facts both
// served — and each apodizing row carries the same badge Simplified would give
// it, after its raw name; a row of neither class stays badge-free.

test("test_standard_style_badges_a_full_apodizing_row", async () => {
  const out = await standardField();
  assert.equal(badgesIn(out, rowIncluding(out, STD_FULL)).length, 1);
});

// Which of the two badges a row wears is told by the glyph it draws, so the
// half-apodizing row's badge is matched against the half row of the Simplified
// fixture — a component that drew the full glyph on a half row fails here.
test("test_standard_style_draws_the_same_half_badge_glyph_as_simplified", async () => {
  const std = await standardField();
  const stdPath = pathData(glyphPathOf(onlyBadgeIn(std, rowIncluding(std, STD_HALF))));
  const sim = await simplifiedField();
  assert.equal(stdPath, pathData(glyphPathOf(onlyBadgeIn(sim, rowIncluding(sim, MH_HALF)))));
});

test("test_standard_style_leaves_a_row_of_neither_class_badge_free", async () => {
  const out = await standardField();
  assert.equal(badgesIn(out, rowIncluding(out, STD_NONE)).length, 0);
});

test("test_standard_style_renders_the_badge_after_the_rows_raw_name", async () => {
  const out = await standardField();
  const row = rowIncluding(out, STD_FULL);
  assert.equal(onlyBadgeIn(out, row).start > visibleTextAt(out, row, "full-a"), true);
});

test("test_standard_style_keeps_every_option_as_a_flat_row", async () => {
  const out = await standardField();
  assert.deepEqual(
    rows(out).map((r) => attr(r, "data-v")),
    [STD_FULL, STD_HALF, STD_NONE],
  );
});

test("test_standard_style_draws_the_same_full_badge_glyph_as_simplified", async () => {
  const std = await standardField();
  const stdPath = pathData(glyphPathOf(onlyBadgeIn(std, rowIncluding(std, STD_FULL))));
  const sim = await simplifiedField();
  assert.equal(stdPath, pathData(glyphPathOf(onlyBadgeIn(sim, rowIncluding(sim, U_FULL)))));
});

test("test_standard_style_badge_precedes_the_favorite_star_in_document_order", async () => {
  const out = await standardField();
  const row = rowIncluding(out, STD_FULL);
  assert.equal(onlyBadgeIn(out, row).start < starOf(out, row).start, true);
});

// --- non-filter comboboxes carry no badge, in either style -----------------------
// The entries' apodizing class fully served (overlay fact plus the Simplified
// entry's apod), so a badge's absence is the dropdown-type rule at work:
// dither and modulator dropdowns never badge, whatever class their entries
// carry — with the pref on and with it off.

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
    meta: META_SIM_APOD_NONFILTER,
  });
  plainNames.value = true;
  const out = field("pcm_dither");
  assertRowReads(out, "Ninth"); // Simplified-distinct leaf: the rows rendered IN SIMPLIFIED STYLE
  assert.equal(badges(out).length, 0);
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
    meta: META_SIM_APOD_NONFILTER,
  });
  plainNames.value = true;
  const out = field("sdm_modulator");
  assertRowReads(out, "Seventh"); // throws when the rows never rendered
  assert.equal(badges(out).length, 0);
});

test("test_a_dither_dropdown_renders_no_badge_in_standard_style", async () => {
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
    meta: META_SIM_APOD_NONFILTER,
  });
  plainNames.value = false;
  const out = field("pcm_dither");
  assertRowReads(out, "NS9"); // raw engine name: the rows rendered IN STANDARD STYLE
  assert.equal(badges(out).length, 0);
});

test("test_a_modulator_dropdown_renders_no_badge_in_standard_style", async () => {
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
    meta: META_SIM_APOD_NONFILTER,
  });
  plainNames.value = false;
  const out = field("sdm_modulator");
  assertRowReads(out, "ASDM7EC"); // raw engine name: the rows rendered IN STANDARD STYLE
  assert.equal(badges(out).length, 0);
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
    [rowIncluding(out, U_FULL), rowIncluding(out, U_FULL_2)].map((r) => badgesIn(out, r).length),
    [1, 1],
  );
});

test("test_a_uniform_variants_rows_each_carry_their_own_badge", async () => {
  const out = await simplifiedField();
  assert.deepEqual(
    [rowIncluding(out, MF_1), rowIncluding(out, MF_2)].map((r) => badgesIn(out, r).length),
    [1, 1],
  );
});

test("test_a_mixed_variant_badges_each_apodizing_row_individually", async () => {
  const out = await simplifiedField();
  assert.deepEqual(
    [rowIncluding(out, MM_1), rowIncluding(out, MM_NONE)].map((r) => badgesIn(out, r).length),
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
