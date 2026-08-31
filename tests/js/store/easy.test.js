// Behavioral suite for Easy Mode's curated preset table (store/easy.js): the
// pure pair `writeSet` (preset + knob positions -> the filter field values to
// stage) and `matchPreset` (filter field values -> the preset and knob
// positions they correspond to), swept over the whole shipped table.
//
// The module is pure (no signals, no DOM, no network), so every case is a
// plain call with a plain return value. Nothing is stubbed and nothing needs
// a fake (docs/testing.md rule 4 has nothing to bite on where there is no
// wire).
//
// EVERY CASE IS GENERATED. No preset is named here to stand for a property
// (has an emphasis knob, has two knobs, has a two-stage variant, is knobless):
// the roster comes from `presetsFor()`, the positions from each knob's
// `options` and `default`, and each behavior is a sweep over (preset, combo)
// or over the cases a property selects. A property no preset carries yields
// zero cases, not a skip and not a guard; the one guard is that `presetsFor()`
// is non-empty, so the sweeps cannot pass vacuously.
//
// What the assertions are anchored on (rule 5, rule 9):
//
//   * The four SCHEMA KEYS `pcm_filter_1x`, `pcm_filter_nx`, `sdm_filter_1x`,
//     `sdm_filter_nx` (store/schema.js): contract, not copy.
//   * RELATIONS between calls, never filter names. Which filter a preset
//     writes is owner data, retuned at will (rule 9), so no assertion and no
//     test name carries a filter name: one `writeSet` call is read against
//     another, or against a value derived from another. Preset ids, knob ids
//     and knob positions are wire identifiers and appear in generated names.
//   * `-2s` two-stage variants live on the SDM chain only: an SDM value that
//     carries the suffix is the PCM value plus `-2s`, and one that does not
//     is the PCM value itself. The two sweeps select their cases by that
//     property so each asserts one exact relation.
//
// What is pinned:
//
//   1. the roster is non-empty (the one guard);
//   2. each output mode writes exactly its own chain keys;
//   3. every key written carries a non-empty string;
//   4. every write round-trips through `matchPreset` to its preset and the
//      positions of every knob offered there;
//   5. omitted and undefined knob positions write what the default writes;
//   6. the two-stage relation between the SDM and PCM chains, by property;
//   7. returning one offered knob to its default from any combination changes
//      the PCM pair (the KNOB_MOVES sweep);
//   8. `matchPreset` answers null for values no single preset at one
//      combination wrote, built from real writes and synthetic names;
//   9. the auto mode write is both chains' writes, the PCM one and the SDM
//      one merged, at every combination.
//
// Deliberately NOT asserted: the table's membership, ordering, emoji, shape or
// any word a tile shows.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { writeSet, matchPreset, presetsFor, knobsShown } from "../../../hqptuner/static/store/easy.js";
import { combos } from "../support/easytable.js";

/** @typedef {{ id: string, default: string, options: string[], when?: Record<string, string> }} Knob */
/** @typedef {{ id: string, emoji: string, knobs: Knob[], hires?: boolean, costText?: boolean }} Preset */
/** @typedef {"pcm" | "sdm" | "auto"} Mode */

/** @type {Preset[]} */
const PRESETS = presetsFor();

const PCM_1X = "pcm_filter_1x";
const PCM_NX = "pcm_filter_nx";
const SDM_1X = "sdm_filter_1x";
const SDM_NX = "sdm_filter_nx";

/** @type {Mode[]} */
const MODES = ["pcm", "sdm", "auto"];

/** The chain ends, as (PCM key, SDM key) pairs. */
const ENDS = [
  ["1x", PCM_1X, SDM_1X],
  ["nx", PCM_NX, SDM_NX],
];

const TWO_STAGE = "-2s";

/** A combination as `knob=option` pairs joined with `_`, for a test name. */
function positionsOf(/** @type {Record<string, string>} */ knobs) {
  const pairs = Object.entries(knobs).map(([knobId, option]) => `${knobId}=${option}`);
  return pairs.length === 0 ? "no_knobs" : pairs.join("_");
}

/** Every knob of a preset at its declared default. */
function restingKnobs(/** @type {Preset} */ preset) {
  return Object.fromEntries(preset.knobs.map((k) => [k.id, k.default]));
}

/** `knobs` with one position swapped for that knob's declared default. */
function atDefault(
  /** @type {Preset} */ preset,
  /** @type {Record<string, string>} */ knobs,
  /** @type {string} */ knobId,
) {
  const knob = preset.knobs.find((k) => k.id === knobId);
  if (!knob) throw new Error(`preset ${preset.id} declares no knob ${knobId}`);
  return { ...knobs, [knobId]: knob.default };
}

