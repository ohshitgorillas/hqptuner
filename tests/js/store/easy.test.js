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
//   * RELATIONS between calls, never filter names. Which filter a preset writes
//     is owner data, retuned at will (docs/testing.md rule 9), so no assertion
//     and no test name here carries a filter name: one `writeSet` call is read
//     against another, or against a value derived from another. Preset ids,
//     knob ids and knob positions are wire identifiers and are stated outright.
//   * `-2s` two-stage variants are enumerated on the SDM chain only; the PCM
//     chain carries none. That is why the `old-school` and `damage-control`
//     cases split by chain, and why `perfect-ten` is pinned as the control whose
//     SDM keys carry the same values its PCM keys do under "auto" — without
//     it, a module that appended `-2s` to every SDM value would pass every other
//     case in this file.
//
// Deliberately NOT asserted: the preset table itself. Which presets the card
// has and which positions their knobs define is `presetsFor`'s to say, and the
// one section that walks the whole table asks it rather than restating it —
// through tests/js/support/easytable.js, a pure sweep over `presetsFor` and
// `writeSet` with no fake and no rendering in it. Nothing here asserts that
// table's membership, ordering, emoji or shape. What a preset MEANS is pinned
// through `writeSet` and `matchPreset`, the observable half. Where a knob RESTS
// is read from `presetsFor` at the point of use, never typed.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { writeSet, matchPreset, presetsFor, knobsShown } from "../../../hqptuner/static/store/easy.js";
import { combos, namesWritten } from "../support/easytable.js";

/** @typedef {{ id: string, default: string, options: string[], when?: Record<string, string> }} Knob */
/** @typedef {{ id: string, emoji: string, knobs: Knob[], hires?: boolean, costText?: boolean }} Preset */

/** @type {Preset[]} */
const PRESETS = presetsFor();

const PCM_1X = "pcm_filter_1x";
const PCM_NX = "pcm_filter_nx";
const SDM_1X = "sdm_filter_1x";
const SDM_NX = "sdm_filter_nx";

/** The knob a preset declares under an id, read from the shipped table. */
function knobOf(/** @type {string} */ presetId, /** @type {string} */ knobId) {
  const knob = PRESETS.find((p) => p.id === presetId)?.knobs.find((k) => k.id === knobId);
  if (!knob) throw new Error(`preset ${presetId} declares no knob ${knobId}`);
  return knob;
}

/** Every knob of a preset at its declared default. */
function restingKnobs(/** @type {string} */ presetId) {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error(`no preset ${presetId}`);
  return Object.fromEntries(preset.knobs.map((k) => [k.id, k.default]));
}

/** `knobs` with one position swapped for that knob's declared default. */
function atDefault(
  /** @type {string} */ presetId,
  /** @type {Record<string, string>} */ knobs,
  /** @type {string} */ knobId,
) {
  return { ...knobs, [knobId]: knobOf(presetId, knobId).default };
}

/** The SDM pair a PCM write implies for a preset carrying a two-stage variant. */
function twoStageOf(/** @type {Record<string, string>} */ pcm) {
  return { [SDM_1X]: `${pcm[PCM_1X]}-2s`, [SDM_NX]: `${pcm[PCM_NX]}-2s` };
}

