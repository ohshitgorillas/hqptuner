// Behavioral suite for Easy Mode's curated preset table (store/easy.js): the
// pure pair `writeSet` (preset + knob positions -> the filter field values to
// stage) and `matchPreset` (filter field values -> the preset and knob
// positions they correspond to).
//
// The module is pure — no signals, no DOM, no network — so every case here is a
// plain call with a plain return value. Nothing is stubbed and nothing needs a
// fake (docs/testing.md rule 4 has nothing to bite on where there is no wire).
//
// There is ONE preset list, and neither call takes a grid: `writeSet` and
// `matchPreset` are handed a preset id and an output mode and nothing else.
// Every preset carrying a `material` knob has its write table read elsewhere:
// `damage-control`'s in tests/js/store/easy-damage-control.test.js, the two
// flagships' in tests/js/store/easy-material.test.js. How many pips a preset
// costs is tests/js/store/easy-pips.test.js's.
//
// What the assertions are anchored on (rule 5, rule 9):
//
//   * The four SCHEMA KEYS `pcm_filter_1x`, `pcm_filter_nx`, `sdm_filter_1x`,
//     `sdm_filter_nx` (store/schema.js). These are contract, not copy — the
//     caller resolves each to its daemon field and enum id.
//   * Filter NAMES, never enum ids. The running engine is the sole authority
//     for ids and ordering and static data joins by name
//     (docs/architecture.md §2), so a name is the stable identifier here.
//   * `-2s` two-stage variants are enumerated on the SDM chain only; the PCM
//     chain carries none. That is why the `old-school` and `damage-control`
//     cases split by chain, and why `perfect-ten` is pinned as the control whose
//     SDM keys carry the same plain names its PCM keys do under "auto" — without
//     it, a module that appended `-2s` to every SDM value would pass every other
//     case in this file.
//
// Deliberately NOT asserted: the preset table itself. Which presets the card
// has and which positions their knobs define is `presetsFor`'s to say, and the
// one section that walks the whole table asks it rather than restating it —
// through tests/js/support/easytable.js, a pure sweep over `presetsFor` and
// `writeSet` with no fake and no rendering in it. Nothing here asserts that
// table's membership, ordering, emoji or shape. What a preset MEANS is pinned
// through `writeSet` and `matchPreset`, the observable half.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { writeSet, matchPreset, presetsFor } from "../../../hqptuner/static/store/easy.js";
import { namesWritten } from "../support/easytable.js";

/** The filter names the revision took out of the table. */
const RETIRED = ["poly-sinc-gauss-short", "poly-sinc-ext2-short"];

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

// --- behavior 1: the output mode selects which chain(s) get written ------------------
//
// Keys only, sorted — the values are every other section's business. A mode
// writing a key belonging to the other chain is the failure this catches, in
// both directions.

/** @type {[("pcm" | "sdm" | "auto"), string[]][]} */
const MODE_KEYS = [
  ["pcm", [PCM_1X, PCM_NX]],
  ["sdm", [SDM_1X, SDM_NX]],
  ["auto", [PCM_1X, PCM_NX, SDM_1X, SDM_NX]],
];

for (const [mode, keys] of MODE_KEYS) {
  test(`test_the_${mode}_output_mode_writes_only_its_own_chain_keys`, () => {
    assert.deepEqual(Object.keys(writeSet("perfect-ten", mode)).sort(), keys);
  });
}

// --- behaviors 2 and 5: one filter written to both ends of a chain --------------------
//
// One name landing on the chain's 1x key and its Nx key alike, preset by
// preset. Every row NAMES every knob position it reads at, so what each case
// pins is what that combination writes — a resting position is the owner's to
// revisit, and moving one must not break a case whose subject is the shape of
// the write rather than the default.
//
// Where the knobs rest is read once, immediately below the table, and only
// once.
//
// `old-school` is read here on the PCM chain, where the plain name lives; its
// SDM `-2s` flavor is behavior 4, below. `damage-control` has its own file.

