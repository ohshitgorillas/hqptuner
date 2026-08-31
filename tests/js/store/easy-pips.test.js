// Behavioral suite for `pipsFor` (store/easycost.js): how a preset's cost in pips
// MOVES, per output mode and per knob. What a tile draws that many pips of is
// tests/js/components/easypips.test.js; this file is the rule the number obeys.
//
// WHAT IS NOT ASSERTED HERE, deliberately: any preset's actual count. The pip
// numbers are owner-tunable data, so `pipsFor("some-preset", "sdm") === 17`
// would assert only that a constant is that constant, and would go red on a
// retune where nothing is wrong (docs/testing.md rule 9). Every case below is
// therefore RELATIONAL: one call read against another call, or against zero.
//
// WHICH PRESET CARRIES WHICH KNOB, and what a knob position costs on a given
// preset, is owner data too. No case here names a preset beside a knob or a
// position: every per-preset case is a property sweep over `presetsFor()`, and
// the knob positions it compares are read from the knob's own `options`.
//
// The module is pure: no signals, no DOM, no network. Every case here is a
// plain call with a plain return value. Nothing is stubbed and nothing needs a
// fake (docs/testing.md rule 4 has nothing to bite on where there is no wire).
//
// WHICH PRESETS EXIST is asked of the shipped table through `presetsFor` rather
// than typed out, for the same reason: the roster is the owner's and a preset
// added or dropped is not a defect in this behavior. Knob ids ARE wire
// identifiers, so the one a rule filters on is stated outright.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy-pips.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { pipsFor } from "../../../hqptuner/static/store/easycost.js";
import { presetsFor } from "../../../hqptuner/static/store/easy.js";

/** @typedef {{ id: string, default: string, options: string[] }} Knob */
/** @typedef {{ id: string, emoji: string, knobs: Knob[], costText?: boolean }} Preset */

/** @type {Preset[]} */
const PRESETS = presetsFor();

const EMPHASIS = "emphasis";

// ============================================================================
// the auto output mode
// ============================================================================
//
// "auto" is the engine following the incoming rate rather than a third cost, and
// what it costs is what the PCM chain costs. Read as one call against the other:
// which number the two agree on is the owner's business, that they agree is the
// behavior.

// Every sweep in this file is generated from the shipped roster, so a roster
// that came back empty would generate no cases at all and take the rules with
// it, silently. This case is the sweeps' shared smoke alarm: it fails by name
// where the others would simply cease to exist.

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
// the emphasis knob costs nothing on the SDM chain
// ============================================================================
//
// Every preset carrying an emphasis knob costs the SAME on the SDM chain at
// every one of its positions: what the SDM chain costs does not turn on where
// the emphasis knob is parked. Which presets carry the knob, and which positions
// it offers, are read from the shipped table rather than typed, and every pair
// of positions is compared. A roster in which no preset carries the knob
// generates zero cases here by design; the smoke alarm at the top of the file
// covers an empty roster.

for (const preset of PRESETS) {
  const knob = preset.knobs.find((k) => k.id === EMPHASIS);
  if (!knob) continue;
  const positions = knob.options;
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      const a = positions[i];
      const b = positions[j];
      test(`test_${preset.id}_costs_the_same_on_the_sdm_chain_at_${a}_as_at_${b}`, () => {
        assert.equal(pipsFor(preset.id, "sdm", { [EMPHASIS]: a }), pipsFor(preset.id, "sdm", { [EMPHASIS]: b }));
      });
    }
  }
}