/** The SDM pair a PCM write implies for a preset carrying no two-stage variant. */
function sameOnSdm(/** @type {Record<string, string>} */ pcm) {
  return { [SDM_1X]: pcm[PCM_1X], [SDM_NX]: pcm[PCM_NX] };
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
// The chain's 1x key and its Nx key carry the same value, preset by preset.
// Every row NAMES every knob position it reads at, so what each case pins is
// the shape of that combination's write, never which filter it is. That the
// value is non-empty is carried by the vocabulary sweep further down.
//
// `old-school` is read here on the PCM chain, where the plain name lives; its
// SDM `-2s` flavor is behavior 4, below. `damage-control` has its own file.

// `perfect-ten` and `lifelike` are NOT read here. Both carry an `emphasis` knob
// and a `material` knob, crossed, and what each of the four combinations writes
// is tests/js/store/easy-material.test.js's whole subject.

/** @type {[string, string, Record<string, string>][]} */
const HEADLINE_PCM = [
  ["old-school", "with_emphasis_on_transients", { emphasis: "transients" }],
  ["purist", "with_emphasis_on_space", { emphasis: "space" }],
  ["concert-hall", "on_the_perfect_ten_version_with_correction_on", { version: "perfect-ten", correction: "on" }],
];

for (const [presetId, at, knobs] of HEADLINE_PCM) {
  test(`test_the_preset_${presetId}_${at}_writes_one_filter_to_both_ends_of_the_chain`, () => {
    const out = writeSet(presetId, "pcm", knobs);
    assert.deepEqual(out, { [PCM_1X]: out[PCM_1X], [PCM_NX]: out[PCM_1X] });
  });
}

// Where the knobs rest: a call passing no positions at all answers exactly as
// a call naming every knob at the default `presetsFor` declares for it. One
// preset carries this, because a resting position belongs to the knob rather
// than to a preset — `purist` because it carries a single knob, so nothing
// else can be standing in the answer.

test("test_a_preset_called_with_no_knob_positions_writes_what_its_declared_defaults_write", () => {
  assert.deepEqual(writeSet("purist", "pcm"), writeSet("purist", "pcm", restingKnobs("purist")));
});

// --- behavior 4: one "auto" call splits the chains for a -2s preset ---------------------
//
// The SDM value is derived from the PCM call rather than typed: whichever
// filter the preset writes, the SDM chain carries it with `-2s` appended.

test("test_an_auto_call_writes_the_two_stage_variant_to_sdm_and_the_plain_name_to_pcm", () => {
  const pcm = writeSet("old-school", "pcm");
  assert.deepEqual(writeSet("old-school", "auto"), { ...pcm, ...twoStageOf(pcm) });
});

test("test_a_preset_with_no_two_stage_variant_writes_the_same_values_to_both_chains", () => {
  // the control: -2s belongs to the presets that define it, not to the SDM
  // chain. Every knob position is named, so what each chain carries is the pair
  // that combination writes — the same pair, which is the claim.
  const knobs = { emphasis: "space", material: "lossless" };
  const pcm = writeSet("perfect-ten", "pcm", knobs);
  assert.deepEqual(writeSet("perfect-ten", "auto", knobs), { ...pcm, ...sameOnSdm(pcm) });
});

// Every emphasis position `old-school` declares carries into the SDM variant,
// so a module appending `-2s` only at the resting position fails by position.

for (const emphasis of knobOf("old-school", "emphasis").options) {
  test(`test_old_school_with_emphasis_on_${emphasis}_writes_the_two_stage_variant_of_its_pcm_pair_to_sdm`, () => {
    const knobs = { emphasis };
    assert.deepEqual(writeSet("old-school", "sdm", knobs), twoStageOf(writeSet("old-school", "pcm", knobs)));
  });
}

// --- the knob positions each preset defines ---------------------------------------------
//
// Swept from the shipped table: every preset, every combination of every
// option of every knob it declares, and within each combination every knob
// the tile offers at those positions that stands off its default. Returning
// that one knob to its default, the siblings held where they are, writes a
// PCM pair different from the combination's own. Distinct is the claim; which
// filter either side is stays the owner's. The full cross product is walked
// rather than one knob at a time from rest, so a knob the table ignores
// whenever a sibling is off its default fails here by preset, combination and
// knob. A knob whose `when` is not met at a combination is not offered there
// and generates nothing; presets with no knobs generate nothing.

/** A combination as `knob=option` pairs joined with `_`, for a test name. */
function positionsOf(/** @type {Record<string, string>} */ knobs) {
  return Object.entries(knobs)
    .map(([knobId, option]) => `${knobId}=${option}`)
    .join("_");
}

/** @type {[string, Record<string, string>, string][]} */
const KNOB_MOVES = PRESETS.flatMap((preset) =>
  combos(preset.knobs).flatMap((c) =>
    knobsShown(preset, c)
      .filter((knob) => c[knob.id] !== knob.default)
      .map((knob) => /** @type {[string, Record<string, string>, string]} */ ([preset.id, c, knob.id])),
  ),
);

// The sweep is generated from the table, so an empty roster or a knob shape
// the sweep no longer recognises would retire the rule silently. This case
// fails by name when that happens.

test("test_the_shipped_table_offers_at_least_one_non_default_knob_position_to_sweep", () => {
  assert.ok(
    KNOB_MOVES.length > 0,
    "no preset offers a knob with a non-default option, so the sweep below generated nothing",
  );
});

for (const [presetId, knobs, knobId] of KNOB_MOVES) {
  test(`test_${presetId}_at_${positionsOf(knobs)}_returning_${knobId}_to_default_writes_a_different_pcm_pair`, () => {
    assert.notDeepEqual(
      writeSet(presetId, "pcm", knobs),
      writeSet(presetId, "pcm", atDefault(presetId, knobs, knobId)),
    );
  });
}

// --- behavior 6: an undefined knob position falls back to that knob's default ------------
//
// `concert-hall`'s `version` knob has no `purist` and no knob anywhere defines
// `balanced` any more, so each of these asks for a position its preset does not
// define. The answer is the knob's default, never a synthesized filter name that
// the engine would not enumerate — which is also what a stale caller still
// holding a retired position gets.

// A row names every knob its preset carries, one of them at a position the
// preset does not define, and expects what the same call writes with that knob
// swapped for the default `presetsFor` declares. The default is read from the
// table, never typed.

/** @type {[string, string, Record<string, string>, string][]} */
const FALLBACK_CASES = [
  ["lifelike", "the_retired_balanced_emphasis", { material: "lossless", emphasis: "balanced" }, "emphasis"],
  ["perfect-ten", "a_nonexistent_emphasis", { material: "lossless", emphasis: "loudness" }, "emphasis"],
  [
    "perfect-ten",
    "a_nonexistent_material_beside_a_real_emphasis",
    { material: "vinyl", emphasis: "transients" },
    "material",
  ],
  [
    "lifelike",
    "a_real_material_beside_a_nonexistent_emphasis",
    { material: "lossy", emphasis: "loudness" },
    "emphasis",
  ],
  ["concert-hall", "a_nonexistent_version", { version: "purist" }, "version"],
  [
    "concert-hall",
    "a_nonexistent_correction_beside_a_real_version",
    { version: "lifelike", correction: "sometimes" },
    "correction",
  ],
];

for (const [presetId, label, knobs, bogus] of FALLBACK_CASES) {
  test(`test_${presetId}_given_${label}_falls_back_to_the_default_position`, () => {
    assert.deepEqual(writeSet(presetId, "pcm", knobs), writeSet(presetId, "pcm", atDefault(presetId, knobs, bogus)));
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

// A value off the table entirely is synthetic garbage rather than a real
// filter name, so nothing here says which names the table does not carry.

test("test_matchpreset_returns_null_for_values_no_preset_writes", () => {
  assert.equal(matchPreset({ [PCM_1X]: "not-a-filter", [PCM_NX]: "not-a-filter" }, "pcm"), null);
});

// The table swept whole, every preset at every combination of the positions
// its knobs define, is pinned to produce a non-empty vocabulary, so a table
// writing no names at all cannot pass the sweeps that read it.

const swept = () => namesWritten();

test("test_the_table_writes_a_vocabulary_of_filter_names_to_sweep", () => {
  assert.notEqual(swept().length, 0);
});

// Mixed inputs are BUILT from `writeSet` of two different presets, or of one
// preset at two knob positions, rather than typed: the claim is that halves of
// different writes do not read as one preset, whichever filters they carry.

const HALF_A = { emphasis: "space", material: "lossless" };
const HALF_B = { emphasis: "transients", material: "lossless" };

test("test_matchpreset_returns_null_when_the_two_ends_of_one_chain_belong_to_different_presets", () => {
  const mixed = {
    [PCM_1X]: writeSet("perfect-ten", "pcm", HALF_A)[PCM_1X],
    [PCM_NX]: writeSet("lifelike", "pcm", HALF_A)[PCM_NX],
  };
  assert.equal(matchPreset(mixed, "pcm"), null);
});

// --- behavior 8: under "auto" both chains must agree ------------------------------------
//
// Each chain on its own reads as a legitimate preset; together they do not, so
// the whole match is null rather than whichever chain got looked at first.

test("test_matchpreset_returns_null_under_auto_when_the_chains_name_different_presets", () => {
  const mixed = { ...writeSet("perfect-ten", "pcm", HALF_A), ...writeSet("lifelike", "sdm", HALF_A) };
  assert.equal(matchPreset(mixed, "auto"), null);
});

test("test_matchpreset_returns_null_under_auto_when_the_chains_name_different_knob_positions", () => {
  const mixed = { ...writeSet("perfect-ten", "pcm", HALF_A), ...writeSet("perfect-ten", "sdm", HALF_B) };
  assert.equal(matchPreset(mixed, "auto"), null);
});

test("test_matchpreset_returns_null_under_auto_when_only_one_chain_carries_the_two_stage_variant", () => {
  // both halves are old-school, but the PCM chain never enumerates -2s
  const sdm = writeSet("old-school", "sdm");
  assert.equal(matchPreset({ [PCM_1X]: sdm[SDM_1X], [PCM_NX]: sdm[SDM_NX], ...sdm }, "auto"), null);
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
