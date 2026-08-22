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
// `hidden`; one row class "dd-opt" per option, carrying that option's `data-v`
// wire value; grayed rows aria-disabled="true". A dropdown whose entry has no
// `desc` keeps its native <select>.
//
// Rows are addressed by `data-v` and never by the words they render — the words
// are the owner's, the value is contract (docs/testing.md rule 9).

import test from "node:test";
import assert from "node:assert/strict";

import { reset, field, controlRow, attrOf } from "../support/field-harness.js";
import { rows, rowIncluding } from "../support/comborows.js";
import { attr } from "../support/markup.js";
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
test("test_every_option_appears_as_a_row_carrying_its_wire_value", async () => {
  await reset({ fields: FILTER_FIELDS });
  nApod1x.value = "all";
  nQuality.value = 0;
  assert.deepEqual(
    rows(field("pcm_filter_1x")).map((r) => attr(r, "data-v")),
    ["0", "1"],
  );
});

test("test_a_grayed_options_row_is_aria_disabled", async () => {
  await reset({ fields: GRAYED_MODULATOR_FIELDS });
  assert.equal(attr(rowIncluding(field("sdm_modulator"), "1"), "aria-disabled"), "true");
});

test("test_a_dropdown_without_desc_keeps_its_native_select", async () => {
  await reset({ fields: [{ name: "idle_time", value: "0", options: [{ value: "0", label: "Never" }] }] });
  assert.equal(/<select\b[\s\S]*?<option\b/.test(controlRow(field("idle_time")) || ""), true);
});
