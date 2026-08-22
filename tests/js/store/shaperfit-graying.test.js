// Behavioral suite for rate/shaper fit inside the LIVE page's chain cards —
// which modulator rows the SDM card grays, and the PCM card's refusal to gray a
// dither for any reason of rate at all.
//
// The split is a product decision, not something the manual draws: a modulator
// below its rate floor makes the engine produce NOTHING, so the row cannot be
// picked; a dither below its floor still plays, so the row stays pickable and
// the advice goes in the alert strip instead (shaperfit-alerts.test.js).
//
// Constraints live only in data/shapers.json, which joins to the engine's own
// shaper names (architecture §2/§5), so every floor below arrives through the
// /api/metadata overlay the fixture states — `min_rate_hz` in Hz, null for a
// shaper the file records no floor for.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. The cards are read through the exported `liveModel`, the same
// surface components/live/View.js renders from.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/shaperfit-graying.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { liveModel } from "../../../hqptuner/static/store/live/model.js";
import {
  reset,
  DSD64,
  DSD512,
  PCM_1X,
  PCM_8X,
  MODULATOR,
  DITHER,
  OTHER_MODULATOR,
} from "../support/shaperfit-fixtures.js";

/**
 * One option row of a chain control: the value it sends, the shaper name it
 * shows, and the two marks graying puts on it.
 *
 * @typedef {{ value: string | number, label?: string, disabled?: boolean, reason?: string }} Option
 */

/**
 * One chain control as the card model carries it.
 *
 * @typedef {{ field: string, options: Option[] }} Control
 */

// A named control of either card. A miss throws rather than quietly measuring
// nothing: a card that has lost a control must fail loudly.
/**
 * @param {string} field
 * @returns {Control}
 */
function control(field) {
  const cards = [...liveModel.value.pcmChain, ...liveModel.value.sdmChain];
  const hit = cards.find((/** @type {Control} */ c) => c.field === field);
  if (!hit) throw new Error(`the live chain cards carry no ${field} control`);
  return hit;
}

// One option row by the shaper name it shows. A miss throws for the same reason:
// a store that DROPPED the row below the floor instead of graying it must fail
// here rather than pass a "not disabled" case by having nothing to disable.
/**
 * @param {string} field
 * @param {string} name
 * @returns {Option}
 */
function option(field, name) {
  const hit = control(field).options.find((o) => o.label === name);
  if (!hit) throw new Error(`the ${field} control offers no ${name} row`);
  return hit;
}

// The two marks a row can carry, read as a pair: whether it can be picked, and
// what it says about itself. A grayed row must carry BOTH — a row disabled with
// no reason leaves the user guessing, and a reason on a pickable row grays
// nothing.
/** @param {Option} o */
const marks = (o) => [Boolean(o.disabled), o.reason ? "reason" : null];
const GRAYED = [true, "reason"];
const PICKABLE = [false, null];

// --- the modulator below its floor --------------------------------------------

test("test_a_modulator_above_the_sdm_rate_is_offered_disabled", async () => {
  // 40960000 sits between DSD512 and DSD1024 by design — the manual states MHz
  // thresholds, not tiers — so DSD512 output is below this modulator's floor.
  await reset({ chain: "sdm", mode: "2", sdmRate: DSD512, floors: { sdm: { [MODULATOR]: 40960000 } } });
  assert.equal(option("modulator", MODULATOR).disabled, true);
});

// The reason's wording is owner copy (docs/testing.md rule 9); the FIGURE in it
// is the modulator's own floor, and that is what these two state.

test("test_a_modulator_grayed_by_rate_names_the_floor_it_needs", async () => {
  await reset({ chain: "sdm", mode: "2", sdmRate: DSD512, floors: { sdm: { [MODULATOR]: 40960000 } } });
  assert.match(String(option("modulator", MODULATOR).reason), /\b40\.96\b/);
});

test("test_a_modulator_grayed_by_rate_names_a_second_floor_as_its_own", async () => {
  // The same reason at a different floor: a formatter emitting one constant
  // passes the case above and fails this one.
  await reset({ chain: "sdm", mode: "2", sdmRate: DSD64, floors: { sdm: { [OTHER_MODULATOR]: 6144000 } } });
  assert.match(String(option("modulator", OTHER_MODULATOR).reason), /\b6\.144\b/);
});

