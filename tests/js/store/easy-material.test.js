// Behavioral suite for the `material` knob: what its two positions, `lossless`
// and `lossy`, do to the write of every preset that carries it.
//
// The presets are selected by PROPERTY, never by name: every preset from
// `presetsFor()` whose `knobs` include one with id `material`. A preset named
// here would stand in for the property and drift the first time the owner
// moved the knob to another tile. A table with no such preset generates zero
// cases, and that is the correct answer, not a gap to guard against.
//
// For each such preset, every combination of its OTHER knobs is walked (via
// `combos` over the knobs minus `material`) so a table that ignored a sibling
// knob at one material position fails by preset, combination and material.
// Four rules per combination:
//
//   * `lossy` writes ONE value to both PCM ends.
//   * `auto` on `lossy` carries that one value to all four schema keys, so the
//     SDM pair is read where the PCM-only rows cannot see it.
//   * A call that omits `material` writes what `lossless` writes: that is where
//     the knob rests.
//   * The write at either material round-trips through `matchPreset` to the
//     same preset and the positions of every knob the tile offers there.
//
// Anchored on schema keys, preset ids, knob ids and knob positions, all wire
// identifiers. No filter name appears and no copy is read (docs/testing.md
// rule 9); what `lossless` writes to each end is the owner's and is not pinned.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy-material.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { writeSet, matchPreset, presetsFor, knobsShown } from "../../../hqptuner/static/store/easy.js";
import { combos } from "../support/easytable.js";

/** @typedef {ReturnType<typeof presetsFor>[number]} Preset */

const PCM_1X = "pcm_filter_1x";
const PCM_NX = "pcm_filter_nx";
const SDM_1X = "sdm_filter_1x";
const SDM_NX = "sdm_filter_nx";

const MATERIAL = "material";
const LOSSLESS = "lossless";
const LOSSY = "lossy";

/** @param {string} name One value on both PCM ends. */
const pcmBoth = (name) => ({ [PCM_1X]: name, [PCM_NX]: name });

/** @param {string} name One value on both ends of both chains. */
const everyChain = (name) => ({ [PCM_1X]: name, [PCM_NX]: name, [SDM_1X]: name, [SDM_NX]: name });

/** A combination as `knob=option` pairs joined with `_`, for a test name. */
function positionsOf(/** @type {Record<string, string>} */ knobs) {
  const pairs = Object.entries(knobs).map(([knobId, option]) => `${knobId}=${option}`);
  return pairs.length > 0 ? pairs.join("_") : "no_other_knobs";
}

/** The knob positions a tile offers at `full`, keyed by knob id. */
function offeredAt(/** @type {Preset} */ preset, /** @type {Record<string, string>} */ full) {
  return Object.fromEntries(knobsShown(preset, full).map((knob) => [String(knob.id), full[String(knob.id)]]));
}

// Every preset carrying a `material` knob, crossed with every combination of
// its other knobs. Selected by property from the shipped table; zero presets
// with the knob means zero cases here.

/** @type {[Preset, Record<string, string>][]} */
const CASES = presetsFor()
  .filter((preset) => preset.knobs.some((knob) => String(knob.id) === MATERIAL))
  .flatMap((preset) =>
    combos(preset.knobs.filter((knob) => String(knob.id) !== MATERIAL)).map(
      (c) => /** @type {[Preset, Record<string, string>]} */ ([preset, c]),
    ),
  );

// ============================================================================
// lossy writes one value to both PCM ends
// ============================================================================

for (const [preset, c] of CASES) {
  test(`test_${preset.id}_at_${positionsOf(c)}_with_${LOSSY}_material_writes_one_value_to_both_pcm_ends`, () => {
    const out = writeSet(preset.id, "pcm", { ...c, [MATERIAL]: LOSSY });
    assert.deepEqual(out, pcmBoth(out[PCM_1X]));
  });
}

// ============================================================================
// auto on lossy carries the pcm lossy value to all four keys
// ============================================================================

for (const [preset, c] of CASES) {
  test(`test_${preset.id}_at_${positionsOf(c)}_with_${LOSSY}_material_on_auto_writes_the_pcm_value_to_all_four_keys`, () => {
    const knobs = { ...c, [MATERIAL]: LOSSY };
    assert.deepEqual(writeSet(preset.id, "auto", knobs), everyChain(writeSet(preset.id, "pcm", knobs)[PCM_1X]));
  });
}

// ============================================================================
// the material knob rests at lossless
// ============================================================================

for (const [preset, c] of CASES) {
  test(`test_${preset.id}_at_${positionsOf(c)}_with_no_material_named_writes_what_${LOSSLESS}_writes`, () => {
    assert.deepEqual(writeSet(preset.id, "pcm", c), writeSet(preset.id, "pcm", { ...c, [MATERIAL]: LOSSLESS }));
  });
}

// ============================================================================
// the write reads back as the preset at those positions
// ============================================================================

for (const [preset, c] of CASES) {
  for (const material of [LOSSLESS, LOSSY]) {
    test(`test_matchpreset_recovers_${preset.id}_at_${positionsOf(c)}_with_${material}_material_on_auto`, () => {
      const full = { ...c, [MATERIAL]: material };
      assert.deepEqual(matchPreset(writeSet(preset.id, "auto", full), "auto"), {
        presetId: preset.id,
        knobs: offeredAt(preset, full),
      });
    });
  }
}