// `perfect-ten` and `lifelike` are NOT read here. Both carry an `emphasis` knob
// and a `material` knob, crossed, and what each of the four combinations writes
// is tests/js/store/easy-material.test.js's whole subject.

/** @type {[string, string, Record<string, string>, string][]} */
const HEADLINE_PCM = [
  ["old-school", "with_emphasis_on_transients", { emphasis: "transients" }, "poly-sinc-short-mp"],
  ["purist", "with_emphasis_on_space", { emphasis: "space" }, "poly-sinc-gauss-halfband"],
  [
    "concert-hall",
    "on_the_perfect_ten_version_with_correction_on",
    { version: "perfect-ten", correction: "on" },
    "poly-sinc-gauss-xla",
  ],
];

for (const [presetId, at, knobs, name] of HEADLINE_PCM) {
  test(`test_the_preset_${presetId}_${at}_writes_${name}_to_both_ends_of_the_chain`, () => {
    assert.deepEqual(writeSet(presetId, "pcm", knobs), pcmBoth(name));
  });
}

// Where the knobs rest: a call passing no positions at all answers with the
// filter the resting ones name. One preset carries this, because a resting
// position belongs to the knob rather than to a preset — `purist` because it
// carries a single knob, so nothing else can be standing in the answer.

test("test_a_preset_called_with_no_knob_positions_writes_the_filter_its_resting_ones_name", () => {
  assert.deepEqual(writeSet("purist", "pcm"), pcmBoth("poly-sinc-gauss-halfband"));
});

// --- behavior 4: one "auto" call splits the chains for a -2s preset ---------------------

test("test_an_auto_call_writes_the_two_stage_variant_to_sdm_and_the_plain_name_to_pcm", () => {
  assert.deepEqual(writeSet("old-school", "auto"), {
    ...pcmBoth("poly-sinc-short-mp"),
    ...sdmBoth("poly-sinc-short-mp-2s"),
  });
});

test("test_a_preset_with_no_two_stage_variant_writes_the_same_names_to_both_chains", () => {
  // the control: -2s belongs to the presets that define it, not to the SDM
  // chain. Every knob position is named, so what each chain carries is the pair
  // that combination writes — the same pair, which is the claim.
  assert.deepEqual(writeSet("perfect-ten", "auto", { emphasis: "space", material: "lossless" }), {
    [PCM_1X]: "poly-sinc-gauss-long",
    [PCM_NX]: "poly-sinc-gauss-hires-lp",
    [SDM_1X]: "poly-sinc-gauss-long",
    [SDM_NX]: "poly-sinc-gauss-hires-lp",
  });
});

test("test_a_non_default_knob_position_carries_into_the_two_stage_sdm_variant", () => {
  assert.deepEqual(writeSet("old-school", "sdm", { emphasis: "space" }), sdmBoth("poly-sinc-short-lp-2s"));
});

// --- the knob positions each preset defines ---------------------------------------------
//
// Every non-default position the one-knob presets define, plus `concert-hall`'s
// two, read on the PCM chain. A preset whose knob moved nothing, or moved to the
// wrong filter, fails here by name.

/** @type {[string, string, Record<string, string>, string][]} */
const KNOB_CASES = [
  [
    "old-school",
    "old_school_with_emphasis_on_space_writes_the_short_lp_filter",
    { emphasis: "space" },
    "poly-sinc-short-lp",
  ],
  [
    "purist",
    "purist_with_emphasis_on_transients_writes_the_halfband_s_filter",
    { emphasis: "transients" },
    "poly-sinc-gauss-halfband-s",
  ],
  [
    "concert-hall",
    "concert_hall_on_the_lifelike_version_with_correction_on_writes_the_ext2_xla_filter",
    { version: "lifelike", correction: "on" },
    "poly-sinc-ext2-xla",
  ],
  [
    "concert-hall",
    "concert_hall_on_the_perfect_ten_version_with_correction_off_writes_the_gauss_xl_variant",
    { version: "perfect-ten", correction: "off" },
    "poly-sinc-gauss-xl",
  ],
  [
    "concert-hall",
    "concert_hall_on_the_lifelike_version_with_correction_off_writes_the_ext2_xl_variant",
    { version: "lifelike", correction: "off" },
    "poly-sinc-ext2-xl",
  ],
];

