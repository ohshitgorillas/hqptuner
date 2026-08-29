// Behavioral suite for the PIP GROUP an Easy Mode preset tile carries: the row
// of marks standing for what that preset costs the machine. How much a preset
// costs, and how that cost moves with a knob, is `pipsFor`'s and is pinned
// relationally in tests/js/store/easy-pips.test.js; what is read HERE is that a
// tile draws as many pips as the module answers, that the group stands in the
// same row as the apodizing mark, and that a reader meets it by a name.
//
// THE COUNTS ARE READ OUT OF `pipsFor`, NOT TYPED. The pip numbers are
// owner-tunable data — The Concert Hall went from sixteen to seventeen because
// the owner said so, with no behavior changed — so a number typed here would
// assert only that a constant is that constant, and would go red on a retune
// where nothing is wrong (docs/testing.md rule 9). Reading the module is the
// right move in THIS file and not a tautology: the module is the source of the
// number, and the question a card suite asks is whether the CARD agrees with it,
// which is a different claim from the module agreeing with itself. (An earlier
// revision of this header said the opposite and typed the numbers out; that was
// the rule-9 defect this file now avoids.)
//
// WHAT A TILE PASSES is its own knob positions, so a resting tile is read
// against `pipsFor` at the RESTING positions — asked of the shipped table
// through `presetsFor`, whose knobs carry their own defaults, rather than typed
// out. That matters because the two are not the same call: the space position an
// emphasis knob rests on costs a pip more than transients on the PCM chain, and
// nothing extra on the SDM chain.
//
// The companion files are tests/js/components/easytiles.test.js (the tiles, the
// active marking and where a press routes what the table names) and
// tests/js/components/easytiles-mark.test.js (the apodizing mark itself). All
// share tests/js/support/easytiles.js, imported dynamically after `useStorage()`
// so that `store/easyview.js` meets the fake localStorage at its load-time read;
// the pip readers are tests/js/support/easypips.js.
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
const { pipsFor, presetsFor } = await import("../../../hqptuner/static/store/easy.js");

/** @typedef {{ id: string, default: string, options: string[] }} Knob */
/** @typedef {{ id: string, emoji: string, knobs: Knob[] }} Preset */

/** @type {Preset[]} */
const PRESETS = presetsFor();

/**
 * Where a preset's knobs rest, as the shipped table declares it — what a tile
 * passes when nothing has been touched.
 *
 * @param {Preset} preset
 * @returns {Record<string, string>}
 */
const resting = (preset) => Object.fromEntries(preset.knobs.map((knob) => [knob.id, knob.default]));

// The tile the row, the naming and the wide column case are read on.
// `concert-hall` because it is the costliest, so a group drawn empty and a group
// drawn once are both a long way from what it must show. Preset ids are wire
// identifiers.
const TILE = "concert-hall";

// ============================================================================
// a tile draws as many pips as its preset costs
// ============================================================================
//
// One case per preset per output mode, so a tile that drew the wrong number
// fails by naming the tile and the chain rather than by a count that could
// belong to any of the twelve.

for (const preset of PRESETS) {
  test(`test_the_${preset.id}_tile_draws_the_pips_its_preset_costs_in_the_pcm_output_mode`, async () => {
    await resetTab({ mode: "pcm" });
    assert.equal(pipCount(tabs(), preset.id), pipsFor(preset.id, "pcm", resting(preset)));
  });
}

for (const preset of PRESETS) {
  test(`test_the_${preset.id}_tile_draws_the_pips_its_preset_costs_in_the_sdm_output_mode`, async () => {
    await resetTab({ mode: "sdm" });
    assert.equal(pipCount(tabs(), preset.id), pipsFor(preset.id, "sdm", resting(preset)));
  });
}

// The auto output mode shows the PCM number. One tile carries it, and it is the
// one whose two chains are furthest apart: a card showing the SDM count under
// "auto" draws the whole Concert Hall where the PCM row belongs.

test("test_a_tile_draws_its_pcm_pips_in_the_auto_output_mode", async () => {
  const hall = PRESETS.filter((p) => p.id === TILE)[0];
  await resetTab({ mode: "auto" });
  assert.equal(pipCount(tabs(), TILE), pipsFor(TILE, "pcm", resting(hall)));
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
// a tile drawn at a knob position that is not the resting one
// ============================================================================
//
// A tile draws what the module answers FOR ITS OWN KNOB POSITIONS, which is a
// claim about the card carrying the positions through rather than about any
// number. One case per knob that moves a count: emphasis, material, correction.
// Positions are recorded through `rememberKnobs`, the public way a knob's
// position is put on record, and AFTER the reset because the reset clears it.
//
// Knob ids and their positions are wire identifiers, carried in `data-v`; no
// word of any knob's copy is read.

const TRANSIENTS = { emphasis: "transients" };
const LOSSY = { material: "lossy" };
const CORRECTION_OFF = { correction: "off" };

test("test_a_perfect_ten_tile_recorded_on_transients_draws_what_that_position_costs_on_the_pcm_chain", async () => {
  await resetTab({ mode: "pcm" });
  rememberKnobs("perfect-ten", TRANSIENTS);
  assert.equal(pipCount(tabs(), "perfect-ten"), pipsFor("perfect-ten", "pcm", TRANSIENTS));
});

test("test_a_damage_control_tile_recorded_on_lossy_material_draws_what_that_material_costs_on_the_pcm_chain", async () => {
  await resetTab({ mode: "pcm" });
  rememberKnobs("damage-control", LOSSY);
  assert.equal(pipCount(tabs(), "damage-control"), pipsFor("damage-control", "pcm", LOSSY));
});

test("test_a_concert_hall_tile_recorded_with_error_correction_off_draws_what_that_position_costs_on_the_sdm_chain", async () => {
  await resetTab({ mode: "sdm" });
  rememberKnobs(TILE, CORRECTION_OFF);
  assert.equal(pipCount(tabs(), TILE), pipsFor(TILE, "sdm", CORRECTION_OFF));
});

// ============================================================================
// how many columns the pips are laid out in
// ============================================================================
//
// Seven or fewer pips stand in one row, so the column count IS the pip count;
// past seven they split evenly over two, so the column count is half the pips
// rounded up. THIS RULE IS CARRIED FROM THE PREVIOUS REVISION OF THIS SUITE'S
// HEADER and is not owner-approved spec — it is stated here as the suite found
// it, and a reviewer who knows better should correct it rather than assume it
// was signed off.
//
// The expectation is computed from the count the tile ACTUALLY DREW, so no pip
// number is typed. What is read is the `--pip-cols` custom property the group
// declares, never a measured width: nothing is laid out here, and how a
// stylesheet spends that number is the stylesheet's business.
//
// @type {(pips: number) => number}
const columnsFor = (/** @type {number} */ pips) => (pips <= 7 ? pips : Math.ceil(pips / 2));

// One case each side of the boundary: the cheapest tile on the card, which
// cannot reach a second row, and the costliest, which cannot fit in one.

test("test_a_tile_of_seven_pips_or_fewer_lays_them_out_in_as_many_columns_as_it_has_pips", async () => {
  await resetTab({ mode: "pcm" });
  const out = tabs();
  assert.equal(pipColumns(out, "old-school"), columnsFor(pipCount(out, "old-school")));
});

test("test_a_tile_of_more_than_seven_pips_lays_them_out_in_half_as_many_columns_rounded_up", async () => {
  await resetTab({ mode: "sdm" });
  const out = tabs();
  assert.equal(pipColumns(out, TILE), columnsFor(pipCount(out, TILE)));
});
