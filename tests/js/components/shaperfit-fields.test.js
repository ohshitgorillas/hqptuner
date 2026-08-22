// Behavioral suite for what the Resampling tab does NOT gray: a PCM dither is
// never disabled by the output rate, at any rate, for any dither.
//
// The constraint file records a `min_rate_hz` for several dithers, and every one
// of them is manufacturer wording ("optimized for") about a setting that still
// PLAYS below its floor — so the row stays pickable and the advice is reported
// as an alert instead (store/alerts/shaperfit.js). The hard half of the same file, the
// SDM modulator floors, still grays: a modulator below its floor produces no
// output at all. That case is pinned in field.test.js and combobox.test.js; the
// one case of it here is the SECOND floor, which shows the reason naming the
// floor it was given rather than repeating one constant.
//
// Policy (docs/testing.md): public API only, one assertion per test, driven
// through the exported store signals over a faked wire on the real REST paths.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/shaperfit-fields.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { reset, field, optionByValue } from "../support/field-harness.js";

// One option of a field, found by the WIRE VALUE it carries rather than by the
// words rendered for it (docs/testing.md rule 9).
/** @param {string} out */
const option = (out, /** @type {string} */ value) => {
  const hit = optionByValue(out, value);
  if (!hit) throw new Error(`the field offers no option valued ${value}`);
  return hit;
};

// NS9's floor is 352800 in the constraint overlay; 44100 is three tiers below
// it, and 48000 is the 48k base rate — the lowest either family reaches. NS9 is
// the option valued "1" in the form below; the cases address it by that value.
const NS9 = "1";
const ASDM5 = "1";

/** @param {string} rate */
const DITHER_AT = (rate) => [
  { name: "defaults_samplerate", value: rate },
  {
    name: "dither",
    value: "0",
    options: [
      { value: "0", label: "TPDF" },
      { value: "1", label: "NS9" },
    ],
  },
];

test("test_a_dither_below_its_floor_is_not_disabled", async () => {
  await reset({ fields: DITHER_AT("44100") });
  assert.equal(/\bdisabled\b/.test(option(field("pcm_dither"), NS9).a), false);
});

test("test_a_dither_below_its_floor_reads_back_the_label_the_form_gave_it", async () => {
  // The other half of the same claim: a row that kept a rate reason after the
  // daemon's own label while dropping the attribute still tells the user they
  // may not have it. The label here is the FIXTURE's own — it is fed in through
  // the form above and asserted only to come back unchanged.
  await reset({ fields: DITHER_AT("44100") });
  assert.equal(option(field("pcm_dither"), NS9).label.trim(), "NS9");
});

test("test_a_dither_below_its_floor_is_not_disabled_at_the_48k_base_rate", async () => {
  await reset({ fields: DITHER_AT("48000") });
  assert.equal(/\bdisabled\b/.test(option(field("pcm_dither"), NS9).a), false);
});

test("test_a_rate_grayed_modulator_names_a_second_floor_as_its_own", async () => {
  // ASDM5's floor is 6144000, the DSD128 tier, against a DSD64 rate — a
  // different modulator, floor and rate from field.test.js's pair, so a reason
  // built out of one constant satisfies one of the two and not the other.
  await reset({
    fields: [
      { name: "defaults_bitrate", value: "3072000" },
      {
        name: "modulator",
        value: "0",
        options: [
          { value: "0", label: "ASDM7" },
          { value: "1", label: "ASDM5" },
        ],
      },
    ],
  });
  // The floor itself is DATA — 6144000 Hz from the constraint overlay, read
  // back off the row as the number it is. The sentence carrying it is copy and
  // is not asserted (docs/testing.md rule 9).
  assert.ok(option(field("sdm_modulator"), ASDM5).label.includes("6.144"));
});
