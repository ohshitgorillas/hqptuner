// Rendered suite for a grayed modulator row (hqptuner/static/components/faceplate/lists/Rows.js): a row whose modulator the
// SDM output rate in force cannot run carries the disabled state, and a tap on it hands nothing to the pick and leaves the
// list open; a row the rate runs, at its floor included, taps as it always did.
//
// The wire is the seam (tests/js/support/listsfixture.js): the fixture's two modulators, ASDM7EC 512+fs with a rate floor
// of 20480000 and ASDM5 with none, under an SDM rate limit served as the `defaults_bitrate` reading. Rows are found by
// `role="option"` and their engine name (`data-v`); a tap is fired through the vnode seam
// (tests/js/support/vnodeseam.js). Every string asserted is a fixture name or an attribute name.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-lists/rate-floor-row.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { OptionList } from "../../../../hqptuner/static/components/faceplate/lists/OptionList.js";
import { openList } from "../../../../hqptuner/static/store/faceplate/view.js";
import { flushNarrowing } from "../../../../hqptuner/static/store/narrow/persist.js";
import { favoritesWire, settle } from "../../support/wire/favoriteswire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements } from "../../support/markup.js";
import { loadLists, resetLists } from "../../support/listsfixture.js";

const ABOVE_FLOOR = "ASDM7EC 512+fs";
const NO_FLOOR = "ASDM5";
const DSD256 = "12288000";
const AT_FLOOR = "20480000";

/** @type {string[]} */
let picked = [];

beforeEach(() => {
  favoritesWire();
  resetLists();
  picked = [];
});

afterEach(async () => {
  await flushNarrowing();
});

/**
 * Serve the SDM rate limit and open the modulator list with `ASDM5` running; picks land in `picked`.
 *
 * @param {string} limit
 */
async function openUnder(limit) {
  await loadLists({ readings: { defaults_bitrate: limit } });
  openList.value = { key: "sdm_modulator", stage: "1x", value: NO_FLOOR, pick: (v) => picked.push(v) };
}

/** The attribute a row of the modulator list carries, or undefined. @param {string} name @param {string} a */
const rowAttr = (name, a) => {
  const row = elements(render(html`<${OptionList} />`)).find(
    (e) => attr(e, "role") === "option" && attr(e, "data-v") === name,
  );
  return row && attr(row, a);
};

/** The row of an engine name, as markup, or undefined. @param {string} name */
const rowOf = (name) =>
  elements(render(html`<${OptionList} />`)).find((e) => attr(e, "role") === "option" && attr(e, "data-v") === name);

/** Every class token inside the row of an engine name. @param {string} name */
const innerClasses = (name) => elements(rowOf(name)?.html ?? "").flatMap((e) => classes(e));

/** Tap the row of an engine name. @param {string} name */
async function tap(name) {
  const { seen } = renderTree(html`<${OptionList} />`);
  const hit = seen.find((v) => typeof v.type === "string" && v.props?.role === "option" && v.props["data-v"] === name);
  const fn = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (fn) await fn();
  await settle();
}

test("test_a_modulator_row_above_the_rate_in_force_carries_the_disabled_state", async () => {
  await openUnder(DSD256);
  assert.equal(rowAttr(ABOVE_FLOOR, "aria-disabled"), "true");
});

test("test_a_grayed_modulator_row_has_no_reason_description", async () => {
  await openUnder(DSD256);
  assert.equal(rowAttr(ABOVE_FLOOR, "aria-description"), undefined);
});

test("test_a_grayed_modulator_row_has_no_reason_element", async () => {
  await openUnder(DSD256);
  assert.equal(innerClasses(ABOVE_FLOOR).includes("rsn"), false);
});

test("test_a_grayed_modulator_row_still_shows_its_tier_badge", async () => {
  await openUnder(DSD256);
  assert.equal(innerClasses(ABOVE_FLOOR).includes("otier"), true);
});

test("test_a_modulator_row_the_rate_runs_carries_no_disabled_state", async () => {
  await openUnder(DSD256);
  assert.equal(rowAttr(NO_FLOOR, "aria-disabled"), undefined);
});

test("test_tapping_a_grayed_row_hands_nothing_to_the_pick", async () => {
  await openUnder(DSD256);
  await tap(ABOVE_FLOOR);
  assert.deepEqual(picked, []);
});

test("test_tapping_a_grayed_row_leaves_the_list_open", async () => {
  await openUnder(DSD256);
  await tap(ABOVE_FLOOR);
  assert.equal(openList.value?.key, "sdm_modulator");
});

test("test_tapping_a_row_at_the_floor_hands_its_name_to_the_pick", async () => {
  await openUnder(AT_FLOOR);
  await tap(ABOVE_FLOOR);
  assert.deepEqual(picked, [ABOVE_FLOOR]);
});