/** The positions of every knob the tile offers at `knobs`, as `matchPreset` reports them. */
function offeredAt(/** @type {Preset} */ preset, /** @type {Record<string, string>} */ knobs) {
  return Object.fromEntries(knobsShown(preset, knobs).map((knob) => [knob.id, knobs[knob.id]]));
}

/** Every (preset, combination) the table defines. */
/** @type {[Preset, Record<string, string>][]} */
const CELLS = PRESETS.flatMap((preset) =>
  combos(preset.knobs).map((c) => /** @type {[Preset, Record<string, string>]} */ ([preset, c])),
);

// --- behavior 1: the roster is non-empty ----------------------------------------------------
//
// The one guard. Every sweep below reads `presetsFor()`, so an empty roster
// would retire all of them silently; this case fails by name instead.

test("test_the_shipped_table_carries_at_least_one_preset_to_sweep", () => {
  assert.ok(PRESETS.length > 0, "presetsFor() returned no presets, so every sweep below generated nothing");
});

// --- behavior 2: the output mode selects which chain(s) get written ------------------------
//
// Keys only, sorted; the values are every other section's business. A mode
// writing a key belonging to the other chain fails here, in both directions.

/** @type {[Mode, string[]][]} */
const MODE_KEYS = [
  ["pcm", [PCM_1X, PCM_NX]],
  ["sdm", [SDM_1X, SDM_NX]],
  ["auto", [PCM_1X, PCM_NX, SDM_1X, SDM_NX]],
];

for (const [preset, c] of CELLS) {
  for (const [mode, keys] of MODE_KEYS) {
    test(`test_${preset.id}_at_${positionsOf(c)}_in_${mode}_mode_writes_exactly_its_chain_keys`, () => {
      assert.deepEqual(Object.keys(writeSet(preset.id, mode, c)).sort(), [...keys].sort());
    });
  }
}

// --- behavior 3: every key written carries a non-empty string -------------------------------
//
// Offenders are the keys whose value is not a non-empty string, so a failure
// names the key rather than the whole write.

for (const [preset, c] of CELLS) {
  for (const mode of MODES) {
    test(`test_${preset.id}_at_${positionsOf(c)}_in_${mode}_mode_writes_a_non_empty_name_to_every_key`, () => {
      const written = writeSet(preset.id, mode, c);
      const offenders = Object.keys(written).filter((key) => typeof written[key] !== "string" || written[key] === "");
      assert.deepEqual(offenders, []);
    });
  }
}

// --- behavior 4: matchPreset recovers the preset and offered positions behind a write -------
//
// Round trips: the values fed to `matchPreset` are exactly what `writeSet`
// produced, in every mode, at every combination. The expected knob map holds
// every knob the tile OFFERS at that combination (`knobsShown`), so a knob
// whose `when` is not met there is not expected back.

for (const [preset, c] of CELLS) {
  for (const mode of MODES) {
    test(`test_matchpreset_recovers_${preset.id}_at_${positionsOf(c)}_from_its_${mode}_mode_write`, () => {
      assert.deepEqual(matchPreset(writeSet(preset.id, mode, c), mode), {
        presetId: preset.id,
        knobs: offeredAt(preset, c),
      });
    });
  }
}

// --- behavior 5: omitted and undefined positions write what the default writes -------------
//
// A call passing no positions answers exactly as one naming every knob at
// the default `presetsFor` declares for it. And a position no knob defines
// (a synthetic string, never a real position) answers as that knob's default
// with its siblings held at theirs: what a stale caller holding a retired
// position gets, never a synthesized name the engine would not enumerate.

for (const preset of PRESETS) {
  test(`test_${preset.id}_called_with_no_knob_positions_writes_what_its_declared_defaults_write`, () => {
    assert.deepEqual(writeSet(preset.id, "pcm"), writeSet(preset.id, "pcm", restingKnobs(preset)));
  });
}

for (const preset of PRESETS) {
  for (const knob of preset.knobs) {
    test(`test_${preset.id}_given_an_undefined_${knob.id}_position_falls_back_to_that_knobs_default`, () => {
      const bogus = { ...restingKnobs(preset), [knob.id]: "not-a-position" };
      assert.deepEqual(writeSet(preset.id, "pcm", bogus), writeSet(preset.id, "pcm", restingKnobs(preset)));
    });
  }
}

