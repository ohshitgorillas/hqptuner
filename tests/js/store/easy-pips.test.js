// Behavioral suite for `pipsFor` (store/easy.js): how many pips a preset costs,
// per output mode. The number is what a tile draws that many pips of
// (tests/js/components/easypips.test.js); this file is the number itself.
//
// The module is pure — no signals, no DOM, no network — so every case here is a
// plain call with a plain return value. Nothing is stubbed and nothing needs a
// fake (docs/testing.md rule 4 has nothing to bite on where there is no wire).
//
// WHICH KNOBS MOVE THE NUMBER, and on which chain. The SDM chain answers ONE
// number per preset and the only knob that moves it is `correction`, the knob
// The Concert Hall alone carries: emphasis does not move it, material does not
// move it. The PCM chain is where the emphasis knob costs something, and only on
// the three presets whose emphasis picks a filter LENGTH; `material` moves the
// PCM number on Damage Control, and `correction` moves the PCM number on The
// Concert Hall.
//
// Preset ids, knob ids and output modes are wire identifiers and are stated
// outright; the numbers are the behavior. No word of copy is read anywhere in
// this file (rule 9).
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
  ["concert-hall", 17, 8],
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
// a preset the module does not carry
// ============================================================================
//
// An id off the table is not an error and not a guess: it costs nothing, on
// whichever chain it is asked about.

const NO_SUCH_PRESET = "no-such-preset";

test("test_a_preset_the_module_does_not_carry_costs_0_pips_on_the_sdm_chain", () => {
  assert.equal(pipsFor(NO_SUCH_PRESET, "sdm"), 0);
});

test("test_a_preset_the_module_does_not_carry_costs_0_pips_on_the_pcm_chain", () => {
  assert.equal(pipsFor(NO_SUCH_PRESET, "pcm"), 0);
});

test("test_a_preset_the_module_does_not_carry_costs_0_pips_under_the_auto_output_mode", () => {
  assert.equal(pipsFor(NO_SUCH_PRESET, "auto"), 0);
});

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

test("test_the_concert_hall_costs_16_pips_on_the_sdm_chain_with_error_correction_off", () => {
  assert.equal(pipsFor("concert-hall", "sdm", CORRECTION_OFF), 16);
});

test("test_the_concert_hall_costs_7_pips_on_the_pcm_chain_with_error_correction_off", () => {
  assert.equal(pipsFor("concert-hall", "pcm", CORRECTION_OFF), 7);
});

// The auto output mode follows the PCM number here as it does everywhere else,
// so the discount reaches it too.

test("test_the_concert_hall_costs_its_discounted_pcm_pips_under_auto_with_error_correction_off", () => {
  assert.equal(pipsFor("concert-hall", "auto", CORRECTION_OFF), 7);
});

const TRANSIENTS = { emphasis: "transients" };
const SPACE = { emphasis: "space" };

// ============================================================================
// the emphasis knob costs nothing on the SDM chain
// ============================================================================
//
// Every preset carrying an emphasis knob answers the SAME number at both of its
// positions on the SDM chain, length-picking presets included: what the SDM
// chain costs does not turn on where the emphasis knob is parked. Read at both
// positions rather than compared against each other, so a module answering one
// wrong number to both positions fails rather than agreeing with itself.
//
// The Concert Hall carries no emphasis knob and is named nowhere in this
// section.
//
// preset, then the number it costs on the SDM chain at EITHER position.
/** @type {[string, number][]} */
const SDM_EMPHASIS = [
  ["perfect-ten", 2],
  ["lifelike", 2],
  ["purist", 2],
  ["old-school", 1],
  ["damage-control", 1],
];

for (const [presetId, sdm] of SDM_EMPHASIS) {
  test(`test_${presetId}_costs_${sdm}_pips_on_the_sdm_chain_with_transients_emphasis`, () => {
    assert.equal(pipsFor(presetId, "sdm", TRANSIENTS), sdm);
  });
}

for (const [presetId, sdm] of SDM_EMPHASIS) {
  test(`test_${presetId}_costs_the_same_${sdm}_pips_on_the_sdm_chain_with_space_emphasis`, () => {
    assert.equal(pipsFor(presetId, "sdm", SPACE), sdm);
  });
}

// ============================================================================
// what the emphasis knob costs on the PCM chain
// ============================================================================
//
// On the PCM chain, and only there, the space position of a LENGTH-picking
// emphasis knob costs one pip more than transients: The Perfect Ten, Lifelike
// and The Purist.
//
// Every figure is stated outright rather than derived by adding one to its
// neighbour: a test that computes the space number from the transients number is
// only restating the rule it is meant to check, and passes on a module that adds
// its pip to the wrong preset AND states the wrong base.
//
// preset, the PCM count at transients, the PCM count at space.
/** @type {[string, number, number][]} */
const PCM_EMPHASIS = [
  ["perfect-ten", 1, 2],
  ["lifelike", 1, 2],
  ["purist", 1, 2],
];

for (const [presetId, transients] of PCM_EMPHASIS) {
  test(`test_${presetId}_costs_${transients}_pips_on_the_pcm_chain_with_transients_emphasis`, () => {
    assert.equal(pipsFor(presetId, "pcm", TRANSIENTS), transients);
  });
}

for (const [presetId, , space] of PCM_EMPHASIS) {
  test(`test_${presetId}_costs_${space}_pips_on_the_pcm_chain_with_space_emphasis`, () => {
    assert.equal(pipsFor(presetId, "pcm", SPACE), space);
  });
}

// Old School and Damage Control move between linear and minimum phase instead of
// between lengths, the same work either way, so the PCM chain costs them what it
// costs them wherever their emphasis knob is parked. Read at the position each
// one RESTS on — Old School at transients, Damage Control at space — which is
// the position a tile of theirs passes when nothing has been touched.

test("test_old-school_costs_1_pips_on_the_pcm_chain_with_transients_emphasis", () => {
  assert.equal(pipsFor("old-school", "pcm", TRANSIENTS), 1);
});

test("test_damage-control_costs_3_pips_on_the_pcm_chain_with_space_emphasis", () => {
  assert.equal(pipsFor("damage-control", "pcm", SPACE), 3);
});

// ============================================================================
// what the material knob costs
// ============================================================================
//
// `material` is Damage Control's knob, and it moves the PCM number only: lossy
// material is three pips cheaper to repair than lossless there, while the SDM
// chain costs the same one pip whichever material is on record. Both material
// positions are wire identifiers and are stated outright, and both numbers are
// stated outright rather than read off a second call.

const LOSSLESS = { material: "lossless" };
const LOSSY = { material: "lossy" };

test("test_damage-control_costs_1_pips_on_the_sdm_chain_with_lossless_material", () => {
  assert.equal(pipsFor("damage-control", "sdm", LOSSLESS), 1);
});

test("test_damage-control_costs_the_same_1_pips_on_the_sdm_chain_with_lossy_material", () => {
  assert.equal(pipsFor("damage-control", "sdm", LOSSY), 1);
});

test("test_damage-control_costs_3_pips_on_the_pcm_chain_with_lossless_material", () => {
  assert.equal(pipsFor("damage-control", "pcm", LOSSLESS), 3);
});

test("test_damage-control_costs_1_pips_on_the_pcm_chain_with_lossy_material", () => {
  assert.equal(pipsFor("damage-control", "pcm", LOSSY), 1);
});
