// Behavioral suite for the `plainQuiet` schema flag (spec plain-dsd): a chain
// dropdown whose schema entry carries it stops SPEAKING while the Simplified
// option style is on — no per-option tip prose beside a highlighted row, and no
// per-selection description under the closed control — while everything else
// about it is unchanged. The raw engine name survives the silence, on both
// surfaces, and Standard mode is untouched: the same entry describes its
// options exactly as it always did.
//
// A dropdown whose entry carries `plainNames` but NOT `plainQuiet` is pinned
// alongside, on the same fixture shape, so the flag is shown to be what
// silences the prose rather than the Simplified pref: that entry renders its
// family headers with their `families` blurbs, its per-option manual prose and
// the raw engine name all at once.
//
// Subjects are the two SDM-source controls: `sdm_conversion` (flat overlay,
// quiet) and `sdm_integrator` (grouped overlay, not quiet). Raw option labels
// are the daemon's own enumeration for those selects
// (tests/support/fixtures/config-form-6.0.4.html); prose and plain-names
// wording are invented test data, the shipped wording being owner-owned
// (docs/testing.md rule 9). Both controls take their per-option prose from the
// settings.json `options` map keyed by config VALUE, the way the integrator
// already does (tests/js/components/fielddesc.test.js).
//
// The TIP is pinned through the public resolver, tipsFor(entry, meta), rather
// than through markup: the tip mounts only while the pop is open with a
// highlighted option, which SSR of a closed field never reaches
// (docs/testing.md "Branches that cannot be reached") — the same route
// tests/js/components/plaindesc-truename.test.js takes. The per-selection
// description and the family headers are read off the SSR-rendered Field.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/combobox-plainquiet.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { schema } from "../../../hqptuner/static/store/schema.js";
import { reset, field, titleOf, META } from "../support/field-harness.js";
import { plainNames } from "../../../hqptuner/static/store/prefs.js";
import { elements, classes, text } from "../support/markup.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

// tipsFor lives in components/binder.js; the specifier is built rather than
// literal because a checkout that predates the extraction has no such file on
// disk, which `tsc -p jsconfig.json` refuses as a literal (TS2307).
const BINDER = new URL("../../../hqptuner/static/components/binder.js", import.meta.url).href;

// --- fixtures -----------------------------------------------------------------

const CONVERSION_PROSE = "Crossfeed conversion prose.";
const INTEGRATOR_PROSE = "Slow integrator.";
const IIR_BLURB = "Recursive integrators";

const CONVERSION_META = {
  label: "SDM-SDM conversion",
  tooltip: "Conversion prose.",
  options: { 0: "Wide conversion prose.", 1: "Narrow conversion prose.", 2: CONVERSION_PROSE },
};

const META_QUIET = {
  ...META,
  settings: { ...META.settings, dsp: { ...META.settings.dsp, sdm_conversion: CONVERSION_META } },
  plain_names: {
    filters: { entries: {}, families: {}, variants: {} },
    dithers: { entries: {}, families: {}, variants: {} },
    modulators: { entries: {}, families: {}, variants: {} },
    // Flat: leaf and short only, no family on any entry.
    sdm_conversion: {
      entries: {
        wide: { leaf: "Wide window", short: "Wide" },
        narrow: { leaf: "Narrow window", short: "Narrow" },
        XFi: { leaf: "Crossfeed blend", short: "Crossfeed" },
      },
      families: {},
      variants: {},
    },
    // Grouped, with a blurb for the family the IIR options sit in.
    sdm_integrator: {
      entries: {
        IIR: { family: "IIR", variant: null, leaf: "First order", short: "IIR 1" },
        IIR2: { family: "IIR", variant: null, leaf: "Second order", short: "IIR 2" },
        FIR2: { family: "FIR", variant: null, leaf: "Second FIR", short: "FIR 2" },
      },
      families: { IIR: IIR_BLURB },
      variants: {},
    },
  },
};

const CONVERSION_OPTIONS = [
  { value: "0", label: "wide" },
  { value: "1", label: "narrow" },
  { value: "2", label: "XFi" },
];

const INTEGRATOR_OPTIONS = [
  { value: "0", label: "IIR" },
  { value: "3", label: "IIR2" },
  { value: "1", label: "FIR2" },
];

/**
 * The SDM-SDM conversion field with XFi selected — the quiet subject.
 *
 * @param {{ plain?: boolean }} [state]
 * @returns {Promise<string>}
 */
async function quietField({ plain = true } = {}) {
  await reset({
    fields: [{ name: "sdm_conversion", value: "2", options: CONVERSION_OPTIONS }],
    meta: META_QUIET,
  });
  plainNames.value = plain;
  return field("sdm_conversion");
}

/**
 * The integrator field with the FIR2 option selected, under the settings entry
 * whose option prose keys value "1" — the not-quiet subject.
 *
 * @param {{ plain?: boolean }} [state]
 * @returns {Promise<string>}
 */
