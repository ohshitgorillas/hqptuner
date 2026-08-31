// Behavioral suite for the two curio presets in Easy Mode's table
// (store/easy.js): `full-analog`, which has no knobs, and `textbook`, whose
// `emphasis` knob picks one of its declared positions. Same pure pair as
// tests/js/store/easy.test.js, `writeSet` and `matchPreset`, plain calls,
// nothing stubbed, no fake (docs/testing.md rule 4 has nothing to bite on
// where there is no wire).
//
// What the assertions are anchored on (rule 5, rule 9):
//
//   * The four SCHEMA KEYS `pcm_filter_1x`, `pcm_filter_nx`, `sdm_filter_1x`,
//     `sdm_filter_nx` (store/schema.js) — contract, not copy.
//   * RELATIONS between values, never the filter names themselves: which
//     name a preset stages is owner data (rule 9). Neither preset declares a
//     `-2s` two-stage variant, so under "auto" the SDM keys carry exactly
//     the values the PCM keys do.
//
// Deliberately NOT asserted: table membership, tile ordering, filter names,
// or any word a tile shows (rule 9). The reading taken where the spec is
// silent: a preset called with no knob positions round-trips to an empty
// knob map when it defines no knobs, and `textbook` with no `emphasis` (or
// one not in `options`) writes what the knob's declared `default` writes.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy-curios.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { writeSet, matchPreset, presetsFor } from "../../../hqptuner/static/store/easy.js";

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

// --- behavior 1: full-analog writes one name to both ends of each covered chain ----------
//
// The expected shape is built from the call's own 1x value, so no filter
// name appears here; what is pinned is that both ends carry that one value.

test("test_full_analog_on_pcm_writes_one_name_to_both_ends_of_the_chain", () => {
  const written = writeSet("full-analog", "pcm");
  assert.deepEqual(written, pcmBoth(written[PCM_1X]));
});

test("test_full_analog_on_sdm_writes_one_name_to_both_ends_of_the_chain", () => {
  const written = writeSet("full-analog", "sdm");
  assert.deepEqual(written, sdmBoth(written[SDM_1X]));
});

test("test_full_analog_on_auto_writes_one_name_to_all_four_filter_fields", () => {
  const written = writeSet("full-analog", "auto");
  assert.deepEqual(written, {
    ...pcmBoth(written[PCM_1X]),
    ...sdmBoth(written[PCM_1X]),
  });
});

// --- behavior 2: textbook's emphasis knob picks one name per position --------------------
//
// Every row NAMES the position it reads at; what each case pins is that the
// position writes one value to both ends of the chain. The sweep runs on
// each covered chain. Which name a position stages is owner data (rule 9),
// so the positions are pinned as pairwise distinct, never by name. The roster
// itself is read off `presetsFor()`, the table's own declaration, so the
// sweep holds whichever positions the owner declares; one guard pins that
// the declared list is not empty, since an empty roster would generate no
// cases and the sweep would pass vacuously.

/**
 * The `emphasis` knob's declared positions, from the shipped table.
 * @returns {string[]}
 */
function textbookEmphasisOptions() {
  const preset = presetsFor().find((/** @type {{ id: string }} */ p) => p.id === "textbook");
  const knob = preset?.knobs.find((/** @type {{ id: string }} */ k) => k.id === "emphasis");
  if (knob === undefined) throw new Error("textbook declares no emphasis knob");
  return knob.options;
}

const EMPHASIS_POSITIONS = textbookEmphasisOptions();

test("test_textbook_declares_at_least_one_emphasis_position", () => {
  assert.ok(EMPHASIS_POSITIONS.length > 0);
});

for (const emphasis of EMPHASIS_POSITIONS) {
  test(`test_textbook_with_emphasis_on_${emphasis}_writes_one_name_to_both_ends_of_the_pcm_chain`, () => {
    const written = writeSet("textbook", "pcm", { emphasis });
    assert.deepEqual(written, pcmBoth(written[PCM_1X]));
  });
}

for (const emphasis of EMPHASIS_POSITIONS) {
  test(`test_textbook_with_emphasis_on_${emphasis}_writes_one_name_to_both_ends_of_the_sdm_chain`, () => {
    const written = writeSet("textbook", "sdm", { emphasis });
    assert.deepEqual(written, sdmBoth(written[SDM_1X]));
  });
}

test("test_textbook_emphasis_positions_each_write_a_distinct_pcm_name", () => {
  const names = EMPHASIS_POSITIONS.map((emphasis) => writeSet("textbook", "pcm", { emphasis })[PCM_1X]);
  assert.equal(new Set(names).size, EMPHASIS_POSITIONS.length);
});

// --- behavior 3: no position, or one not in `options`, writes the knob's default ---------
//
// The default is read off `presetsFor()`, the table's own declaration, so
// the test holds whichever position the owner declares.

/**
 * The `emphasis` knob's declared default, from the shipped table.
 * @returns {string}
 */
function textbookDefaultEmphasis() {
  const preset = presetsFor().find((/** @type {{ id: string }} */ p) => p.id === "textbook");
  const knob = preset?.knobs.find((/** @type {{ id: string }} */ k) => k.id === "emphasis");
  if (knob === undefined) throw new Error("textbook declares no emphasis knob");
  return knob.default;
}

test("test_textbook_called_with_no_knob_positions_writes_what_the_default_position_writes", () => {
  assert.deepEqual(writeSet("textbook", "pcm"), writeSet("textbook", "pcm", { emphasis: textbookDefaultEmphasis() }));
});

test("test_textbook_given_a_nonexistent_emphasis_writes_what_the_default_position_writes", () => {
  assert.deepEqual(
    writeSet("textbook", "pcm", { emphasis: "loudness" }),
    writeSet("textbook", "pcm", { emphasis: textbookDefaultEmphasis() }),
  );
});

// --- behavior 4: under auto the SDM keys carry exactly the PCM values --------------------
//
// The control against a module that appends -2s to every SDM value: textbook
// declares no two-stage variant, so an "auto" call carries the same value on
// both chains.

test("test_textbook_on_auto_writes_the_pcm_values_to_the_sdm_keys", () => {
  const written = writeSet("textbook", "auto", { emphasis: "transients" });
  assert.deepEqual(
    { [SDM_1X]: written[SDM_1X], [SDM_NX]: written[SDM_NX] },
    { [SDM_1X]: written[PCM_1X], [SDM_NX]: written[PCM_NX] },
  );
});

// --- behavior 5: matchPreset recovers the preset and knobs that wrote the values ---------
//
// Round trips, so the values fed to `matchPreset` are exactly what `writeSet`
// produced — the two are one contract read in both directions. Each textbook
// case passes its one knob explicitly, so the expected knob map is
// unambiguous; `full-analog` carries none, so its map is empty.

/** @type {[string, ("pcm" | "sdm" | "auto")][]} */
const FULL_ANALOG_MODES = [
  ["pcm", "pcm"],
  ["sdm", "sdm"],
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
