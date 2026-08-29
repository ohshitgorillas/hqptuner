// Behavioral suite for `pipsFor` (store/easy.js): how many pips a preset costs,
// per output mode. The number is what a tile draws that many pips of
// (tests/js/components/easypips.test.js); this file is the number itself.
//
// The module is pure — no signals, no DOM, no network — so every case here is a
// plain call with a plain return value. Nothing is stubbed and nothing needs a
// fake (docs/testing.md rule 4 has nothing to bite on where there is no wire).
//
// Preset ids and output modes are wire identifiers and are stated outright; the
// numbers are the behavior. No word of copy is read anywhere in this file
// (rule 9).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy-pips.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { pipsFor } from "../../../hqptuner/static/store/easy.js";

// preset, SDM count, PCM count.
/** @type {[string, number, number][]} */
const COSTS = [
  ["perfect-ten", 2, 1],
  ["lifelike", 2, 1],
  ["purist", 2, 1],
  ["old-school", 1, 1],
  ["damage-control", 1, 3],
  ["concert-hall", 13, 6],
];

// ============================================================================
// the two output modes
// ============================================================================
//
// One case per preset per mode, so a table that got one row wrong fails by
// naming the preset and the chain rather than by a count that could be any of
// the twelve.

for (const [presetId, sdm] of COSTS) {
  test(`test_${presetId}_costs_${sdm}_pips_on_the_sdm_chain`, () => {
    assert.equal(pipsFor(presetId, "sdm"), sdm);
  });
}

for (const [presetId, , pcm] of COSTS) {
  test(`test_${presetId}_costs_${pcm}_pips_on_the_pcm_chain`, () => {
    assert.equal(pipsFor(presetId, "pcm"), pcm);
  });
}

// ============================================================================
// the auto output mode
// ============================================================================
//
// "auto" is the engine following the incoming rate rather than a third cost, and what
// a tile shows there is the PCM number. Read against the number outright, never
// against a second `pipsFor` call on "pcm" — that would only ask the module to
// agree with itself, and would pass on a module answering the same wrong number
// to both.

for (const [presetId, , pcm] of COSTS) {
  test(`test_${presetId}_costs_its_pcm_pips_under_the_auto_output_mode`, () => {
    assert.equal(pipsFor(presetId, "auto"), pcm);
  });
}
