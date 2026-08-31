// Behavioral suite for the two flagship presets' knobs — `emphasis` and
// `material`, crossed — and for what each of the four combinations writes.
//
// This file replaces the Source knob's, which the revision retired outright:
// there is no `source` knob anywhere in the feature and no `auto`, `standard` or
// `hires` position. What stands in its place on The Perfect Ten and Lifelike is
// the same `material` knob Damage Control carries, and its two positions pick
// the SHAPE of the write:
//
//   * `lossless` writes a PAIR — the standard filter at 1x, the hi-res one at Nx
//     — so the engine picks per rate rather than the user picking once.
//   * `lossy` writes the hi-res filter to BOTH ends, there being nothing at 1x
//     worth spending on material that has already been thrown away.
//
// So the two positions are read as two different shapes and not merely as two
// names, and every case states both knob positions: a table that ignored the
// knob it was handed would otherwise pass by landing on the resting pair.
//
// The companion files are tests/js/store/easy.test.js, which owns the rest of
// the curated table, and tests/js/store/easy-damage-control.test.js, which owns
// the third tile carrying this knob. What the two flagships COST is unchanged by
// either position and is pinned in tests/js/store/easy-pips.test.js.
//
// Anchored on schema keys and filter names, both wire identifiers — nothing here
// reads a word of copy (docs/testing.md rule 9), which matters for this knob in
// particular: it ships no label and no position words yet.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy-material.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { writeSet, matchPreset } from "../../../hqptuner/static/store/easy.js";

const PCM_1X = "pcm_filter_1x";
const PCM_NX = "pcm_filter_nx";

/** @param {string} oneX @param {string} nX */
const pcmPair = (oneX, nX) => ({ [PCM_1X]: oneX, [PCM_NX]: nX });

/** @param {string} name */
const pcmBoth = (name) => pcmPair(name, name);

// ============================================================================
// what each combination of the two knobs writes
// ============================================================================
//
// Filter names are owner data (docs/testing.md rule 9), so the SHAPE is pinned
// and the names are not: lossless is two different values, lossy is the
// lossless Nx value on both ends. Read on the PCM chain; neither preset defines
// a `-2s` variant, which tests/js/store/easy.test.js pins as its own control.

/** @type {[string, string, string][]} */
const WRITES = [
  ["perfect-ten", "space", "lossless"],
  ["perfect-ten", "transients", "lossless"],
  ["perfect-ten", "space", "lossy"],
  ["perfect-ten", "transients", "lossy"],
  ["lifelike", "space", "lossless"],
  ["lifelike", "transients", "lossless"],
  ["lifelike", "space", "lossy"],
  ["lifelike", "transients", "lossy"],
];

for (const [presetId, emphasis, material] of WRITES) {
  if (material === "lossless") {
    test(`test_${presetId}_on_${emphasis}_with_lossless_material_writes_two_different_filters_to_the_pcm_chain`, () => {
      const out = writeSet(presetId, "pcm", { emphasis, material });
      assert.notEqual(out[PCM_1X], out[PCM_NX]);
    });
  } else {
    test(`test_${presetId}_on_${emphasis}_with_lossy_material_writes_the_lossless_nx_filter_to_both_pcm_ends`, () => {
      const lossless = writeSet(presetId, "pcm", { emphasis, material: "lossless" });
      assert.deepEqual(writeSet(presetId, "pcm", { emphasis, material }), pcmBoth(lossless[PCM_NX]));
    });
  }
}

// ============================================================================
// where the material knob rests
// ============================================================================
//
// A call naming the emphasis and leaving the material out answers with the
// lossless pair, so `lossless` is where a fresh tile stands — the position that
// keeps what the user has. Read against the explicit lossless call at the same
// emphasis. One case per preset, because each names its own family's pair.

test("test_a_perfect_ten_call_that_names_no_material_writes_what_lossless_writes", () => {
  assert.deepEqual(
    writeSet("perfect-ten", "pcm", { emphasis: "space" }),
    writeSet("perfect-ten", "pcm", { emphasis: "space", material: "lossless" }),
  );
});

test("test_a_lifelike_call_that_names_no_material_writes_what_lossless_writes", () => {
  assert.deepEqual(
    writeSet("lifelike", "pcm", { emphasis: "space" }),
    writeSet("lifelike", "pcm", { emphasis: "space", material: "lossless" }),
  );
});

// ============================================================================
// and those names read back as that preset at those positions
// ============================================================================
//
// The round trip: the values `writeSet` produced are fed to `matchPreset`, which
// is what lights the tile and puts its two knobs where the fields say they
// stand. Both knobs are named in every row, so the expected map is unambiguous.

for (const [presetId, emphasis, material] of WRITES) {
  test(`test_matchpreset_recovers_${presetId}_on_${emphasis}_with_${material}_material`, () => {
    const knobs = { emphasis, material };
    assert.deepEqual(matchPreset(writeSet(presetId, "pcm", knobs), "pcm"), { presetId, knobs });
  });
}

// ============================================================================
// and on the auto chain the lossy shape reaches all four fields
// ============================================================================
//
// The rows above are read on the PCM chain alone, which pins the two PCM keys
// and says nothing about the SDM pair: a table that dropped or misnamed
// `sdm_filter_1x` / `sdm_filter_nx` at `lossy` would satisfy every one of them.
// Read in `auto`, the output mode that writes both chains at once, so the shape
// of the write is read where it is widest — one hi-res name on all four fields,
// there being nothing at 1x worth spending on material already thrown away.

const SDM_1X = "sdm_filter_1x";
const SDM_NX = "sdm_filter_nx";

/** @param {string} name One filter name on both ends of both chains. */
const everyChain = (name) => ({ [PCM_1X]: name, [PCM_NX]: name, [SDM_1X]: name, [SDM_NX]: name });

/** @type {[string, string][]} */
const LOSSY_ON_AUTO = [
  ["perfect-ten", "space"],
  ["perfect-ten", "transients"],
  ["lifelike", "space"],
  ["lifelike", "transients"],
];

for (const [presetId, emphasis] of LOSSY_ON_AUTO) {
  test(`test_${presetId}_on_${emphasis}_with_lossy_material_writes_one_filter_to_all_four_fields`, () => {
    const out = writeSet(presetId, "auto", { emphasis, material: "lossy" });
    assert.deepEqual(out, everyChain(out[PCM_1X]));
  });
}
