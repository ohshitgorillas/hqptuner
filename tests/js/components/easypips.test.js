// Behavioral suite for the PIP GROUP an Easy Mode preset tile carries: the row
// of marks standing for what that preset costs the machine. How many pips each
// preset costs is `pipsFor`'s to say and is pinned in
// tests/js/store/easy-pips.test.js; what is read here is that a tile DRAWS that
// many, that the group stands in the same row as the apodizing mark, and that a
// reader meets it by a name.
//
// The companion files are tests/js/components/easytiles.test.js (the tiles, the
// active marking and where a press routes what the table names) and
// tests/js/components/easytiles-mark.test.js (the apodizing mark itself). All
// share tests/js/support/easytiles.js, imported dynamically after `useStorage()`
// so that `store/easyview.js` meets the fake localStorage at its load-time read;
// the pip readers are tests/js/support/easypips.js.
//
// THE COUNTS ARE STATED OUTRIGHT, never read back out of `pipsFor`. Deriving
// them would only ask the card to agree with the module it draws from, and would
// pass on a card and a table that are wrong together.
//
// WHAT A RESTING TILE DRAWS is the resting position of every knob it carries, so
// these numbers are the store suite's numbers AT THOSE POSITIONS rather than its
// bare-call numbers. An `emphasis` knob rests on `space` everywhere except Old
// School, which rests on `transients`, and The Concert Hall's `correction` rests
// on `on`. The space position costs a pip more than transients on the PCM chain
// alone, and only on the three presets whose emphasis picks a filter LENGTH — so
// a resting Perfect Ten tile draws two on the PCM chain where a bare
// `pipsFor("perfect-ten", "pcm")` answers one, while its SDM number is the same
// two either way.
//
// HOOKS THIS SUITE REQUIRES the implementation to provide:
//   * `data-testid="easy-pips"` on the pip group, one per tile
//   * `data-pip` on each pip inside it
//   * an accessible name on the group — an `aria-label` with something in it, or
//     an `aria-labelledby` pointing at an element that says something
//   * a `--pip-cols` custom property in the group's own inline style, carrying
//     the column count
//
// NOTHING HERE READS COPY (docs/testing.md rule 9). The group's name is read for
// EXISTING and never for what it says, and no title, description, label or hint
// is asserted anywhere in this file.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easypips.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../support/storage.js";

useStorage();

const { resetTab, tabs } = await import("../support/easytiles.js");
const { pipCount, pipColumns, pipsAreNamed, pipsShareTheMarksRow } = await import("../support/easypips.js");
const { seedFacets, uniformFacets } = await import("../support/easymark.js");
const { rememberKnobs } = await import("../../../hqptuner/static/store/easyview.js");

// preset, SDM count, PCM count — what each tile draws AT REST, every knob where
// it comes up. The three length-picking presets carry the space position's extra
// pip on the PCM chain and nothing extra on the SDM chain; Old School and Damage
// Control move between phases instead and cost the same either way, and The
// Concert Hall carries no emphasis knob at all. Preset ids are wire identifiers.
/** @type {[string, number, number][]} */
const COSTS = [
  ["perfect-ten", 2, 2],
  ["lifelike", 2, 2],
  ["purist", 2, 2],
  ["old-school", 1, 1],
  ["damage-control", 1, 3],
  ["concert-hall", 17, 8],
];

// The tile the row and the naming are read on. `concert-hall` because it is the
// costliest, so a group drawn empty and a group drawn once are both a long way
// from what it must show.
const TILE = "concert-hall";

// ============================================================================
// a tile draws as many pips as its preset costs
// ============================================================================
//
// One case per preset per output mode, so a tile that drew the wrong number
// fails by naming the tile and the chain rather than by a count that could
// belong to any of the twelve.

for (const [presetId, , pcm] of COSTS) {
  test(`test_the_${presetId}_tile_draws_${pcm}_pips_in_the_pcm_output_mode`, async () => {
    await resetTab({ mode: "pcm" });
    assert.equal(pipCount(tabs(), presetId), pcm);
  });
}

for (const [presetId, sdm] of COSTS) {
  test(`test_the_${presetId}_tile_draws_${sdm}_pips_in_the_sdm_output_mode`, async () => {
    await resetTab({ mode: "sdm" });
    assert.equal(pipCount(tabs(), presetId), sdm);
  });
}