// --- behavior 6: the two-stage relation between the SDM and PCM chains, by property --------
//
// Each chain end is read from the preset's "sdm" write against its "pcm"
// write at the same combination. The cases split by whether the SDM value
// carries the `-2s` suffix: those that do must be the PCM value plus `-2s`,
// those that do not must be the PCM value itself. Two sweeps, one exact
// relation each, so a module appending `-2s` to every SDM value fails in the
// second sweep and one appending it nowhere fails in the first. A table with
// no two-stage variant generates no case in the first sweep.

/** @type {[Preset, Record<string, string>, string, string, string][]} */
const CHAIN_ENDS = CELLS.flatMap(([preset, c]) =>
  ENDS.map(
    ([end, pcmKey, sdmKey]) =>
      /** @type {[Preset, Record<string, string>, string, string, string]} */ ([preset, c, end, pcmKey, sdmKey]),
  ),
);

const carriesSuffix = (
  /** @type {[Preset, Record<string, string>, string, string, string]} */ [preset, c, , , sdmKey],
) => writeSet(preset.id, "sdm", c)[sdmKey].endsWith(TWO_STAGE);

for (const [preset, c, end, pcmKey, sdmKey] of CHAIN_ENDS.filter(carriesSuffix)) {
  test(`test_${preset.id}_at_${positionsOf(c)}_writes_the_two_stage_variant_of_its_pcm_${end}_value_to_sdm`, () => {
    assert.equal(writeSet(preset.id, "sdm", c)[sdmKey], `${writeSet(preset.id, "pcm", c)[pcmKey]}${TWO_STAGE}`);
  });
}

for (const [preset, c, end, pcmKey, sdmKey] of CHAIN_ENDS.filter((row) => !carriesSuffix(row))) {
  test(`test_${preset.id}_at_${positionsOf(c)}_writes_its_pcm_${end}_value_unchanged_to_sdm`, () => {
    assert.equal(writeSet(preset.id, "sdm", c)[sdmKey], writeSet(preset.id, "pcm", c)[pcmKey]);
  });
}

// --- behavior 7: the knob positions each preset defines ------------------------------------
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

/** @type {[Preset, Record<string, string>, string][]} */
const KNOB_MOVES = CELLS.flatMap(([preset, c]) =>
  knobsShown(preset, c)
    .filter((knob) => c[knob.id] !== knob.default)
    .map((knob) => /** @type {[Preset, Record<string, string>, string]} */ ([preset, c, knob.id])),
);

for (const [preset, knobs, knobId] of KNOB_MOVES) {
  test(`test_${preset.id}_at_${positionsOf(knobs)}_returning_${knobId}_to_default_writes_a_different_pcm_pair`, () => {
    assert.notDeepEqual(
      writeSet(preset.id, "pcm", knobs),
      writeSet(preset.id, "pcm", atDefault(preset, knobs, knobId)),
    );
  });
}

// --- behavior 8: matchPreset answers null for values no one write produced -----------------
//
// Each input is BUILT from real writes, or from a synthetic name that is not
// a filter, never typed from the table. Each search picks its material from
// the roster by property; a search that finds nothing generates no test.

// 8a. The two ends of one chain from two different presets, at rest. The
// presets are the first pair in roster order whose mixed PCM pair (a's 1x,
// b's nx) no preset at any combination writes as its own: a correct table
// may legitimately hand one preset's 1x and another's nx to some third cell,
// and null would be the wrong answer there. A pair the table does write is
// skipped, not asserted; a roster where every pair is written generates no
// test here.

/** The PCM pair made of `a`'s 1x value and `b`'s nx value, both at rest. */
function mixedPcmPair(/** @type {Preset} */ a, /** @type {Preset} */ b) {
  return { [PCM_1X]: writeSet(a.id, "pcm")[PCM_1X], [PCM_NX]: writeSet(b.id, "pcm")[PCM_NX] };
}

/** Whether any (preset, combination) in the table writes exactly `pair` on the PCM chain. */
function tableWritesPcmPair(/** @type {Record<string, string>} */ pair) {
  const cell = CELLS.find(([preset, c]) => {
    const written = writeSet(preset.id, "pcm", c);
    return written[PCM_1X] === pair[PCM_1X] && written[PCM_NX] === pair[PCM_NX];
  });
  return cell !== undefined;
}

/** @returns {[Preset, Preset] | undefined} */
function firstPresetsWithUnwrittenMixedPcmPair() {
  for (const a of PRESETS) {
    const b = PRESETS.find((other) => other !== a && !tableWritesPcmPair(mixedPcmPair(a, other)));
    if (b) return [a, b];
  }
  return undefined;
}

const SPLIT_PRESETS = firstPresetsWithUnwrittenMixedPcmPair();