async function loudField({ plain = true } = {}) {
  await reset({
    fields: [{ name: "integrator", value: "1", options: INTEGRATOR_OPTIONS }],
    meta: META_QUIET,
  });
  plainNames.value = plain;
  return field("sdm_integrator");
}

/**
 * One option's TipContent for a schema entry, under the seeded overlay and
 * pref. Throws (not asserts) when the entry yields no resolver, so the one
 * assertion stays at the call site.
 *
 * @param {{ plain?: boolean }} [state]
 * @returns {Promise<{ name: string, text: string }>}
 */
async function conversionTip({ plain = true } = {}) {
  const { tipsFor } = await import(`${BINDER}`);
  await reset({ meta: META_QUIET });
  plainNames.value = plain;
  const tip = tipsFor(schema.sdm_conversion, CONVERSION_META);
  if (!tip) throw new Error("expected a tip resolver for the SDM-SDM conversion entry");
  return tip({ value: "2", label: "XFi" });
}

// --- markup readers -----------------------------------------------------------

/**
 * The one element of a fragment carrying `cls` as a whole class token. Throws
 * when nothing does, so a missing element fails loudly.
 *
 * @param {string} fragment
 * @param {string} cls
 * @returns {MarkupElement}
 */
function oneByClass(fragment, cls) {
  const hit = elements(fragment).find((el) => classes(el).includes(cls));
  if (!hit) throw new Error(`no element with class "${cls}" in the fragment`);
  return hit;
}

/**
 * The per-selection description a reader sees under the closed control: the
 * text of the `.field-desc` line with the raw-name element removed whole, that
 * being a separate surface (tests/js/components/plaindesc-truename.test.js).
 *
 * @param {string} out
 * @returns {string}
 */
function descriptionText(out) {
  const desc = oneByClass(out, "field-desc");
  const name = elements(desc.html).find((el) => classes(el).includes("field-desc-name"));
  return text({ ...desc, html: name ? desc.html.replace(name.html, " ") : desc.html });
}

/**
 * The smallest element whose whole text reads exactly `wording`. Throws when
 * nothing reads it.
 *
 * @param {string} out
 * @param {string} wording
 * @returns {MarkupElement}
 */
function readingExactly(out, wording) {
  const hits = elements(out).filter((el) => text(el) === wording);
  if (hits.length === 0) throw new Error(`nothing rendered reads exactly "${wording}"`);
  return hits.reduce((a, b) => (a.html.length <= b.html.length ? a : b));
}

// --- simplified: the quiet entry says nothing ---------------------------------

test("test_simplified_a_quiet_entrys_option_tip_carries_no_prose", async () => {
  assert.equal((await conversionTip()).text, "");
});

test("test_simplified_a_quiet_entry_describes_its_selection_with_nothing", async () => {
  assert.equal(descriptionText(await quietField()), "");
});

// --- simplified: the raw engine name survives the silence ----------------------

test("test_simplified_a_quiet_entrys_option_tip_still_names_the_raw_engine_name", async () => {
  assert.equal((await conversionTip()).name, "XFi");
});

test("test_simplified_a_quiet_entry_still_shows_the_raw_engine_name_under_the_control", async () => {
  assert.equal(text(oneByClass(await quietField(), "field-desc-name")), "XFi");
});

// --- standard: the quiet entry speaks exactly as it always did ------------------

test("test_standard_a_quiet_entrys_option_tip_carries_its_prose", async () => {
  assert.equal((await conversionTip({ plain: false })).text, CONVERSION_PROSE);
});

test("test_standard_a_quiet_entry_describes_its_selection", async () => {
  assert.equal(descriptionText(await quietField({ plain: false })), CONVERSION_PROSE);
});

// --- the hover title is the control's own tooltip in both styles ----------------

test("test_simplified_a_quiet_entry_hovers_its_settings_tooltip", async () => {
  assert.equal(titleOf(await quietField()), "Conversion prose.");
});

test("test_standard_a_quiet_entry_hovers_its_settings_tooltip", async () => {
  assert.equal(titleOf(await quietField({ plain: false })), "Conversion prose.");
});

// --- a plain-names entry that is NOT quiet keeps all three surfaces -------------

test("test_simplified_a_not_quiet_entry_renders_its_family_blurb_after_the_family_header", async () => {
  const out = await loudField();
  assert.equal(readingExactly(out, "IIR family").start < readingExactly(out, IIR_BLURB).start, true);
});

test("test_simplified_a_not_quiet_entry_still_describes_its_selection", async () => {
  assert.equal(descriptionText(await loudField()), INTEGRATOR_PROSE);
});

test("test_simplified_a_not_quiet_entry_still_shows_the_raw_engine_name_under_the_control", async () => {
  assert.equal(text(oneByClass(await loudField(), "field-desc-name")), "FIR2");
});
