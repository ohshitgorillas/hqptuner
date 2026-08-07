// Behavioral suite for the custom combobox a Field renders in place of a
// native <select> when its schema entry carries `desc` (widget "dropdown").
//
// SSR reaches the CLOSED state only: the popup opens from a pointer/keyboard
// handler, so the open state — and the per-option tip elements that exist only
// while open — cannot be rendered here (docs/testing.md "Branches that cannot
// be reached"). That gap is deliberate; open-state behaviour belongs to the
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

// Opening tag of the first element in `out` whose attributes match `needle`.
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
const classOf = (tag) => (/\bclass="([^"]*)"/.exec(tag) || [])[1] || "";

const withoutFavButton = (s) =>
  s.replace(/<button\b[^<>]*>[\s\S]*?<\/button>/g, (b) => (/\bdd-fav\b/.test(b.slice(0, b.indexOf(">"))) ? "" : b));

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
      text: withoutFavButton(inner)
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

// A 44.1k rate leaves NS9 below its 352.8k floor, so its row is rate-grayed
// (same wire setup as field.test.js's rate-gray cases).
const GRAYED_DITHER_FIELDS = [
  { name: "defaults_samplerate", value: "44100" },
  {
    name: "dither",
    value: "0",
    options: [
      { value: "0", label: "TPDF" },
      { value: "1", label: "NS9" },
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
  assert.equal(attrOf(openTag(field("pcm_filter_1x"), 'role="combobox"'), "aria-expanded"), "false");
});

test("test_the_option_list_is_a_listbox", async () => {
  await reset({ fields: FILTER_FIELDS });
  assert.equal(attrOf(openTag(field("pcm_filter_1x"), 'class="[^"]*\\bdd-pop\\b[^"]*"'), "role"), "listbox");
});

test("test_the_option_list_is_hidden_while_closed", async () => {
  await reset({ fields: FILTER_FIELDS });
  // The harness SSR renders boolean attributes bare, so `hidden` must stand as
  // its own attribute — empty the quoted values first so a class token like
  // "dd-pop hidden" cannot satisfy the probe.
  const tag = (openTag(field("pcm_filter_1x"), 'class="[^"]*\\bdd-pop\\b[^"]*"') || "").replace(/"[^"]*"/g, '""');
  assert.equal(/\shidden(?=[\s>])/.test(tag), true);
});

test("test_every_option_appears_as_a_row_labelled_by_its_option_label", async () => {
  await reset({ fields: FILTER_FIELDS });
  assert.deepEqual(
    optRows(field("pcm_filter_1x")).map((r) => r.text),
    ["sinc-M", "poly-sinc-xtr-mp"],
  );
});

test("test_a_grayed_options_row_is_aria_disabled", async () => {
  await reset({ fields: GRAYED_DITHER_FIELDS });
  assert.equal(
    attrOf(optRows(field("pcm_dither")).find((r) => r.text.startsWith("NS9"))?.tag, "aria-disabled"),
    "true",
  );
});

test("test_a_grayed_options_row_names_the_gray_reason_after_the_label", async () => {
  await reset({ fields: GRAYED_DITHER_FIELDS });
  assert.equal(optRows(field("pcm_dither")).find((r) => r.text.startsWith("NS9"))?.text, "NS9 — needs ≥ 352.8 kHz");
});

test("test_a_dropdown_without_desc_keeps_its_native_select", async () => {
  await reset({ fields: [{ name: "idle_time", value: "0", options: [{ value: "0", label: "Never" }] }] });
  assert.equal(/<select\b[\s\S]*?<option\b/.test(controlRow(field("idle_time")) || ""), true);
});