for (const [presetId, behavior, knobs, name] of KNOB_CASES) {
  test(`test_the_preset_${behavior}`, () => {
    assert.deepEqual(writeSet(presetId, "pcm", knobs), pcmBoth(name));
  });
}

// --- behavior 6: an undefined knob position falls back to that knob's default ------------
//
// `concert-hall`'s `version` knob has no `purist` and no knob anywhere defines
// `balanced` any more, so each of these asks for a position its preset does not
// define. The answer is the knob's default, never a synthesized filter name that
// the engine would not enumerate — which is also what a stale caller still
// holding a retired position gets.

// A row names every knob its preset carries EXCEPT the one whose fallback it is
// about, so the only position left to the module's own defaults is the one the
// case is reading. The two flagship presets write a PAIR at their lossless
// material — one name at 1x and another at Nx — so their rows expect that pair
// rather than one name on both keys.

/** @type {[string, string, Record<string, string>, Record<string, string>][]} */
const FALLBACK_CASES = [
  [
    "lifelike",
    "the_retired_balanced_emphasis",
    { material: "lossless", emphasis: "balanced" },
    { [PCM_1X]: "poly-sinc-ext2-long", [PCM_NX]: "poly-sinc-ext2-hires-lp" },
  ],
  [
    "perfect-ten",
    "a_nonexistent_emphasis",
    { material: "lossless", emphasis: "loudness" },
    { [PCM_1X]: "poly-sinc-gauss-long", [PCM_NX]: "poly-sinc-gauss-hires-lp" },
  ],
  [
    "perfect-ten",
    "a_nonexistent_material_beside_a_real_emphasis",
    { material: "vinyl", emphasis: "transients" },
    { [PCM_1X]: "poly-sinc-gauss-medium", [PCM_NX]: "poly-sinc-gauss-hires-mp" },
  ],
  [
    "lifelike",
    "a_real_material_beside_a_nonexistent_emphasis",
    { material: "lossy", emphasis: "loudness" },
    pcmBoth("poly-sinc-ext2-hires-lp"),
  ],
  ["concert-hall", "a_nonexistent_version", { version: "purist" }, pcmBoth("poly-sinc-gauss-xla")],
  [
    "concert-hall",
    "a_nonexistent_correction_beside_a_real_version",
    { version: "lifelike", correction: "sometimes" },
    pcmBoth("poly-sinc-ext2-xla"),
  ],
];

for (const [presetId, label, knobs, expected] of FALLBACK_CASES) {
  test(`test_${presetId}_given_${label}_falls_back_to_the_default_position`, () => {
    assert.deepEqual(writeSet(presetId, "pcm", knobs), expected);
  });
}

// --- behavior 7: matchPreset names the preset and knob positions behind the values -------
//
// Round trips, so the values fed to `matchPreset` are exactly what `writeSet`
// produced — the two are one contract read in both directions, and a table of
// hand-written values here would only re-state the sections above.
//
// Every case passes EVERY knob its preset defines explicitly, so the expected
// knob map is unambiguous. There is no grid to prefer and no tie to break: the
// answer is a preset id and a knob map, and nothing else.

/** @type {[string, string, ("pcm" | "sdm" | "auto"), Record<string, string>][]} */
const MATCH_CASES = [
  ["perfect_ten_on_pcm", "perfect-ten", "pcm", { emphasis: "space", material: "lossless" }],
  ["lifelike_on_auto", "lifelike", "auto", { emphasis: "transients", material: "lossy" }],
  ["old_school_on_sdm", "old-school", "sdm", { emphasis: "transients" }],
  ["purist_on_sdm", "purist", "sdm", { emphasis: "transients" }],
  ["concert_hall_on_auto", "concert-hall", "auto", { version: "lifelike", correction: "off" }],
];

