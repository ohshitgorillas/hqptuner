// Behavioral suite for the `damage-control` preset's two knobs: what each
// combination of `emphasis` and `material` writes to the four filter fields,
// and that those same values read back as that preset at those positions.
//
// The companion file is tests/js/store/easy.test.js, which owns the rest of the
// curated table. Only what this preset adds lives here.
//
// WHAT IS PARTICULAR ABOUT IT. It is the one preset carrying TWO knobs whose
// second knob picks a whole family rather than a filter within one: at
// `material=lossless` the tile writes the xtr-short pair, whose SDM flavor is
// the two-stage `-2s` variant the PCM chain never enumerates; at
// `material=lossy` it writes one name to all four fields, the same name on both
// chains, because no `-2s` variant of it exists. So the two positions are read
// as two different SHAPES of write and not merely as two names.
//
// The lossy filter names carry a slash. That is an ordinary character in a name
// and nothing splits on it: a name is one wire identifier the engine enumerates
// whole (docs/architecture.md §2).
//
// Anchored on schema keys and filter names, both wire identifiers — nothing here
// reads a word of copy (docs/testing.md rule 9).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy-damage-control.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { writeSet, matchPreset } from "../../../hqptuner/static/store/easy.js";

const PCM_1X = "pcm_filter_1x";
const PCM_NX = "pcm_filter_nx";
const SDM_1X = "sdm_filter_1x";
const SDM_NX = "sdm_filter_nx";

const PRESET = "damage-control";

/** @param {string} name */
const pcmBoth = (name) => ({ [PCM_1X]: name, [PCM_NX]: name });

/** @param {string} name */
const sdmBoth = (name) => ({ [SDM_1X]: name, [SDM_NX]: name });

/** @param {string} name */
const allFour = (name) => ({ ...pcmBoth(name), ...sdmBoth(name) });

// ============================================================================
// what each combination of the two knobs writes
// ============================================================================
//
// Read under the "auto" output mode, which writes both chains, so each case is
// the whole four-field answer in one assertion — a preset that got the PCM half
// right and the SDM half wrong fails by naming the fields that differ.
//
// The lossless rows split the chains: the plain name on PCM, the two-stage
// variant on SDM. The lossy rows do not, and that is the claim about them.

/** @type {[string, Record<string, string>, Record<string, string>][]} */
const WRITES = [
  [
    "space_and_lossless_material",
    { emphasis: "space", material: "lossless" },
    { ...pcmBoth("poly-sinc-xtr-short-lp"), ...sdmBoth("poly-sinc-xtr-short-lp-2s") },
  ],
  [
    "transients_and_lossless_material",
    { emphasis: "transients", material: "lossless" },
    { ...pcmBoth("poly-sinc-xtr-short-mp"), ...sdmBoth("poly-sinc-xtr-short-mp-2s") },
  ],
  ["space_and_lossy_material", { emphasis: "space", material: "lossy" }, allFour("poly-sinc-mqa/mp3-lp")],
  ["transients_and_lossy_material", { emphasis: "transients", material: "lossy" }, allFour("poly-sinc-mqa/mp3-mp")],
];

for (const [label, knobs, expected] of WRITES) {
  test(`test_damage_control_on_${label}_writes_those_names_to_the_four_fields`, () => {
    assert.deepEqual(writeSet(PRESET, "auto", knobs), expected);
  });
}

// ============================================================================
// where the material knob rests
// ============================================================================
//
// A call naming the emphasis and leaving the material out answers with the
// lossless pair, so `lossless` is where a fresh tile stands. Read against the
// names outright rather than against a second `writeSet` call, which would only
// ask the module to agree with itself.

test("test_a_damage_control_call_that_names_no_material_writes_the_lossless_pair", () => {
  assert.deepEqual(writeSet(PRESET, "auto", { emphasis: "space" }), {
    ...pcmBoth("poly-sinc-xtr-short-lp"),
    ...sdmBoth("poly-sinc-xtr-short-lp-2s"),
  });
});

// ============================================================================
// and those names read back as this preset at those positions
// ============================================================================
//
// The round trip: the values `writeSet` produced are fed to `matchPreset`, which
// is what lights the tile and puts its two knobs where the fields say they
// stand. Both knobs are named in every row, so the expected map is unambiguous.

for (const [label, knobs] of WRITES) {
  test(`test_matchpreset_recovers_damage_control_on_${label}`, () => {
    assert.deepEqual(matchPreset(writeSet(PRESET, "auto", knobs), "auto"), { presetId: PRESET, knobs });
  });
}

// The lossy names on the PCM chain alone, read in their own right: an output
// mode of "pcm" is the state a PCM-only install is in, and the lossy pair is the
// one write in the table that no `-2s` variant stands behind.

test("test_the_lossy_material_writes_one_name_to_both_ends_of_the_pcm_chain", () => {
  assert.deepEqual(writeSet(PRESET, "pcm", { emphasis: "space", material: "lossy" }), pcmBoth("poly-sinc-mqa/mp3-lp"));
});

test("test_the_lossy_material_writes_the_same_name_to_both_ends_of_the_sdm_chain", () => {
  assert.deepEqual(writeSet(PRESET, "sdm", { emphasis: "space", material: "lossy" }), sdmBoth("poly-sinc-mqa/mp3-lp"));
});
