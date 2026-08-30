// Behavioral suite for `pipsFor` (store/easy.js): how a preset's cost in pips
// MOVES, per output mode and per knob. What a tile draws that many pips of is
// tests/js/components/easypips.test.js; this file is the rule the number obeys.
//
// WHAT IS NOT ASSERTED HERE, deliberately: any preset's actual count. The pip
// numbers are owner-tunable data — The Concert Hall went from sixteen to
// seventeen because the owner said so, with nothing about this module's
// behavior changed — so `pipsFor("concert-hall", "sdm") === 17` would assert
// only that a constant is that constant, and would go red on a retune where
// nothing is wrong (docs/testing.md rule 9). Every case below is therefore
// RELATIONAL: one call read against another call, or against zero.
//
// WHICH KNOBS MOVE THE NUMBER, and on which chain. The SDM chain answers one
// number per preset and the only knob that moves it is `correction`, the knob
// The Concert Hall alone carries: emphasis does not move it, material does not
// move it. The PCM chain is where the emphasis knob costs something, and only on
// the three presets whose emphasis picks a filter LENGTH; `material` moves the
// PCM number on Damage Control, and `correction` moves the PCM number on The
// Concert Hall.
//
// The module is pure — no signals, no DOM, no network — so every case here is a
// plain call with a plain return value. Nothing is stubbed and nothing needs a
// fake (docs/testing.md rule 4 has nothing to bite on where there is no wire).
//
// WHICH PRESETS EXIST is asked of the shipped table through `presetsFor` rather
// than typed out, for the same reason: the roster is the owner's and a preset
// added or dropped is not a defect in this behavior. Preset ids, knob ids and
// knob positions ARE wire identifiers, so the ones a single rule names are
// stated outright.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy-pips.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { pipsFor, presetsFor } from "../../../hqptuner/static/store/easy.js";

/** @typedef {{ id: string, default: string, options: string[] }} Knob */
/** @typedef {{ id: string, emoji: string, knobs: Knob[], costText?: boolean }} Preset */

/** @type {Preset[]} */
const PRESETS = presetsFor();

const EMPHASIS = "emphasis";
const TRANSIENTS = { emphasis: "transients" };
const SPACE = { emphasis: "space" };
const LOSSLESS = { material: "lossless" };
const LOSSY = { material: "lossy" };
const CORRECTION_ON = { correction: "on" };
const CORRECTION_OFF = { correction: "off" };

/** @type {(preset: Preset, knobId: string) => boolean} */
const carries = (preset, knobId) => preset.knobs.some((knob) => knob.id === knobId);

// ============================================================================
// the auto output mode
// ============================================================================
//
// "auto" is the engine following the incoming rate rather than a third cost, and
// what it costs is what the PCM chain costs. Read as one call against the other:
// which number the two agree on is the owner's business, that they agree is the
// behavior.

// The sweep is generated from the shipped roster, so a roster that came back
// empty would generate no cases at all and take the rule with it, silently. This
// case is the sweep's own smoke alarm: it fails by name where the others would
// simply cease to exist.

test("test_the_shipped_table_names_at_least_one_preset_for_the_per_preset_sweeps", () => {
  assert.ok(PRESETS.length > 0, "presetsFor() named no presets, so every per-preset sweep below generated nothing");
});

for (const preset of PRESETS) {
  test(`test_${preset.id}_costs_its_pcm_pips_under_the_auto_output_mode`, () => {
    assert.equal(pipsFor(preset.id, "auto"), pipsFor(preset.id, "pcm"));
  });
}

// Every case above reads the auto chain against the PCM chain, and all of them
// would pass against a module that ignored the output mode and answered one
// number per preset. What rules that out is that the two chains are not the same
// chain: SOME preset costs a different number on SDM than on PCM. Which preset,
// and by how much, is the owner's to retune, so the case names neither.

test("test_at_least_one_preset_costs_a_different_number_on_the_sdm_chain_than_on_the_pcm_chain", () => {
  assert.ok(
    PRESETS.some((preset) => pipsFor(preset.id, "sdm") !== pipsFor(preset.id, "pcm")),
    "every preset costs the same on both chains, so nothing here would notice a module ignoring the output mode",
  );
});

// ============================================================================
// a preset the module does not carry
// ============================================================================
//
// An id off the table is not an error and not a guess: it costs nothing, on
// whichever chain it is asked about. Zero is the absence rule rather than a
// table value, so it is the one number stated as a literal in this file.

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
// takes the preset off exactly one pip on whichever chain is asked. Read as the
// DIFFERENCE between the two positions, so a retune of the preset's cost leaves
// both sides moving together and the rule still stated.
//
// The knob id and both positions are wire identifiers and are stated outright.
//
// THE FLOOR. The discount cannot take a carried preset to nothing. `pipsFor` is
// a pure function over an arbitrary knobs record, so asking it what the CHEAPEST
// preset would cost with the correction knob off is a legal public call, and it
// is where the floor is reachable — the discount has the least room there.
//
// Read against the answer for a preset the module does not carry, which is what
// "costs nothing" is worth on this surface: a preset the table DOES name still
// costs more than that, discount or no discount. Neither count is named, and
// which preset is the cheapest is asked of the module rather than typed.

const HALL = "concert-hall";