// The auto output mode shows the PCM number. One tile carries it, and it is the
// one whose two numbers are furthest apart: a card showing the SDM count under
// "auto" draws seventeen where eight belong.

test("test_a_tile_draws_its_pcm_pips_in_the_auto_output_mode", async () => {
  await resetTab({ mode: "auto" });
  assert.equal(pipCount(tabs(), TILE), 8);
});

// ============================================================================
// where the group stands, and how a reader meets it
// ============================================================================
//
// The row is read with the apodizing mark present, which is what the seeded
// overlay is for: a class is stated for every filter the table can write, so
// whichever filter the tile is showing, it has a mark to stand beside. A tile
// with no mark makes the reader throw rather than answer.

test("test_the_pip_group_stands_in_the_same_row_as_the_apodizing_mark", async () => {
  await resetTab({ mode: "pcm" });
  seedFacets(uniformFacets("full"));
  assert.equal(pipsShareTheMarksRow(tabs(), TILE), true);
});

// A group announced as nothing is a row of marks a reader is told nothing about.
// What it SAYS is the owner's and is asserted nowhere.

test("test_the_pip_group_carries_an_accessible_name", async () => {
  await resetTab({ mode: "pcm" });
  assert.equal(pipsAreNamed(tabs(), TILE), true);
});

// ============================================================================
// the error-correction knob takes a pip off
// ============================================================================
//
// `correction` is a knob only The Concert Hall carries, and what a tile DRAWS
// with it parked at "off" is the discounted number `pipsFor` answers — pinned
// as a number in tests/js/store/easy-pips.test.js, drawn here. The position is
// recorded through `rememberKnobs`, the public way a knob's position is put on
// record, and it is recorded AFTER the reset because the reset clears it.
//
// The knob id and its position are wire identifiers, carried in `data-v`; no
// word of the knob's copy is read.

const CORRECTION_OFF = { correction: "off" };

test("test_the_concert_hall_tile_draws_16_pips_in_the_sdm_output_mode_with_error_correction_off", async () => {
  await resetTab({ mode: "sdm" });
  rememberKnobs(TILE, CORRECTION_OFF);
  assert.equal(pipCount(tabs(), TILE), 16);
});

test("test_the_concert_hall_tile_draws_7_pips_in_the_pcm_output_mode_with_error_correction_off", async () => {
  await resetTab({ mode: "pcm" });
  rememberKnobs(TILE, CORRECTION_OFF);
  assert.equal(pipCount(tabs(), TILE), 7);
});

// ============================================================================
// how many columns the pips are laid out in
// ============================================================================
//
// Seven or fewer pips stand in one row, so the column count IS the pip count;
// past seven they split evenly over two, so the column count is half the pips
// rounded up. What is read is the `--pip-cols` custom property the group
// declares, never a measured width: nothing is laid out here, and how a
// stylesheet spends that number is the stylesheet's business.
//
// preset, output mode, pips the tile draws there, columns those pips make.

/** @type {[string, string, number, number][]} */
const COLUMNS = [
  ["old-school", "pcm", 1, 1],
  ["perfect-ten", "pcm", 2, 2],
  ["perfect-ten", "sdm", 2, 2],
  ["damage-control", "pcm", 3, 3],
  ["concert-hall", "pcm", 8, 4],
  ["concert-hall", "sdm", 17, 9],
];

for (const [presetId, mode, pips, cols] of COLUMNS) {
  test(`test_the_${presetId}_tile_lays_its_${pips}_pips_out_in_${cols}_columns_in_the_${mode}_output_mode`, async () => {
    await resetTab({ mode });
    assert.equal(pipColumns(tabs(), presetId), cols);
  });
}

// The seven-pip edge of the rule, reachable only with the error-correction knob
// off: seven pips are the most that stand in one row. The odd count past seven
// is the resting Concert Hall's seventeen above, which rounds its half up rather
// than dropping a pip into a third row or leaving a row short; the even count
// past seven is its sixteen with the knob off.

test("test_a_tile_of_7_pips_lays_them_out_in_7_columns", async () => {
  await resetTab({ mode: "pcm" });
  rememberKnobs(TILE, CORRECTION_OFF);
  assert.equal(pipColumns(tabs(), TILE), 7);
});

