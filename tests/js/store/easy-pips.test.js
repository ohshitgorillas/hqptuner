// Behavioral suite for `pipsFor` (store/easycost.js): the two rules a preset's
// cost in pips obeys that are not owner data. What a tile draws that many pips
// of is tests/js/components/easypips.test.js.
//
// WHAT IS NOT ASSERTED HERE, deliberately: any preset's actual count, or any
// relation between two counts of the table. The pip numbers are owner-tuned
// data, so `pipsFor("some-preset", "sdm") === 17` would assert only that a
// constant is that constant, and a claim that one knob or chain costs more or
// the same as another would pin the tuning just as hard and go red on a retune
// where nothing is wrong (docs/testing.md rule 9). The two rules below are the
// module's own, not the table's: the auto output mode is not a third cost, and
// an id off the table costs nothing.
//
// WHICH PRESETS EXIST, and which knob positions each defines, is asked of the
// shipped table through `presetsFor` rather than typed out: the roster is the
// owner's and a preset added or dropped is not a defect in this behavior. No
// case names a preset beside a knob or a position; the auto sweep walks every
// combination `combos` builds from each preset's own knobs, and the generated
// names carry the id and the positions so a failure says which cell broke.
//
// The module is pure: no signals, no DOM, no network. Every case here is a
// plain call with a plain return value. Nothing is stubbed and nothing needs a
// fake (docs/testing.md rule 4 has nothing to bite on where there is no wire).
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy-pips.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { pipsFor } from "../../../hqptuner/static/store/easycost.js";
import { presetsFor } from "../../../hqptuner/static/store/easy.js";
import { combos } from "../support/easytable.js";

/** @typedef {{ id: string, default: string, options: string[] }} Knob */
/** @typedef {{ id: string, emoji: string, knobs: Knob[], costText?: boolean }} Preset */

/** @type {Preset[]} */
const PRESETS = presetsFor();

/** A combination as `knob=option` pairs joined with `_`, for a test name. */
function positionsOf(/** @type {Record<string, string>} */ knobs) {
  const pairs = Object.entries(knobs).map(([knobId, option]) => `${knobId}=${option}`);
  return pairs.length === 0 ? "no_knobs" : pairs.join("_");
}

// ============================================================================
// the roster guard
// ============================================================================
//
// Every sweep in this file is generated from the shipped roster, so a roster
// that came back empty would generate no cases at all and take the rules with
// it, silently. This case is the sweeps' shared smoke alarm: it fails by name
// where the others would simply cease to exist.

test("test_the_shipped_table_names_at_least_one_preset_for_the_per_preset_sweeps", () => {
  assert.ok(PRESETS.length > 0, "presetsFor() named no presets, so every per-preset sweep below generated nothing");
});

// ============================================================================
// the auto output mode
// ============================================================================
//
// "auto" is the engine following the incoming rate rather than a third cost, and
// what it costs is what the PCM chain costs. Read as one call against the other
// at every preset and every combination of its knob positions: which number the
// two agree on is the owner's business, that they agree everywhere is the
// behavior.

for (const preset of PRESETS) {
  for (const c of combos(preset.knobs)) {
    test(`test_${preset.id}_at_${positionsOf(c)}_costs_its_pcm_pips_under_the_auto_output_mode`, () => {
      assert.equal(pipsFor(preset.id, "auto", c), pipsFor(preset.id, "pcm", c));
    });
  }
}

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
