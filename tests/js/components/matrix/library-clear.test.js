// Rendered suite for hqptuner/static/components/matrix/Library.js: the AutoEq library picker's Clear button. Pressing
// it drops the selected hit, so the hit the search lists no longer carries the `selected` state.
//
// The wire is the seam: GET /api/autoeq answers one profile. A press is reached through preact's own `options.vnode`
// hook (tests/js/support/vnodeseam.js). A hit is the clickable that shows the fixture's model. The Clear button is
// found by neither its wording nor its position: of the clickables a selection adds, it is the one whose press hands
// nothing to the caller's applyText, where the load button hands over the profile's text.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/matrix/library-clear.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { LibraryPicker } from "../../../../hqptuner/static/components/matrix/Library.js";
import { renderTree, textOf } from "../../support/vnodeseam.js";
import { classTokens, click } from "../../support/easy/comborows.js";
import { propsOf } from "../../support/wheel.js";
import { ok, quiesce, stagingWire } from "../../support/wire/wire.js";

/** @typedef {import("../../support/wheel.js").VNode} VNode */

//: One AutoEq entry in the shape GET /api/autoeq carries it.
const PROFILE = {
  model: "HD 650",
  source: "oratory1990",
  text: "Preamp: -5.0 dB\nFilter 1: ON PK Fc 200 Hz Gain 2.0 dB Q 0.70\n",
};
const LIBRARY = { meta: { profiles: 1, sha: "0123456789abcdef" }, profiles: [PROFILE] };
//: The search typed into the picker: the fixture's own model, so its hit is listed.
const QUERY = PROFILE.model;
//: The state a selected hit carries.
const SELECTED = "selected";

/** @param {(text: string) => void} applyText */
const draw = (applyText) => renderTree(html`<${LibraryPicker} applyText=${applyText} />`).seen;

/** @param {VNode[]} seen */
const clickables = (seen) => seen.filter((v) => typeof propsOf(v).onClick === "function");

/** @param {VNode} v  whether the vnode shows the fixture's model, as its hit does */
const showsModel = (v) => textOf(v).includes(PROFILE.model);

/** Types the search into a fresh render's box. */
function search() {
  const box = draw(() => {}).find((v) => v.type === "input" && typeof propsOf(v).onInput === "function");
  if (!box) throw new Error("the picker rendered no search box");
  /** @type {(e: object) => void} */ (propsOf(box).onInput)({ target: { value: QUERY } });
}

/** @returns {VNode} the fixture's hit, from a fresh render of the search */
function hit() {
  search();
  const found = clickables(draw(() => {})).find(showsModel);
  if (!found) throw new Error("the search listed no hit for the fixture's model");
  return found;
}

/** @returns {boolean} whether the fixture's hit carries the selected state */
const isSelected = () => classTokens(hit()).includes(SELECTED);

/** Selects the fixture's hit unless it already is, since a press on a selected hit drops it. */
function select() {
  if (!isSelected()) click(hit());
}

/**
 * The clickables a selection adds, from a render handing its applyText to `applyText`.
 *
 * @param {(text: string) => void} applyText
 * @returns {VNode[]}
 */
function selectionButtons(applyText) {
  select();
  return clickables(draw(applyText)).filter((v) => !showsModel(v));
}

/**
 * The Clear button of a fresh selection: the one selection button whose press hands nothing to applyText. Each
 * candidate is pressed against its own fresh selection, so probing one leaves nothing behind for the next.
 *
 * @returns {VNode}
 */
function clearButton() {
  const quiet = selectionButtons(() => {}).map((_, at) => {
    /** @type {string[]} */
    const handed = [];
    click(selectionButtons((text) => handed.push(text))[at]);
    return handed.length === 0;
  });
  const at = quiet.indexOf(true);
  if (at < 0 || quiet.lastIndexOf(true) !== at) throw new Error(`want one button that loads nothing, got ${quiet}`);
  return selectionButtons(() => {})[at];
}

test("test_a_selected_hit_carries_the_selected_state", async () => {
  const wire = stagingWire({ routes: (path) => (path === "/api/autoeq" ? ok(LIBRARY) : undefined) });
  draw(() => {});
  await quiesce(wire);
  clearButton();
  assert.equal(isSelected(), true);
});
