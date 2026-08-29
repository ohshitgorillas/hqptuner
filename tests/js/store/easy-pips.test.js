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
  ["concert-hall", 16, 8],
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

// ============================================================================
// error correction off costs one pip less
// ============================================================================
//
// `correction` is a knob only The Concert Hall carries, and parking it at "off"
// takes the preset off one pip on whichever chain is asked. The knob id and the
// position are wire identifiers, so they are stated outright; the numbers are
// the behavior and are stated outright too, never derived by subtracting one
// from a second `pipsFor` call — that would only ask the module to agree with
// itself and would pass on a module answering the wrong pair to both.

const CORRECTION_OFF = { correction: "off" };

test("test_the_concert_hall_costs_15_pips_on_the_sdm_chain_with_error_correction_off", () => {
  assert.equal(pipsFor("concert-hall", "sdm", CORRECTION_OFF), 15);
});

test("test_the_concert_hall_costs_7_pips_on_the_pcm_chain_with_error_correction_off", () => {
  assert.equal(pipsFor("concert-hall", "pcm", CORRECTION_OFF), 7);
});

// The auto output mode follows the PCM number here as it does everywhere else,
// so the discount reaches it too.

test("test_the_concert_hall_costs_its_discounted_pcm_pips_under_auto_with_error_correction_off", () => {
  assert.equal(pipsFor("concert-hall", "auto", CORRECTION_OFF), 7);
});

// ============================================================================
// what the emphasis knob costs
// ============================================================================
//
// Where a preset's emphasis knob picks a filter LENGTH, the space position costs
// one pip more than transients: The Perfect Ten, Lifelike and The Purist. Old
// School and Damage Control move between linear and minimum phase instead, the
// same work either way, so they answer the same in both positions, and The
// Concert Hall carries no emphasis knob and is named nowhere in this section.
//
// The transients figures are the table figures above, which is what makes the
// two halves worth stating separately: a module adding its pip to the wrong
// position passes every case at one position and fails at the other.
//
// preset, then the SDM and PCM counts at transients and the SDM and PCM counts
// at space. Every figure is stated outright rather than derived by adding one to
// its neighbour: a test that computes the space number from the transients
// number is only restating the rule it is meant to check, and passes on a module
// that adds its pip to the wrong preset AND states the wrong base.
/** @type {[string, number, number, number, number][]} */
const EMPHASIS = [
  ["perfect-ten", 2, 1, 3, 2],
  ["lifelike", 2, 1, 3, 2],
  ["purist", 2, 1, 3, 2],
  ["old-school", 1, 1, 1, 1],
  ["damage-control", 1, 3, 1, 3],
];

const TRANSIENTS = { emphasis: "transients" };
const SPACE = { emphasis: "space" };

for (const [presetId, sdm] of EMPHASIS) {
  test(`test_${presetId}_costs_${sdm}_pips_on_the_sdm_chain_with_transients_emphasis`, () => {
    assert.equal(pipsFor(presetId, "sdm", TRANSIENTS), sdm);
  });
}

for (const [presetId, , pcm] of EMPHASIS) {
  test(`test_${presetId}_costs_${pcm}_pips_on_the_pcm_chain_with_transients_emphasis`, () => {
    assert.equal(pipsFor(presetId, "pcm", TRANSIENTS), pcm);
  });
}

for (const [presetId, , , sdm] of EMPHASIS) {
  test(`test_${presetId}_costs_${sdm}_pips_on_the_sdm_chain_with_space_emphasis`, () => {
    assert.equal(pipsFor(presetId, "sdm", SPACE), sdm);
  });
}

for (const [presetId, , , , pcm] of EMPHASIS) {
  test(`test_${presetId}_costs_${pcm}_pips_on_the_pcm_chain_with_space_emphasis`, () => {
    assert.equal(pipsFor(presetId, "pcm", SPACE), pcm);
  });
}