test("test_a_tile_of_16_pips_lays_them_out_in_8_columns", async () => {
  await resetTab({ mode: "sdm" });
  rememberKnobs(TILE, CORRECTION_OFF);
  assert.equal(pipColumns(tabs(), TILE), 8);
});

// ============================================================================
// what the emphasis knob costs where it picks a length
// ============================================================================
//
// On the three presets whose emphasis knob picks a filter LENGTH, the space
// position costs a pip more than transients ON THE PCM CHAIN, and the SDM chain
// costs the same either way. A tile draws whichever position is on record for
// it. The resting tiles above are the space half of that claim; what is read
// here is the transients half, on the preset whose two positions are furthest
// apart. The knob id and its positions are wire identifiers carried in `data-v`,
// and no word of the knob's copy is read.

const TRANSIENTS = { emphasis: "transients" };
const SPACE = { emphasis: "space" };

test("test_a_perfect_ten_tile_recorded_on_transients_draws_1_pip_in_the_pcm_output_mode", async () => {
  await resetTab({ mode: "pcm" });
  rememberKnobs("perfect-ten", TRANSIENTS);
  assert.equal(pipCount(tabs(), "perfect-ten"), 1);
});

test("test_a_perfect_ten_tile_recorded_on_transients_draws_2_pips_in_the_sdm_output_mode", async () => {
  await resetTab({ mode: "sdm" });
  rememberKnobs("perfect-ten", TRANSIENTS);
  assert.equal(pipCount(tabs(), "perfect-ten"), 2);
});

// The space half of the same claim, recorded outright rather than left to the
// resting position: a tile whose knob is ON RECORD at space draws the extra pip
// on the PCM chain and the same number as transients on the SDM chain, which is
// what makes the pairs here a rule about the knob and not a reading of where the
// knob happens to rest.

test("test_a_perfect_ten_tile_recorded_on_space_draws_2_pips_in_the_pcm_output_mode", async () => {
  await resetTab({ mode: "pcm" });
  rememberKnobs("perfect-ten", SPACE);
  assert.equal(pipCount(tabs(), "perfect-ten"), 2);
});

test("test_a_perfect_ten_tile_recorded_on_space_draws_the_same_2_pips_in_the_sdm_output_mode", async () => {
  await resetTab({ mode: "sdm" });
  rememberKnobs("perfect-ten", SPACE);
  assert.equal(pipCount(tabs(), "perfect-ten"), 2);
});

// Old School's emphasis moves between linear and minimum phase, the same work
// either way, so its tile draws the same in both positions. Read at transients,
// against the resting reading above.

test("test_an_old_school_tile_recorded_on_transients_draws_the_same_1_pip_in_the_pcm_output_mode", async () => {
  await resetTab({ mode: "pcm" });
  rememberKnobs("old-school", TRANSIENTS);
  assert.equal(pipCount(tabs(), "old-school"), 1);
});

test("test_an_old_school_tile_recorded_on_space_draws_the_same_1_pip_in_the_pcm_output_mode", async () => {
  await resetTab({ mode: "pcm" });
  rememberKnobs("old-school", SPACE);
  assert.equal(pipCount(tabs(), "old-school"), 1);
});

// ============================================================================
// what the material knob costs
// ============================================================================
//
// `material` is Damage Control's knob and it moves the PCM number alone: lossy
// material draws one pip where lossless draws the resting three, and the SDM
// chain draws its one pip whichever material is on record. Positions are wire
// identifiers, stated outright.

const LOSSY = { material: "lossy" };

test("test_a_damage_control_tile_recorded_on_lossy_material_draws_1_pip_in_the_pcm_output_mode", async () => {
  await resetTab({ mode: "pcm" });
  rememberKnobs("damage-control", LOSSY);
  assert.equal(pipCount(tabs(), "damage-control"), 1);
});

test("test_a_damage_control_tile_recorded_on_lossy_material_draws_the_same_1_pip_in_the_sdm_output_mode", async () => {
  await resetTab({ mode: "sdm" });
  rememberKnobs("damage-control", LOSSY);
  assert.equal(pipCount(tabs(), "damage-control"), 1);
});
