// Behavioral suite for the custom combobox a Field renders in place of a
// native <select> when its schema entry carries `desc` (widget "dropdown").
//
// SSR reaches the CLOSED state only: the popup opens from a pointer/keyboard
// handler, so the open state — and the per-option tip elements that exist only
// while open — cannot be rendered here (docs/testing.md "Branches that cannot
// be reached"). That gap is deliberate; open-state behavior belongs to the
// browser hand-back protocol, not this suite.
//
// Closed-state contract pinned here: button class "dd-box" role="combobox"
// aria-expanded="false"; sibling list class "dd-pop" role="listbox" carrying
// `hidden`; one row class "dd-opt" per option, text = option label, grayed rows
// aria-disabled="true" with the reason appended " — <reason>". A dropdown whose
// entry has no `desc` keeps its native <select>.

import test from "node:test";
import assert from "node:assert/strict";

import { reset, field, controlRow, attrOf } from "../support/field-harness.js";
import { nApod1x, nQuality } from "../../../hqptuner/static/store/narrow/state.js";

// Opening tag of the first element in `out` whose attributes match `needle`.
/**
 * @param {string | null} out
 * @param {string} needle
 * @returns {string | null}
 */
const openTag = (out, needle) => {
  const m = new RegExp(`<[a-zA-Z][^>]*${needle}[^>]*>`).exec(out || "");
  return m ? m[0] : null;
};

// The dd-opt rows of a rendered field: full opening tag + tag-stripped text.
// The favorite-star button is an affordance riding in the row, not part of its
// label — drop it whole (tag AND glyph) before stripping the remaining tags.
// Asking one pattern for "a tag whose attributes contain this class somewhere"
// makes the engine re-split the attribute run at every offset, so the opening
// tag is matched first and its class attribute tested separately. Same reason
// the favourite-star button is matched whole and then checked for dd-fav.
/** @param {string} tag */
const classOf = (tag) => (/\bclass="([^"]*)"/.exec(tag) || [])[1] || "";

/** @param {string} s */
const withoutFavButton = (s) =>
  s.replace(/<button\b[^<>]*>[\s\S]*?<\/button>/g, (/** @type {string} */ b) =>
    /\bdd-fav\b/.test(b.slice(0, b.indexOf(">"))) ? "" : b,
  );

// The rate-tier badge is a row marking like the star, not label text, and it
// carries its own words ("1024+") rather than only markup — so it is removed
// WHOLE, the way the star is, instead of being left behind by a tag strip.
/** @param {string} s */
const withoutTierBadge = (s) =>
  s.replace(/<span\b[^<>]*>[\s\S]*?<\/span>/g, (/** @type {string} */ t) =>
    /\bdd-tier\b/.test(t.slice(0, t.indexOf(">"))) ? "" : t,
  );

/** @param {string} out */
function optRows(out) {
  const src = out || "";
  const openers = /<(\w+)\b([^<>]*)>/g;
  const rows = [];
  let open;
  while ((open = openers.exec(src)) !== null) {
    if (!/\bdd-opt\b/.test(classOf(open[0]))) continue;
    const rest = src.slice(open.index + open[0].length);
    const close = new RegExp(`</${open[1]}>`).exec(rest);
    const inner = close ? rest.slice(0, close.index) : rest;
    rows.push({
      tag: open[0],
      text: withoutTierBadge(withoutFavButton(inner))
        .replace(/<[^<>]*>/g, "")
        .trim(),
    });
  }
  return rows;
}

const FILTER_FIELDS = [
  {
    name: "filter1x",
    value: "0",
    options: [
      { value: "0", label: "sinc-M" },
      { value: "1", label: "poly-sinc-xtr-mp" },
    ],
  },
];

// A DSD512 rate leaves ASDM7EC below its 40.96 MHz floor, so its row is
// rate-grayed (same wire setup as field.test.js's rate-gray cases). The
// modulator is what these two cases need: a modulator below its floor stops the
// engine producing output and stays grayed, where a PCM dither below its floor
// still plays and no longer grays at all.
const GRAYED_MODULATOR_FIELDS = [
  { name: "defaults_bitrate", value: "24576000" },
  {
    name: "modulator",
    value: "0",
    options: [
      { value: "0", label: "ASDM7" },
      { value: "1", label: "ASDM7EC" },
    ],
  },
];

test("test_a_desc_dropdowns_control_row_contains_a_combobox", async () => {
  await reset({ fields: FILTER_FIELDS });
  assert.notEqual(openTag(controlRow(field("pcm_filter_1x")), 'role="combobox"'), null);
});

test("test_a_desc_dropdowns_control_row_contains_no_native_select", async () => {
  await reset({ fields: FILTER_FIELDS });
  assert.equal(/<select\b/.test(controlRow(field("pcm_filter_1x")) || ""), false);
});

test("test_a_closed_combobox_reports_aria_expanded_false", async () => {
  await reset({ fields: FILTER_FIELDS });
  assert.equal(attrOf(openTag(field("pcm_filter_1x"), 'role="combobox"') || "", "aria-expanded"), "false");
});

test("test_the_option_list_is_a_listbox", async () => {
  await reset({ fields: FILTER_FIELDS });
  assert.equal(attrOf(openTag(field("pcm_filter_1x"), 'class="[^"]*\\bdd-pop\\b[^"]*"') || "", "role"), "listbox");
});

test("test_the_option_list_is_hidden_while_closed", async () => {
  await reset({ fields: FILTER_FIELDS });
  // The harness SSR renders boolean attributes bare, so `hidden` must stand as
  // its own attribute — empty the quoted values first so a class token like
  // "dd-pop hidden" cannot satisfy the probe.
  const tag = (openTag(field("pcm_filter_1x"), 'class="[^"]*\\bdd-pop\\b[^"]*"') || "").replace(/"[^"]*"/g, '""');
  assert.equal(/\shidden(?=[\s>])/.test(tag), true);
});

// The 1x stage narrows to apodizing filters by default and to a 3/5 quality
// floor, and narrowing spares no option — not even the selected one. This case
// is about the ROWS, so both facets are opened first and both fixture filters
// stay listed.
test("test_every_option_appears_as_a_row_labeled_by_its_option_label", async () => {
  await reset({ fields: FILTER_FIELDS });
  nApod1x.value = "all";
  nQuality.value = 0;
  assert.deepEqual(
    optRows(field("pcm_filter_1x")).map((r) => r.text),
    ["sinc-M", "poly-sinc-xtr-mp"],
  );
});

test("test_a_grayed_options_row_is_aria_disabled", async () => {
  await reset({ fields: GRAYED_MODULATOR_FIELDS });
  assert.equal(
    attrOf(optRows(field("sdm_modulator")).find((r) => r.text.startsWith("ASDM7EC"))?.tag || "", "aria-disabled"),
    "true",
  );
});

test("test_a_grayed_options_row_names_the_gray_reason_after_the_label", async () => {
  await reset({ fields: GRAYED_MODULATOR_FIELDS });
  assert.equal(
    optRows(field("sdm_modulator")).find((r) => r.text.startsWith("ASDM7EC"))?.text,
    "ASDM7EC — needs ≥ 40.96 MHz",
  );
});

test("test_a_dropdown_without_desc_keeps_its_native_select", async () => {
  await reset({ fields: [{ name: "idle_time", value: "0", options: [{ value: "0", label: "Never" }] }] });
  assert.equal(/<select\b[\s\S]*?<option\b/.test(controlRow(field("idle_time")) || ""), true);
});
