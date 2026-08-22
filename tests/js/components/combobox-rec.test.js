// Behavioral suite for the recommended check glyph on the Simplified combobox
// rows, read off the rendered Field the way every combobox suite reads it
// (tests/js/components/combobox-plainnames.test.js). The observable contract:
//
//   A row whose option carries `rec: true` renders the recommended glyph; a row
//   without the flag renders none. The open pop renders a footer legend while at
//   least one listed option carries the flag, and no legend when none does —
//   Standard mode included, where the overlay never decorates and so nothing
//   carries a flag.
//
// The flag rides the /api/metadata `plain_names` overlay for the section the
// field joins (here `noise_filter`), driven through the field harness's
// metadata fixture; raw option labels are the daemon's own enumeration names
// (tests/support/fixtures/config-form-6.0.4.html). Family, leaf and short
// strings are invented test data — the shipped wording is pinned server-side
// (tests/api/test_metadata_pcm_plain_names.py).
//
// Glyph and legend are found by their CSS class, which is contract, and rows by
// the `data-v` wire value they carry — never by the words either renders
// (docs/testing.md rule 9).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/combobox-rec.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { reset, field, META } from "../support/field-harness.js";
import { plainNames } from "../../../hqptuner/static/store/prefs.js";
import { elements, classes, text } from "../support/markup.js";
import { rowIncluding } from "../support/comborows.js";

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

// Class tokens, not sentences: the glyph's own element and the pop's footer
// legend are each identified by the class they wear.
const REC_GLYPH = "dd-rec";
const LEGEND = "dd-legend";

/**
 * Whether a fragment encloses an element wearing `cls` as a whole class token.
 *
 * @param {string} fragment
 * @param {string} cls
 * @returns {boolean}
 */
const wears = (fragment, cls) => elements(fragment).some((el) => classes(el).includes(cls));

/**
 * The noise-filter field rendered against the overlay.
 *
 * @param {{ plain?: boolean, options?: { value: string, label: string }[], value?: string }} [state]
 * @returns {Promise<string>}
 */
async function noiseField({ plain = true, options = ALL_OPTIONS, value = options[0].value } = {}) {
  await reset({
    fields: [{ name: "noise_filter", value, options }],
    meta: META_REC,
  });
  plainNames.value = plain;
  return field("noise_filter");
}

/**
 * Text a user reads off the closed combobox button (the dd-box element's own
 * content, tags stripped) — same contract combobox-plainnames.test.js pins the
 * closed control with. Throws when there is no closed button, so an absence
 * fails loudly instead of comparing against nothing.
 *
 * @param {string} out
 * @returns {string}
 */
function boxText(out) {
  const box = elements(out).find((el) => classes(el).includes("dd-box"));
  if (!box) throw new Error("no closed combobox button in the rendered output");
  return text(box);
}

// --- the check glyph on a row ---------------------------------------------------

test("test_a_rec_flagged_row_renders_the_recommended_glyph", async () => {
  assert.equal(wears(rowIncluding(await noiseField(), "11").html, REC_GLYPH), true);
});

test("test_a_row_without_the_flag_renders_no_recommended_glyph", async () => {
  assert.equal(wears(rowIncluding(await noiseField(), "7").html, REC_GLYPH), false);
});

// --- the closed control ---------------------------------------------------------

test("test_pref_on_the_closed_control_shows_the_selections_short", async () => {
  assert.equal(boxText(await noiseField({ value: "11" })), "Wec Two");
});

// --- the footer legend ----------------------------------------------------------

test("test_the_pop_renders_the_legend_when_a_listed_option_is_recommended", async () => {
  assert.equal(wears(await noiseField(), LEGEND), true);
});

test("test_no_legend_renders_when_no_listed_option_is_recommended", async () => {
  assert.equal(wears(await noiseField({ options: UNFLAGGED_OPTIONS }), LEGEND), false);
});

test("test_standard_mode_renders_no_legend", async () => {
  assert.equal(wears(await noiseField({ plain: false }), LEGEND), false);
});
