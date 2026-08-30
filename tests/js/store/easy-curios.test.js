// Behavioral suite for the two curio presets in Easy Mode's table
// (store/easy.js): `full-analog`, which stages the IIR2 filter, and
// `textbook`, whose `emphasis` knob picks between the three classic FIR
// names. Same pure pair as tests/js/store/easy.test.js — `writeSet` and
// `matchPreset`, plain calls, nothing stubbed, no fake (docs/testing.md
// rule 4 has nothing to bite on where there is no wire).
//
// What the assertions are anchored on (rule 5, rule 9):
//
//   * The four SCHEMA KEYS `pcm_filter_1x`, `pcm_filter_nx`, `sdm_filter_1x`,
//     `sdm_filter_nx` (store/schema.js) — contract, not copy.
//   * Filter NAMES, never enum ids (docs/architecture.md §2). The engine
//     enumerates IIR2, FIR, asymFIR and minphaseFIR identically on both
//     chains, and no `-2s` two-stage variant exists for any of them
//     (hqplayerd-readme.txt filters table), so under "auto" the SDM keys
//     carry the same plain names the PCM keys do.
//
// Deliberately NOT asserted: table membership, tile ordering, or any word a
// tile shows (rule 9). The reading taken where the spec is silent: a preset
// called with no knob positions round-trips to an empty knob map when it
// defines no knobs, and `textbook` with no `emphasis` falls to `balanced`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy-curios.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { writeSet, matchPreset } from "../../../hqptuner/static/store/easy.js";

const PCM_1X = "pcm_filter_1x";
const PCM_NX = "pcm_filter_nx";
const SDM_1X = "sdm_filter_1x";
const SDM_NX = "sdm_filter_nx";

/** The PCM pair, both keys carrying one name. */
function pcmBoth(/** @type {string} */ name) {
  return { [PCM_1X]: name, [PCM_NX]: name };
}

/** The SDM pair, both keys carrying one name. */
function sdmBoth(/** @type {string} */ name) {
  return { [SDM_1X]: name, [SDM_NX]: name };
}

// --- behavior 1: full-analog writes IIR2 to both ends of each covered chain --------------

test("test_full_analog_on_pcm_writes_iir2_to_both_ends_of_the_chain", () => {
  assert.deepEqual(writeSet("full-analog", "pcm"), pcmBoth("IIR2"));
});

test("test_full_analog_on_sdm_writes_iir2_to_both_ends_of_the_chain", () => {
  assert.deepEqual(writeSet("full-analog", "sdm"), sdmBoth("IIR2"));
});

test("test_full_analog_on_auto_writes_iir2_to_all_four_filter_fields", () => {
  assert.deepEqual(writeSet("full-analog", "auto"), {
    ...pcmBoth("IIR2"),
    ...sdmBoth("IIR2"),
  });
});

// --- behavior 2: textbook's emphasis knob picks one classic FIR name ---------------------
//
// Every row NAMES the position it reads at; what each case pins is the name
// that position writes to both ends of the chain.

/** @type {[string, string][]} */
const EMPHASIS_CASES = [
  ["space", "FIR"],
  ["balanced", "asymFIR"],
  ["transients", "minphaseFIR"],
];

for (const [emphasis, name] of EMPHASIS_CASES) {
  test(`test_textbook_with_emphasis_on_${emphasis}_writes_${name}_to_both_ends_of_the_chain`, () => {
    assert.deepEqual(writeSet("textbook", "pcm", { emphasis }), pcmBoth(name));
  });
}

test("test_textbook_called_with_no_knob_positions_falls_to_the_balanced_filter", () => {
  assert.deepEqual(writeSet("textbook", "pcm"), pcmBoth("asymFIR"));
});

test("test_textbook_given_a_nonexistent_emphasis_falls_to_the_balanced_filter", () => {
  assert.deepEqual(writeSet("textbook", "pcm", { emphasis: "loudness" }), pcmBoth("asymFIR"));
});

// The control against a module that appends -2s to every SDM value: none of
// these names has a two-stage variant, so an "auto" call carries the same
// plain name on both chains.

test("test_textbook_on_auto_writes_the_same_plain_name_to_both_chains", () => {
  assert.deepEqual(writeSet("textbook", "auto", { emphasis: "transients" }), {
    ...pcmBoth("minphaseFIR"),
    ...sdmBoth("minphaseFIR"),
  });
});

// --- behavior 3: matchPreset recovers the preset and knobs that wrote the values ---------
//
// Round trips, so the values fed to `matchPreset` are exactly what `writeSet`
// produced — the two are one contract read in both directions. Each textbook
// case passes its one knob explicitly, so the expected knob map is
// unambiguous; `full-analog` carries none, so its map is empty.

/** @type {[string, ("pcm" | "sdm" | "auto")][]} */
const FULL_ANALOG_MODES = [
  ["pcm", "pcm"],
  ["auto", "auto"],
];

for (const [label, mode] of FULL_ANALOG_MODES) {
  test(`test_matchpreset_recovers_full_analog_from_the_values_it_wrote_on_${label}`, () => {
    assert.deepEqual(matchPreset(writeSet("full-analog", mode), mode), {
      presetId: "full-analog",
      knobs: {},
    });
  });
}

/** @type {[string, ("pcm" | "sdm" | "auto"), string][]} */
const TEXTBOOK_MATCH_CASES = [
  ["pcm", "pcm", "space"],
  ["sdm", "sdm", "transients"],
  ["auto", "auto", "balanced"],
];

for (const [label, mode, emphasis] of TEXTBOOK_MATCH_CASES) {
  test(`test_matchpreset_recovers_textbook_with_its_emphasis_on_${label}`, () => {
    assert.deepEqual(matchPreset(writeSet("textbook", mode, { emphasis }), mode), {
      presetId: "textbook",
      knobs: { emphasis },
    });
  });
}