test("test_a_modulator_the_sdm_rate_reaches_exactly_stays_pickable", async () => {
  // The floor is AT the effective rate, the boundary the rule turns on.
  await reset({ chain: "sdm", mode: "2", sdmRate: DSD512, floors: { sdm: { [MODULATOR]: 24576000 } } });
  assert.deepEqual(marks(option("modulator", MODULATOR)), PICKABLE);
});

test("test_a_modulator_below_the_sdm_rate_stays_pickable", async () => {
  await reset({ chain: "sdm", mode: "2", sdmRate: DSD512, floors: { sdm: { [MODULATOR]: 12288000 } } });
  assert.deepEqual(marks(option("modulator", MODULATOR)), PICKABLE);
});

test("test_a_modulator_with_no_floor_stays_pickable_at_the_lowest_dsd_rate", async () => {
  // A null `min_rate_hz` is the constraint file recording no floor at all, which
  // is not the same as a floor of zero to compare against.
  await reset({
    chain: "sdm",
    mode: "2",
    sdmRate: DSD64,
    floors: { sdm: { [OTHER_MODULATOR]: null, [MODULATOR]: null } },
  });
  assert.deepEqual(marks(option("modulator", OTHER_MODULATOR)), PICKABLE);
});

test("test_a_modulator_the_constraint_file_does_not_mention_stays_pickable", async () => {
  await reset({ chain: "sdm", mode: "2", sdmRate: DSD64, floors: { sdm: { [MODULATOR]: 40960000 } } });
  assert.deepEqual(marks(option("modulator", OTHER_MODULATOR)), PICKABLE);
});

// --- the dormant card grays the same way --------------------------------------
// An edit to the chain the engine has not loaded is remembered and written when
// that chain loads, so the card is read the same way either side of the load.

test("test_the_dormant_sdm_card_grays_a_modulator_above_its_floor", async () => {
  // The engine is running PCM and cannot be asked about the SDM chain at all;
  // the rate and the modulator both come from the running configuration, and the
  // graying is the same graying.
  await reset({ chain: "pcm", mode: "1", sdmRate: DSD512, floors: { sdm: { [MODULATOR]: 40960000 } } });
  assert.deepEqual(marks(option("modulator", MODULATOR)), GRAYED);
});

test("test_the_dormant_sdm_card_leaves_a_modulator_within_its_floor_pickable", async () => {
  await reset({ chain: "pcm", mode: "1", sdmRate: DSD512, floors: { sdm: { [MODULATOR]: 12288000 } } });
  assert.deepEqual(marks(option("modulator", MODULATOR)), PICKABLE);
});

// --- the PCM card never grays a dither by rate --------------------------------
// A dither below its floor is a soft constraint: the engine plays, so every row
// stays pickable whatever the rate, and the advice is an alert instead.

test("test_the_loaded_pcm_card_leaves_a_dither_below_its_floor_pickable", async () => {
  await reset({ chain: "pcm", mode: "1", pcmRate: PCM_1X, floors: { pcm: { [DITHER]: 352800 } } });
  assert.deepEqual(marks(option("dither", DITHER)), PICKABLE);
});

test("test_the_dormant_pcm_card_leaves_a_dither_below_its_floor_pickable", async () => {
  await reset({ chain: "sdm", mode: "2", pcmRate: PCM_1X, floors: { pcm: { [DITHER]: 352800 } } });
  assert.deepEqual(marks(option("dither", DITHER)), PICKABLE);
});

test("test_the_pcm_card_leaves_a_dither_with_a_high_floor_pickable_at_a_high_rate", async () => {
  // The other half: a floor far above even the 8x tier grays nothing either, so
  // no case here passes merely by the rate happening to clear the floor.
  await reset({ chain: "pcm", mode: "1", pcmRate: PCM_8X, floors: { pcm: { [DITHER]: 1536000 } } });
  assert.deepEqual(marks(option("dither", DITHER)), PICKABLE);
});
