// Behavioral suite for the PIP GROUP an Easy Mode preset tile carries: the row
// of marks standing for what that preset costs the machine. How much a preset
// costs, and how that cost moves with a knob, is `pipsFor`'s and is pinned
// relationally in tests/js/store/easy-pips.test.js; what is read HERE is that a
// tile draws as many pips as the module answers, that the group stands in the
// same row as the apodizing mark, and that a reader meets it by a name. Both
// lanes are read: the tabs lane, whose output mode is a form field, and the LIVE
// lane, whose output mode is derived from the engine's reported mode name.
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
//   * the `easy-cost` class on the tile's cost row and the `easy-apod` class on
//     the apodizing mark inside it, which is how "the group stands in the mark's
//     row" is read — the same two hooks
//     tests/js/components/easytiles-hires.test.js reads that row through
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

const { resetTab, tabs, resetLive, liveCard } = await import("../support/easytiles.js");
const { pipCount, pipsAreNamed, pipsShareTheMarksRow } = await import("../support/easypips.js");
const { seedFacets, uniformFacets } = await import("../support/easymark.js");
const { rememberKnobs } = await import("../../../hqptuner/static/store/easyview.js");
const { pipsFor } = await import("../../../hqptuner/static/store/easycost.js");
const { presetsFor, knobsShown } = await import("../../../hqptuner/static/store/easy.js");

/** @typedef {{ id: string, default: string, options: string[] }} Knob */
/** @typedef {{ id: string, emoji: string, knobs: Knob[], costText?: boolean }} Preset */

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

// The tile the row and the naming are read on. `concert-hall` because it is the
// costliest, so a group drawn empty and a group drawn once are both a long way
// from what it must show. Preset ids are wire identifiers.
const TILE = "concert-hall";

// ============================================================================
// a tile draws as many pips as its preset costs
// ============================================================================
//
// One case per preset per output mode, so a tile that drew the wrong number
// fails by naming the tile and the chain rather than by a count that could
// belong to any of the sixteen.
//
// Both sweeps are generated from the shipped roster, so a roster that came back
// empty would generate no cases and retire the rule with nothing red. This case
// is their smoke alarm: it fails by name where they would simply cease to exist.

test("test_the_shipped_table_names_at_least_one_preset_for_the_per_preset_sweeps", () => {
  assert.ok(PRESETS.length > 0, "presetsFor() named no presets, so both per-preset sweeps below generated nothing");
});

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
//
// One case per preset, off the shipped roster like the count sweeps: a card
// that named one tile's group and left the other seven anonymous fails by
// naming the tile a reader is told nothing about, where a single reading would
// have passed on the one tile it happened to take. Presets declaring `costText`
// still render the single `data-testid="easy-pips"` cost-row container, but it
// holds caption text — no pip dots and no named `role="img"` group — so they
// are excluded from THIS naming sweep on that declared property, while the
// count sweeps above stay unfiltered (0 dots agrees with `pipsFor` at 0).

for (const preset of PRESETS.filter((p) => !p.costText)) {
  test(`test_the_${preset.id}_tiles_pip_group_carries_an_accessible_name`, async () => {
    await resetTab({ mode: "pcm" });
    assert.equal(pipsAreNamed(tabs(), preset.id), true);
  });
}

