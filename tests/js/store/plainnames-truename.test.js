// Behavioral suite for plainTrueName(kind, label) — the store's answer to
// "what raw engine name sits behind this row?" while the Simplified option
// style is on (spec plain-desc-truename): the label comes back VERBATIM when
// the pref is Simplified and the plain-names overlay knows it, and the empty
// string comes back when the pref is Standard or the overlay does not know the
// label. `kind` is the overlay's own key, "filters" | "dithers" | "modulators",
// same as decorateOptions/plainClosedLabel.
//
// The overlay rides the /api/metadata payload (`plain_names`), seeded through
// the field harness's reset() the way the combobox plain-names suite drives it;
// the pref is the exported signal. The module is imported under a BUILT
// specifier so a checkout that predates the export fails per-case (not a
// function) rather than at module link — same reason the plain-names suite
// builds its fresh-instance specifiers.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/plainnames-truename.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { reset, META } from "../support/field-harness.js";
import { plainNames } from "../../../hqptuner/static/store/prefs.js";

const MOD = new URL("../../../hqptuner/static/store/plainnames.js", import.meta.url).href;
const plainnames = await import(`${MOD}`);

const META_PLAIN = {
  ...META,
  plain_names: {
    filters: { "sinc-M": { family: "Sinc", variant: null, leaf: "Classic M", short: "Sinc M" } },
    dithers: { TPDF: { family: "Dither", variant: null, leaf: "Triangular", short: "TPDF plain" } },
    modulators: { ASDM7: { family: "ASDM", variant: null, leaf: "Seventh", short: "ASDM 7" } },
  },
};

/**
 * Seed the overlay and the pref, then resolve one label's true name.
 *
 * @param {"filters" | "dithers" | "modulators"} kind
 * @param {string} label
 * @param {{ plain?: boolean }} [state]
 * @returns {Promise<string>}
 */
async function trueName(kind, label, { plain = true } = {}) {
  await reset({ meta: META_PLAIN });
  plainNames.value = plain;
  return plainnames.plainTrueName(kind, label);
}

test("test_plain_true_name_returns_a_known_filter_label_verbatim_when_simplified", async () => {
  assert.equal(await trueName("filters", "sinc-M"), "sinc-M");
});

test("test_plain_true_name_returns_a_known_dither_label_verbatim_when_simplified", async () => {
  assert.equal(await trueName("dithers", "TPDF"), "TPDF");
});

test("test_plain_true_name_returns_a_known_modulator_label_verbatim_when_simplified", async () => {
  assert.equal(await trueName("modulators", "ASDM7"), "ASDM7");
});

test("test_plain_true_name_returns_empty_when_the_pref_is_standard", async () => {
  assert.equal(await trueName("filters", "sinc-M", { plain: false }), "");
});

test("test_plain_true_name_returns_empty_for_a_label_the_overlay_does_not_know", async () => {
  assert.equal(await trueName("filters", "poly-sinc-xtr-mp"), "");
});