if (SPLIT_PRESETS) {
  const [a, b] = SPLIT_PRESETS;
  test(`test_matchpreset_returns_null_when_the_1x_end_is_${a.id}s_and_the_nx_end_is_${b.id}s`, () => {
    assert.equal(matchPreset(mixedPcmPair(a, b), "pcm"), null);
  });
}

// 8b. A synthetic name on every key: garbage rather than a real filter name,
// so nothing here says which names the table does not carry.

test("test_matchpreset_returns_null_for_a_synthetic_name_on_every_key", () => {
  const garbage = {
    [PCM_1X]: "not-a-filter",
    [PCM_NX]: "not-a-filter",
    [SDM_1X]: "not-a-filter",
    [SDM_NX]: "not-a-filter",
  };
  assert.equal(matchPreset(garbage, "auto"), null);
});

// 8c. Under "auto" both chains must agree on the knob positions: the PCM
// keys from one combination and the SDM keys from another of the same
// preset. The pair is the first found, sweeping presets in roster order and
// combinations in table order, whose PCM halves differ and whose SDM halves
// differ, so neither half alone could claim the mixed write.

/** @returns {[Preset, Record<string, string>, Record<string, string>] | undefined} */
function firstCombosWithDifferentWrites() {
  for (const preset of PRESETS) {
    const cs = combos(preset.knobs);
    for (const [i, ci] of cs.entries()) {
      const cj = cs.slice(i + 1).find((other) => differsOnBothChains(preset, ci, other));
      if (cj) return [preset, ci, cj];
    }
  }
  return undefined;
}

/** Whether two combinations of one preset write different PCM pairs and different SDM pairs. */
function differsOnBothChains(
  /** @type {Preset} */ preset,
  /** @type {Record<string, string>} */ ci,
  /** @type {Record<string, string>} */ cj,
) {
  const pcmDiffers = JSON.stringify(writeSet(preset.id, "pcm", ci)) !== JSON.stringify(writeSet(preset.id, "pcm", cj));
  const sdmDiffers = JSON.stringify(writeSet(preset.id, "sdm", ci)) !== JSON.stringify(writeSet(preset.id, "sdm", cj));
  return pcmDiffers && sdmDiffers;
}

const SPLIT_COMBOS = firstCombosWithDifferentWrites();

if (SPLIT_COMBOS) {
  const [preset, ci, cj] = SPLIT_COMBOS;
  test(`test_matchpreset_returns_null_under_auto_when_${preset.id}_pcm_is_at_${positionsOf(ci)}_and_sdm_at_${positionsOf(cj)}`, () => {
    const mixed = { ...writeSet(preset.id, "pcm", ci), ...writeSet(preset.id, "sdm", cj) };
    assert.equal(matchPreset(mixed, "auto"), null);
  });
}

// 8d. Under "auto" the SDM pair of a two-stage write copied onto the PCM
// keys: the PCM chain never enumerates `-2s`, so both halves naming the same
// preset is not enough. Selected by property: the first (preset, combination)
// whose SDM 1x value carries the suffix. A table with no two-stage variant
// generates no test here.

const TWO_STAGE_CELL = CELLS.find(([preset, c]) => writeSet(preset.id, "sdm", c)[SDM_1X].endsWith(TWO_STAGE));

if (TWO_STAGE_CELL) {
  const [preset, c] = TWO_STAGE_CELL;
  test(`test_matchpreset_returns_null_under_auto_when_${preset.id}_at_${positionsOf(c)}_carries_its_two_stage_pair_on_pcm`, () => {
    const sdm = writeSet(preset.id, "sdm", c);
    assert.equal(matchPreset({ [PCM_1X]: sdm[SDM_1X], [PCM_NX]: sdm[SDM_NX], ...sdm }, "auto"), null);
  });
}

// --- behavior 9: the auto mode write is both chains' writes -----------------------------------
//
// Under "auto" the engine follows the incoming rate, so a tile must stage what
// it would stage for PCM and what it would stage for SDM, both. Read as the
// "auto" write against the "pcm" and "sdm" writes of the same preset at the
// same combination, merged: the chains share no key (behavior 2), so the merge
// is exact and a mode that dropped or altered either chain's value fails by
// preset and positions.

for (const [preset, c] of CELLS) {
  test(`test_${preset.id}_at_${positionsOf(c)}_in_auto_mode_writes_both_chains_writes`, () => {
    assert.deepEqual(writeSet(preset.id, "auto", c), {
      ...writeSet(preset.id, "pcm", c),
      ...writeSet(preset.id, "sdm", c),
    });
  });
}