/**
 * The id of the preset costing the FEWEST pips on a chain, asked of the module
 * rather than typed: which preset sits at the bottom of the card is the owner's
 * to retune, and the floor case only needs whichever one does. Presets marked
 * `costText` are excluded on their declared property: their cost row is a text
 * caption rather than pips, `pipsFor` answers 0 for them by design, and the
 * floor rule is only stated for presets that cost pips at all. Filtering on
 * `pipsFor(...) > 0` instead would assume the very invariant under test.
 *
 * @param {string} mode
 * @returns {string}
 */
const cheapestOn = (mode) =>
  PRESETS.filter((p) => !p.costText)
    .map((p) => p.id)
    .reduce((a, b) => (pipsFor(a, mode) <= pipsFor(b, mode) ? a : b));

test("test_error_correction_off_still_leaves_the_cheapest_preset_costing_more_than_a_preset_the_module_does_not_carry_on_the_sdm_chain", () => {
  assert.ok(pipsFor(cheapestOn("sdm"), "sdm", CORRECTION_OFF) > pipsFor(NO_SUCH_PRESET, "sdm"));
});

test("test_error_correction_off_still_leaves_the_cheapest_preset_costing_more_than_a_preset_the_module_does_not_carry_on_the_pcm_chain", () => {
  assert.ok(pipsFor(cheapestOn("pcm"), "pcm", CORRECTION_OFF) > pipsFor(NO_SUCH_PRESET, "pcm"));
});

test("test_error_correction_off_costs_the_concert_hall_one_pip_less_on_the_sdm_chain", () => {
  assert.equal(pipsFor(HALL, "sdm", CORRECTION_OFF), pipsFor(HALL, "sdm", CORRECTION_ON) - 1);
});

test("test_error_correction_off_costs_the_concert_hall_one_pip_less_on_the_pcm_chain", () => {
  assert.equal(pipsFor(HALL, "pcm", CORRECTION_OFF), pipsFor(HALL, "pcm", CORRECTION_ON) - 1);
});

// ============================================================================
// the emphasis knob costs nothing on the SDM chain
// ============================================================================
//
// Every preset carrying an emphasis knob costs the SAME on the SDM chain at both
// of its positions, length-picking presets included: what the SDM chain costs
// does not turn on where the emphasis knob is parked. The Concert Hall carries
// no emphasis knob and is swept out by the filter rather than named.

const EMPHASIS_PRESETS = PRESETS.filter((p) => carries(p, EMPHASIS));

// The sweep is generated by a filter on a knob id, so a renamed knob or a
// reshaped roster would empty it and retire the rule without turning anything
// red. This case fails by name when that happens.

test("test_at_least_one_shipped_preset_carries_an_emphasis_knob", () => {
  assert.ok(EMPHASIS_PRESETS.length > 0, "no preset carries an emphasis knob, so the sweep below generated nothing");
});

for (const preset of EMPHASIS_PRESETS) {
  test(`test_${preset.id}_costs_the_same_on_the_sdm_chain_at_space_as_at_transients`, () => {
    assert.equal(pipsFor(preset.id, "sdm", SPACE), pipsFor(preset.id, "sdm", TRANSIENTS));
  });
}

// ============================================================================
// what the emphasis knob costs on the PCM chain
// ============================================================================
//
// On the PCM chain, and only there, the space position of a LENGTH-picking
// emphasis knob costs exactly one pip more than transients: The Perfect Ten,
// Lifelike and The Purist. Read as the difference, never as a pair of numbers.

for (const presetId of ["perfect-ten", "lifelike", "purist"]) {
  test(`test_${presetId}_costs_one_more_pip_on_the_pcm_chain_at_space_than_at_transients`, () => {
    assert.equal(pipsFor(presetId, "pcm", SPACE), pipsFor(presetId, "pcm", TRANSIENTS) + 1);
  });
}

// Old School and Damage Control move between linear and minimum phase instead of
// between lengths, the same work either way, so their PCM cost does not move
// with the knob at all.

for (const presetId of ["old-school", "damage-control"]) {
  test(`test_${presetId}_costs_the_same_on_the_pcm_chain_at_space_as_at_transients`, () => {
    assert.equal(pipsFor(presetId, "pcm", SPACE), pipsFor(presetId, "pcm", TRANSIENTS));
  });
}

// ============================================================================
// what the material knob costs
// ============================================================================
//
// `material` is Damage Control's knob and it moves the PCM number alone: the two
// materials are not the same amount of repair work there, while the SDM chain
// costs the same whichever material is on record. The PCM case reads that the
// knob still BITES without saying what either number is — which of them is the
// larger, and by how much, is the owner's to retune.

const DAMAGE = "damage-control";

test("test_damage_control_costs_the_same_on_the_sdm_chain_with_lossy_material_as_with_lossless", () => {
  assert.equal(pipsFor(DAMAGE, "sdm", LOSSY), pipsFor(DAMAGE, "sdm", LOSSLESS));
});

test("test_damage_control_costs_a_different_number_on_the_pcm_chain_with_lossy_material_than_with_lossless", () => {
  assert.notEqual(pipsFor(DAMAGE, "pcm", LOSSY), pipsFor(DAMAGE, "pcm", LOSSLESS));
});
