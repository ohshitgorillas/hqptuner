// Behavioral suite for the recommendation flag on the plain-names store answer,
// plus the schema catalog rows of the two DSD-source PCM dropdowns.
//
//   decorateOptions(options, kind): with the Simplified pref ON, an option
//   whose overlay entry carries `rec: true` comes back decorated `rec: true`,
//   while an option whose entry carries no `rec` gains no `rec` key at all —
//   the flag is per-entry data, never a default. With the pref OFF (Standard)
//   the return value is the input array untouched, so nothing carries a flag.
//
//   schema: the `noise_filter` row is labelled "Noise filter" and joins the
//   `noise_filter` plain-names section; the `pcm_conversion` row is labelled
//   "Decimation filter", sublabelled "SDM → PCM conversion", and joins the
//   `pcm_conversion` plain-names section. The labels are pinned because they
//   are the spec's own wording for these two rows.
//
// The overlay rides the /api/metadata payload (`plain_names`), seeded through
// the field harness's reset() the way the other plain-names suites drive it;
// the pref is the exported signal. Raw option labels are the daemon's own
// enumeration names (tests/support/fixtures/config-form-6.0.4.html), wire
// identifiers rather than wording; family, leaf and short strings are invented
// test data — the shipped wording is pinned server-side
// (tests/api/test_metadata_pcm_plain_names.py).
//
// The module is imported under a BUILT specifier so a checkout that predates
// the change fails per-case rather than at module link — the convention
// tests/js/store/plainnames-truename.test.js settled.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/plainnames-rec.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { reset, META } from "../support/field-harness.js";
import { plainNames } from "../../../hqptuner/static/store/prefs.js";
import { schema } from "../../../hqptuner/static/store/schema.js";

const MOD = new URL("../../../hqptuner/static/store/plainnames.js", import.meta.url).href;
const plainnames = await import(`${MOD}`);

// Three of the noise-filter enumeration's raw names, two flagged recommended
// and one not, so both decorations are observable in one pass.
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

const OPTIONS = [
  { value: "0", label: "standard" },
  { value: "7", label: "sac" },
  { value: "11", label: "wec2" },
];

/**
 * Seed the overlay and the pref, then decorate the noise-filter options.
 *
 * @param {{ plain?: boolean }} [state]
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function decorated({ plain = true } = {}) {
  await reset({ meta: META_REC });
  plainNames.value = plain;
  return plainnames.decorateOptions(OPTIONS, "noise_filter");
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

// --- the flag on the decorated options ----------------------------------------

test("test_a_rec_flagged_entry_decorates_its_option_with_rec_true", async () => {
  assert.equal(byLabel(await decorated(), "wec2").rec, true);
});

test("test_an_entry_without_rec_adds_no_rec_key_to_its_option", async () => {
  assert.equal("rec" in byLabel(await decorated(), "sac"), false);
});

test("test_pref_off_returns_the_input_options_untouched", async () => {
  assert.deepEqual(await decorated({ plain: false }), OPTIONS);
});

// --- the schema rows ------------------------------------------------------------

test("test_schema_noise_filter_is_labelled_noise_filter", () => {
  assert.equal(schema.noise_filter.label, "Noise filter");
});

test("test_schema_noise_filter_joins_the_noise_filter_plain_names_section", () => {
  assert.equal(schema.noise_filter.plainNames, "noise_filter");
});

test("test_schema_pcm_conversion_is_labelled_decimation_filter", () => {
  assert.equal(schema.pcm_conversion.label, "Decimation filter");
});

test("test_schema_pcm_conversion_is_sublabelled_sdm_to_pcm_conversion", () => {
  assert.equal(schema.pcm_conversion.sublabel, "SDM → PCM conversion");
});

test("test_schema_pcm_conversion_joins_the_pcm_conversion_plain_names_section", () => {
  assert.equal(schema.pcm_conversion.plainNames, "pcm_conversion");
});
