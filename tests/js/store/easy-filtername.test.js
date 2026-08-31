// Behavioral suite for `filterFor` (store/easy.js): the engine filter NAME an
// Easy Mode tile displays for a preset, an output mode, a set of knob positions
// and a side of the chain.
//
// The module is pure, with no signals, no DOM and no network, so every case here
// is a plain call with a plain return value. Nothing is stubbed and nothing needs
// a fake (docs/testing.md rule 4 has nothing to bite on where there is no wire).
//
// THE CONTRACT. `filterFor(p, mode, knobs, nx)` equals `writeSet(p, mode, knobs)`
// read at one key: the chain is `sdm` when the mode is `"sdm"` and `pcm`
// otherwise (`auto` writes both chains and the tile names the PCM one), the end
// is `nx` when `nx` is true and `1x` otherwise, and the key is
// `<chain>_filter_<end>`. An id the table does not carry names nothing, and the
// answer is the empty string rather than a null, an undefined or a throw, since
// a tile hands it straight to a renderer.
//
// WHAT IS ASSERTED (rule 5, rule 9). Which FIELD of the preset's write set the
// tile names, never the filter name itself: which filter a preset carries is
// owner-curated data, so every expectation is read back from `writeSet` on the
// same preset, mode and knobs, and no name literal stands in an assertion.
//
// NO EXEMPLARS. No preset is named here to stand for a property (a split pair,
// a single filter on both ends, a chain that differs by mode). The sweep runs
// every preset `presetsFor()` declares, every knob combination `combos` derives
// from that preset's own knobs, all three modes and both sides, so whichever
// preset happens to carry a property is covered without this file knowing which
// one it is, and the file survives the owner curating the table. One guard pins
// that the roster is non-empty, since an empty roster would generate no cases
// and the sweep would pass vacuously.
//
// The module is imported under a BUILT specifier so a checkout that predates
// the change fails per-case rather than at module link, the convention
// tests/js/store/plainnames-truename.test.js settled.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/easy-filtername.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { combos } from "../support/easytable.js";

const MOD = new URL("../../../hqptuner/static/store/easy.js", import.meta.url).href;
const easy = await import(`${MOD}`);

/** @typedef {{ id: string, default: string, options: string[] }} Knob */
/** @typedef {{ id: string, knobs: Knob[] }} Preset */

// The three output modes a tile can be asked in, and the chain each names.
/** @type {[string, string][]} */
const MODES = [
  ["pcm", "pcm"],
  ["sdm", "sdm"],
  ["auto", "pcm"],
];

// The two ends of the chain: the `nx` argument, and the end it selects.
/** @type {[boolean, string][]} */
const SIDES = [
  [false, "1x"],
  [true, "nx"],
];

// A preset id no curated table carries. Deliberately not a near-miss of a real
// one: what is under test is the answer for an id the table does not know, not
// how a typo resolves.
const UNKNOWN = "no-such-preset-in-the-table";

/**
 * A test-name fragment for one set of knob positions, stable across runs.
 * @param {Record<string, string>} knobs
 */
const positions = (knobs) =>
  Object.keys(knobs)
    .sort()
    .map((k) => `${k}_${knobs[k]}`)
    .join("_") || "no_knobs";

// ============================================================================
// the roster is not empty
// ============================================================================

test("test_the_table_declares_at_least_one_preset", () => {
  assert.ok(easy.presetsFor().length > 0);
});

// ============================================================================
// every preset, every knob combination, every mode, both sides
// ============================================================================

for (const preset of /** @type {Preset[]} */ (easy.presetsFor())) {
  for (const knobs of combos(preset.knobs)) {
    for (const [mode, chain] of MODES) {
      for (const [nx, end] of SIDES) {
        const key = `${chain}_filter_${end}`;
        test(`test_${preset.id}_at_${positions(knobs)}_in_${mode}_mode_names_the_${key}_field_on_the_${end}_side`, () => {
          assert.equal(easy.filterFor(preset.id, mode, knobs, nx), easy.writeSet(preset.id, mode, knobs)[key]);
        });
      }
    }
  }
}

// ============================================================================
// nothing to name
// ============================================================================

test("test_a_preset_the_table_does_not_carry_names_nothing", () => {
  assert.equal(easy.filterFor(UNKNOWN, "pcm", {}, false), "");
});
