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
// The owner's table, stated outright: filter names are wire identifiers and
// deriving them from anything would only ask the table to agree with itself.
// Read on the PCM chain, where the plain names live; neither preset defines a
// `-2s` variant, which tests/js/store/easy.test.js pins as its own control.

/** @type {[string, string, string, Record<string, string>][]} */
const WRITES = [
  ["perfect-ten", "space", "lossless", pcmPair("poly-sinc-gauss-long", "poly-sinc-gauss-hires-lp")],
  ["perfect-ten", "transients", "lossless", pcmPair("poly-sinc-gauss-medium", "poly-sinc-gauss-hires-mp")],
  ["perfect-ten", "space", "lossy", pcmBoth("poly-sinc-gauss-hires-lp")],
  ["perfect-ten", "transients", "lossy", pcmBoth("poly-sinc-gauss-hires-mp")],
  ["lifelike", "space", "lossless", pcmPair("poly-sinc-ext2-long", "poly-sinc-ext2-hires-lp")],
  ["lifelike", "transients", "lossless", pcmPair("poly-sinc-ext2-medium", "poly-sinc-ext2-hires-mp")],
  ["lifelike", "space", "lossy", pcmBoth("poly-sinc-ext2-hires-lp")],
  ["lifelike", "transients", "lossy", pcmBoth("poly-sinc-ext2-hires-mp")],
];

for (const [presetId, emphasis, material, expected] of WRITES) {
  test(`test_${presetId}_on_${emphasis}_with_${material}_material_writes_that_pair_to_the_pcm_chain`, () => {
    assert.deepEqual(writeSet(presetId, "pcm", { emphasis, material }), expected);
  });
}

// ============================================================================
// where the material knob rests
// ============================================================================
//
// A call naming the emphasis and leaving the material out answers with the
// lossless pair, so `lossless` is where a fresh tile stands — the position that
// keeps what the user has. Read against the pair outright rather than against a
// second `writeSet` call, which would only ask the module to agree with itself.
// One case per preset, because each names its own family's pair.

test("test_a_perfect_ten_call_that_names_no_material_writes_the_lossless_pair", () => {
  assert.deepEqual(
    writeSet("perfect-ten", "pcm", { emphasis: "space" }),
    pcmPair("poly-sinc-gauss-long", "poly-sinc-gauss-hires-lp"),
  );
});

test("test_a_lifelike_call_that_names_no_material_writes_the_lossless_pair", () => {
  assert.deepEqual(
    writeSet("lifelike", "pcm", { emphasis: "space" }),
    pcmPair("poly-sinc-ext2-long", "poly-sinc-ext2-hires-lp"),
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