// ============================================================================
// a tile drawn at a knob position that is not the resting one
// ============================================================================
//
// A tile draws what the module answers FOR ITS OWN KNOB POSITIONS, which is a
// claim about the card carrying the positions through rather than about any
// number. One case per preset, per knob that preset offers at rest, per output
// chain: a card that carried one knob through and dropped another, or carried
// them on one chain only, fails by naming the tile, the knob and the chain.
// Positions are recorded through `rememberKnobs`, the public way a knob's
// position is put on record, and AFTER the reset because the reset clears it.
//
// NO PRESET IS NAMED TO STAND FOR A KNOB. Which presets carry which knobs is
// owner data, so the pairs are swept off the shipped table: every preset
// `presetsFor` declares, and for each the knobs `knobsShown` offers at its
// resting positions, since a knob hidden at rest is not one the tile can be
// recorded off. A knob offering no position but its default generates no case.
//
// THE POSITION RECORDED IS DERIVED, NOT TYPED: it is the first of the knob's
// options that is not the one it rests on, asked of the shipped table. Typed
// out, a case here would quietly become a restatement of the resting case the
// day the owner flipped that knob's default, and a card that ignored the
// recorded positions entirely would go on passing it. Derived, the contrast
// between the recorded position and the resting one holds by construction.
//
// THE POSITIONS ARE THE WHOLE SET, the resting ones with that one knob moved,
// on both sides of the reading: what is recorded and what `pipsFor` is asked
// about. A tile passes all of its knob positions (see the header), so asking
// the module about the moved knob alone would read the tile against a
// different question, and the two do not agree wherever another knob's
// resting position carries a cost of its own.

/**
 * Every (preset, knob) pair the shipped table offers at rest, each with the
 * knob positions putting that one knob on the first position it does NOT rest
 * on and every other knob on its default. Pairs whose knob offers no other
 * position are left out.
 *
 * @returns {{ preset: Preset, knob: Knob, knobs: Record<string, string> }[]}
 */
const movedPairs = () =>
  PRESETS.flatMap((preset) =>
    /** @type {Knob[]} */ (knobsShown(preset, resting(preset)))
      .map((knob) => ({ preset, knob, away: knob.options.filter((option) => option !== knob.default) }))
      .filter(({ away }) => away.length > 0)
      .map(({ preset: p, knob, away }) => ({ preset: p, knob, knobs: { ...resting(p), [knob.id]: away[0] } })),
  );

const CHAINS = ["pcm", "sdm"];

for (const { preset, knob, knobs } of movedPairs()) {
  for (const chain of CHAINS) {
    test(`test_a_${preset.id}_tile_recorded_off_its_${knob.id}_default_draws_what_that_position_costs_on_the_${chain}_chain`, async () => {
      await resetTab({ mode: chain });
      rememberKnobs(preset.id, knobs);
      assert.equal(pipCount(tabs(), preset.id), pipsFor(preset.id, chain, knobs));
    });
  }
}

// ============================================================================
// the LIVE lane
// ============================================================================
//
// The card renders on the LIVE page too, where the output mode is not a form
// field but the engine's own reported mode NAME (`store/live/derive.js`, the
// derivation tests/js/components/easytiles.test.js drives its live cases
// through). Every case above is a tabs-lane case, so a card that asked the
// config form which mode it was in and drew the PCM row on every live page was
// wrong with nothing red.
//
// The reading is taken on the tile whose two chains are furthest apart, and the
// premise that they ARE apart is asserted first rather than assumed: were the
// two costs equal, the case below would pass on a card that had never derived
// the mode at all. Neither number is typed — both are asked of the module.

test("test_the_costliest_tiles_pcm_and_sdm_costs_differ_so_the_live_case_can_tell_them_apart", () => {
  const hall = PRESETS.filter((p) => p.id === TILE)[0];
  assert.notEqual(pipsFor(TILE, "pcm", resting(hall)), pipsFor(TILE, "sdm", resting(hall)));
});

test("test_a_live_tile_draws_its_sdm_pips_while_the_engine_reports_an_sdm_mode_name", async () => {
  const hall = PRESETS.filter((p) => p.id === TILE)[0];
  await resetLive({ mode: "SDM (DSD)", output: "sdm", chain: "sdm" });
  assert.equal(pipCount(liveCard(), TILE), pipsFor(TILE, "sdm", resting(hall)));
});

// And the group stands in the mark's row on the live page as well, which is a
// different rendering of the same tile and not the one every row case above
// read.

test("test_a_live_tiles_pip_group_stands_in_the_same_row_as_the_apodizing_mark", async () => {
  await resetLive({ mode: "SDM (DSD)", output: "sdm", chain: "sdm" });
  seedFacets(uniformFacets("full"));
  assert.equal(pipsShareTheMarksRow(liveCard(), TILE), true);
});
