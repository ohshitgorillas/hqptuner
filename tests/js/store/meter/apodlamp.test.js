// Behavioral suite for store/meter/apodlamp.js: the apodizing lamps' level, the one the faceplate engine row's
// Apodizing lamp draws. The rendered suite (tests/js/components/faceplate/engine-row.test.js) pins that the lamp lights
// on a frame that counted and reads dark on one that did not; this suite pins how bright it lights: a busier passage
// reads brighter than a quieter one, and the "uncorrected" preference scales the reading by what the running filter
// already corrects of it.
//
// The wire is the seam: polls are Status frames written to `engineStatus` through tests/js/support/apodpolls.js, with
// the history's effect registered so each poll records a bin, and the running engine's filter enumeration is served
// through tests/js/support/filterfacets.js. Every case starts a track of its own and sets the preference it reads.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/meter/apodlamp.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { apodLampLevel } from "../../../../hqptuner/static/store/meter/apodlamp.js";
import { initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { apodLight } from "../../../../hqptuner/static/store/ui/prefs.js";
import { feed, setPollStep } from "../../support/apodpolls.js";
import { resetFilterFacets } from "../../support/filterfacets.js";

initApodHistory();

/** Seconds of playback each poll observes. */
const STEP = 1;

/** Events in one bin of a quiet passage, and of a busy one; both below the scale's saturation. */
const QUIET = 3;
const BUSY = 20;

/** Events in the bin the preference cases read. */
const EVENTS = 8;

/** Filter names the running engine enumerates; `arg` bit 0 is apodizing, bit 1 half-apodizing. */
const HALF = "test-half-apodizing";
const FULL = "test-full-apodizing";
const PLAIN = "test-neither";

/** @type {import("../../support/filterfacets.js").FilterRow[]} */
const FILTERS = [
  [HALF, "3/5 space ⥮ Any", 2],
  [FULL, "4/5 transients ⥮ Any", 1],
  [PLAIN, "2/5 tone ⥮ Any", 0],
];

/**
 * The lamp's level after a fresh track records one bin of `events` under the "all" preference.
 *
 * @param {number} events
 * @returns {number}
 */
function lit(events) {
  setPollStep(STEP);
  apodLight.value = "all";
  feed([events]);
  return apodLampLevel.value;
}

/**
 * The lamp's level under "uncorrected" over its level under "all", for one bin recorded while `filter` runs.
 *
 * @param {string} filter
 * @returns {number}
 */
function uncorrectedShare(filter) {
  resetFilterFacets(FILTERS);
  setPollStep(STEP);
  apodLight.value = "all";
  feed([EVENTS], { active_filter: filter });
  const otherwise = apodLampLevel.value;
  apodLight.value = "uncorrected";
  const uncorrected = apodLampLevel.value;
  apodLight.value = "all";
  return uncorrected / otherwise;
}

test("test_a_busier_passage_lights_the_lamp_brighter_than_a_quieter_one", () => {
  const quiet = lit(QUIET);
  const busy = lit(BUSY);
  assert.ok(busy > quiet, `the lamp read ${busy} busy against ${quiet} quiet`);
});

test("test_uncorrected_halves_the_lamp_while_a_half_apodizing_filter_runs", () => {
  assert.equal(uncorrectedShare(HALF), 0.5);
});

test("test_uncorrected_darkens_the_lamp_while_a_fully_apodizing_filter_runs", () => {
  assert.equal(uncorrectedShare(FULL), 0);
});

test("test_uncorrected_leaves_the_lamp_unchanged_while_a_filter_that_does_neither_runs", () => {
  assert.equal(uncorrectedShare(PLAIN), 1);
});