for (const [label, presetId, mode, knobs] of MATCH_CASES) {
  test(`test_matchpreset_recovers_the_${label}_that_wrote_the_values`, () => {
    assert.deepEqual(matchPreset(writeSet(presetId, mode, knobs), mode), { presetId, knobs });
  });
}

test("test_matchpreset_returns_null_for_values_no_preset_writes", () => {
  assert.equal(matchPreset({ [PCM_1X]: "sinc-M", [PCM_NX]: "sinc-M" }, "pcm"), null);
});

// The two filters the revision retired from the table, read twice over.
//
// First backwards, through `matchPreset`: a name no preset writes is a name
// nothing matches, so a preset still able to reach either one answers with
// itself here.

for (const name of RETIRED) {
  test(`test_matchpreset_names_no_preset_for_the_retired_${name}_filter`, () => {
    assert.equal(matchPreset(pcmBoth(name), "pcm"), null);
  });
}

// Then forwards, over the table swept whole — every preset at every combination
// of the positions its knobs define, which is the reading that covers a filter
// reachable only from some corner of the cross. Filter names are wire
// identifiers, so this is a fact about the table and not about any word a tile
// shows.
//
// The vocabulary the sweep produces is pinned non-empty in its own right,
// immediately below. Without that, a table that produced no names at all would
// satisfy the case above by filtering an empty list to an empty list.

const swept = () => namesWritten();

test("test_no_preset_writes_a_retired_short_filter_at_any_knob_combination", () => {
  assert.deepEqual(
    swept().filter((name) => RETIRED.includes(name)),
    [],
  );
});

test("test_the_table_writes_a_vocabulary_of_filter_names_to_sweep", () => {
  assert.notEqual(swept().length, 0);
});

test("test_matchpreset_returns_null_when_the_two_ends_of_one_chain_belong_to_different_presets", () => {
  assert.equal(matchPreset({ [PCM_1X]: "poly-sinc-gauss-long", [PCM_NX]: "poly-sinc-ext2-long" }, "pcm"), null);
});

// --- behavior 8: under "auto" both chains must agree ------------------------------------
//
// Each chain on its own reads as a legitimate preset; together they do not, so
// the whole match is null rather than whichever chain got looked at first.

test("test_matchpreset_returns_null_under_auto_when_the_chains_name_different_presets", () => {
  assert.equal(matchPreset({ ...pcmBoth("poly-sinc-gauss-long"), ...sdmBoth("poly-sinc-ext2-long") }, "auto"), null);
});

test("test_matchpreset_returns_null_under_auto_when_the_chains_name_different_knob_positions", () => {
  assert.equal(matchPreset({ ...pcmBoth("poly-sinc-gauss-long"), ...sdmBoth("poly-sinc-gauss-medium") }, "auto"), null);
});

test("test_matchpreset_returns_null_under_auto_when_only_one_chain_carries_the_two_stage_variant", () => {
  // both halves are old-school, but the PCM chain never enumerates -2s
  assert.equal(matchPreset({ ...pcmBoth("poly-sinc-short-mp-2s"), ...sdmBoth("poly-sinc-short-mp-2s") }, "auto"), null);
});

// --- there is one preset list, and no `lossy` in it -------------------------------------
//
// The `lossy` tile the playlist grid carried is gone: what it wrote is now
// `damage-control`'s `material` knob at its `lossy` position
// (tests/js/store/easy-damage-control.test.js). A preset id is a wire
// identifier, so the id's absence is a fact this file may state; WHICH ids the
// list carries and in what order is the card's, and is read there
// (tests/js/components/easytiles.test.js).

test("test_no_preset_carries_the_retired_lossy_id", () => {
  assert.equal(
    presetsFor()
      .map((/** @type {{ id: string }} */ preset) => preset.id)
      .includes("lossy"),
    false,
  );
});
