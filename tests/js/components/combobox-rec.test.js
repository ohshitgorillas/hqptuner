// Behavioral suite for the recommended check glyph on the Simplified combobox
// rows, read off the rendered Field the way every combobox suite reads it
// (tests/js/components/combobox-plainnames.test.js). The observable contract:
//
//   A row whose option carries `rec: true` renders a check glyph exposed to
//   assistive tech with the label "Recommended"; a row without the flag renders
//   no such glyph. The open pop renders a footer legend containing the text
//   "✓ = recommended" while at least one listed option carries the flag, and
//   no such legend when none does — Standard mode included, where the overlay
//   never decorates and so nothing carries a flag.
//
// The flag rides the /api/metadata `plain_names` overlay for the section the
// field joins (here `noise_filter`), driven through the field harness's
// metadata fixture; raw option labels are the daemon's own enumeration names
// (tests/support/fixtures/config-form-6.0.4.html). Family, leaf and short
// strings are invented test data — the shipped wording is pinned server-side
// (tests/api/test_metadata_pcm_plain_names.py) — and the legend text is pinned
// because it is the spec's own wording. The glyph is found by its accessible
// label, never by a class the component happens to use (docs/testing.md; same
// discipline as the apodizing badge in combobox-apod.test.js).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/combobox-rec.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { reset, field, META } from "../support/field-harness.js";
import { plainNames } from "../../../hqptuner/static/store/prefs.js";
import { elements, classes, text } from "../support/markup.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// Two flagged entries and one unflagged, so a flagged row, an unflagged row
// and the legend are all observable in one fragment.
const ENTRIES = {
  standard: { family: "Plain fam", variant: null, leaf: "Standard leaf", short: "Std", rec: true },
  wec2: { family: "Corrected fam", variant: null, leaf: "Wec leaf", short: "Wec Two", rec: true },
  sac: { family: "Corrected fam", variant: null, leaf: "Sac leaf", short: "Sac plain" },
};

const META_REC = {
  ...META,
  plain_names: {
    filters: { entries: {}, families: {}, variants: {} },
    dithers: { entries: {}, families: {}, variants: {} },
    modulators: { entries: {}, families: {}, variants: {} },
    noise_filter: { entries: ENTRIES, families: {} },
  },
};

const ALL_OPTIONS = [
  { value: "0", label: "standard" },
  { value: "7", label: "sac" },
  { value: "11", label: "wec2" },
];

// Only the unflagged name: the list carries no recommended option at all.
const UNFLAGGED_OPTIONS = [{ value: "7", label: "sac" }];

const LEGEND = "✓ = recommended";

/**
 * The noise-filter field rendered against the overlay.
 *
 * @param {{ plain?: boolean, options?: { value: string, label: string }[] }} [state]
 * @returns {Promise<string>}
 */
async function noiseField({ plain = true, options = ALL_OPTIONS } = {}) {
  await reset({
    fields: [{ name: "noise_filter", value: options[0].value, options }],
    meta: META_REC,
  });
  plainNames.value = plain;
  return field("noise_filter");
}

/**
 * The option row (dd-opt element) whose text includes `needle`. Throws when no
 * row does, so an absent row fails loudly instead of comparing against nothing.
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

// --- the check glyph on a row ---------------------------------------------------

test("test_a_rec_flagged_row_renders_a_check_glyph_labelled_recommended", async () => {
  assert.equal(/aria-label="Recommended"/.test(rowIncluding(await noiseField(), "Wec leaf").html), true);
});

test("test_a_row_without_the_flag_renders_no_recommended_glyph", async () => {
  assert.equal(/aria-label="Recommended"/.test(rowIncluding(await noiseField(), "Sac leaf").html), false);
});

// --- the footer legend ----------------------------------------------------------

test("test_the_pop_renders_the_legend_when_a_listed_option_is_recommended", async () => {
  assert.equal((await noiseField()).includes(LEGEND), true);
});

test("test_no_legend_renders_when_no_listed_option_is_recommended", async () => {
  assert.equal((await noiseField({ options: UNFLAGGED_OPTIONS })).includes(LEGEND), false);
});

test("test_standard_mode_renders_no_legend", async () => {
  assert.equal((await noiseField({ plain: false })).includes(LEGEND), false);
});
