// Behavioral suite for a FLAT plain-names section — one whose entries carry a
// `leaf` and a `short` and no `family` at all, and whose section object carries
// no `families` blurb map (spec plain-dsd: the `sdm_conversion` overlay). The
// three exported store answers are the subject:
//
//   decorateOptions(options, kind): a family-less entry decorates its option
//   with `display` = the entry's leaf and `closedLabel` = its short, and adds
//   NO grouping keys at all — nothing for a header row, a subheader row or
//   either blurb caption to be built from, which is how a flat section renders
//   as a plain list rather than as one nameless group.
//
//   Order: the decorated options come back in the OVERLAY's own key order (the
//   section's key order is its display order, tests/api/test_metadata_plain_names.py),
//   and an option the overlay does not know sorts after every known one,
//   keeping its own input order — the same tail rule the grouped sections
//   follow (tests/js/components/combobox-plainnames.test.js).
//
//   plainClosedLabel(kind, label): the entry's short while the Simplified
//   option style is on, the raw engine label while it is Standard.
//
// The overlay rides the /api/metadata payload (`plain_names`), seeded through
// the field harness's reset() the way the other plain-names suites drive it;
// the pref is the exported signal. Ordering is asserted on option VALUES, wire
// identifiers rather than wording (docs/testing.md rule 9), and no display
// string beyond the fixture's own invented leaves and shorts is asserted.
//
// The module is imported under a BUILT specifier so a checkout that predates
// the change fails per-case rather than at module link — the convention
// tests/js/store/plainnames-truename.test.js settled.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/plainnames-flat.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { reset, META } from "../support/field-harness.js";
import { plainNames } from "../../../hqptuner/static/store/prefs.js";

const MOD = new URL("../../../hqptuner/static/store/plainnames.js", import.meta.url).href;
const plainnames = await import(`${MOD}`);

// The engine's own SDM-SDM conversion enumeration (wide / narrow / XFi, as the
// daemon's config form serves it — tests/support/fixtures/config-form-6.0.4.html),
// annotated flat: leaf and short only, no `family` key and no `families` map on
// the section. Key order deliberately disagrees with both the input order below
// and alphabetical order, so only the overlay's own order can pass. Leaf and
// short wording is invented test data; the shipped wording is owner-owned and
// no test asserts it.
const ENTRIES = {
  XFi: { leaf: "Crossfeed blend", short: "Crossfeed" },
  wide: { leaf: "Wide window", short: "Wide" },
  narrow: { leaf: "Narrow window", short: "Narrow" },
};

const META_FLAT = {
  ...META,
  plain_names: {
    filters: { entries: {}, families: {}, variants: {} },
    dithers: { entries: {}, families: {}, variants: {} },
    modulators: { entries: {}, families: {}, variants: {} },
    sdm_conversion: { entries: ENTRIES },
  },
};

// Input order interleaves the known names with two the overlay does not know,
// so both the overlay ordering and the unknown tail are observable against it.
const OPTIONS = [
  { value: "1", label: "narrow" },
  { value: "9", label: "unknown-b" },
  { value: "0", label: "wide" },
  { value: "8", label: "unknown-a" },
  { value: "2", label: "XFi" },
];

const GROUPING_KEYS = ["group", "subgroup", "groupBlurb", "subgroupBlurb"];

/**
 * Seed the overlay and the pref, then decorate the flat section's options.
 *
 * @param {{ plain?: boolean }} [state]
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function decorated({ plain = true } = {}) {
  await reset({ meta: META_FLAT });
  plainNames.value = plain;
  return plainnames.decorateOptions(OPTIONS, "sdm_conversion");
}

/**
 * One decorated option, found by the raw engine label it was built from.
 * Throws when the decoration dropped it, so a missing option fails loudly
 * instead of comparing against nothing.
 *
 * @param {Record<string, unknown>[]} options
 * @param {string} label
 * @returns {Record<string, unknown>}
 */
function byLabel(options, label) {
  const hit = options.find((o) => o.label === label);
  if (!hit) throw new Error(`no decorated option carries the raw label "${label}"`);
  return hit;
}

// --- one family-less entry's decoration ---------------------------------------

test("test_a_family_less_entry_decorates_its_option_display_with_the_leaf", async () => {
  assert.equal(byLabel(await decorated(), "wide").display, "Wide window");
});

test("test_a_family_less_entry_decorates_its_option_closed_label_with_the_short", async () => {
  assert.equal(byLabel(await decorated(), "wide").closedLabel, "Wide");
});

test("test_a_family_less_entry_adds_no_grouping_key_to_its_option", async () => {
  const option = byLabel(await decorated(), "wide");
  assert.deepEqual(
    GROUPING_KEYS.filter((key) => key in option),
    [],
  );
});

// --- order ---------------------------------------------------------------------

test("test_a_flat_sections_known_options_come_back_in_the_overlays_key_order", async () => {
  const known = (await decorated()).filter((o) => typeof o.label === "string" && o.label in ENTRIES);
  assert.deepEqual(
    known.map((o) => o.value),
    ["2", "0", "1"],
  );
});

test("test_options_the_flat_overlay_does_not_know_come_last_in_input_order", async () => {
  assert.deepEqual(
    (await decorated()).slice(-2).map((o) => o.value),
    ["9", "8"],
  );
});

// --- the closed control ---------------------------------------------------------

test("test_plain_closed_label_reads_a_family_less_entrys_short_when_simplified", async () => {
  await reset({ meta: META_FLAT });
  plainNames.value = true;
  assert.equal(plainnames.plainClosedLabel("sdm_conversion", "XFi"), "Crossfeed");
});

test("test_plain_closed_label_reads_the_raw_label_when_standard", async () => {
  await reset({ meta: META_FLAT });
  plainNames.value = false;
  assert.equal(plainnames.plainClosedLabel("sdm_conversion", "XFi"), "XFi");
});
