// Rendered suite for hqptuner/static/components/faceplate/lists/Tip.js, the hover tip beside an option list's row: a
// pointer over a row shows the tip for that option and leaving it hides it, a touch shows none, the tip carries the
// option's manual prose, and the raw engine name only while Simplified has replaced it on the row.
//
// The row's pointer handlers are fired through the vnode seam on a render of OptionList; the tip is then rendered on
// its own, as the plate mounts it. The store is driven at the wire (tests/js/support/listsfixture.js). The tip and its
// parts are found by test id; every string asserted is a fixture name or sentence.
//
// Not reachable here: where the tip lands beside its row's column, which measures the mounted plate. A browser run
// closes it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-lists/tip.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { OptionList } from "../../../../hqptuner/static/components/faceplate/lists/OptionList.js";
import { ListTip } from "../../../../hqptuner/static/components/faceplate/lists/Tip.js";
import { openList } from "../../../../hqptuner/static/store/faceplate/view.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, elements, hasAttr, text } from "../../support/markup.js";
import { SINC_PROSE, loadLists, resetLists } from "../../support/listsfixture.js";

beforeEach(() => {
  resetLists();
  loadLists({ plain: true });
  openList.value = { key: "sdm_filter_1x", stage: "1x", value: "IIR", pick: () => undefined };
});

/**
 * Fire a pointer handler on one row of the open list.
 *
 * @param {string} v  the row's engine name
 * @param {string} handler
 * @param {string} [pointerType]
 */
function onRow(v, handler, pointerType = "mouse") {
  const { seen } = renderTree(html`<${OptionList} />`);
  const hit = seen.find((n) => typeof n.type === "string" && n.props?.role === "option" && n.props["data-v"] === v);
  const fn = /** @type {((e: unknown) => unknown) | undefined} */ (hit?.props[handler]);
  if (fn) fn({ pointerType });
}

/**
 * One part of the rendered tip, by test id.
 *
 * @param {string} id
 */
const part = (id) => elements(render(html`<${ListTip} />`)).find((e) => attr(e, "data-testid") === id);

/** Whether the tip is hidden, or null when none renders. */
function tipHidden() {
  const el = part("option-tip");
  return el ? hasAttr(el, "hidden") : null;
}

test("test_a_pointer_over_a_row_shows_the_tip_and_a_touch_does_not", () => {
  onRow("IIR", "onPointerEnter", "touch");
  const touched = tipHidden();
  onRow("IIR", "onPointerEnter");
  assert.deepEqual([touched, tipHidden()], [true, false]);
});

test("test_leaving_the_row_hides_its_tip", () => {
  onRow("IIR", "onPointerEnter");
  const shown = tipHidden();
  onRow("IIR", "onPointerLeave");
  assert.deepEqual([shown, tipHidden()], [false, true]);
});

test("test_the_tip_carries_the_prose_the_overlay_writes_for_its_option", () => {
  onRow("sinc-M", "onPointerEnter");
  const el = part("tip-text");
  assert.equal(el ? text(el) : null, SINC_PROSE);
});

test("test_a_simplified_tip_names_the_engine_option", () => {
  onRow("poly-sinc-gauss-long", "onPointerEnter");
  const el = part("tip-name");
  assert.equal(el ? text(el) : null, "poly-sinc-gauss-long");
});

test("test_a_standard_tip_carries_no_name_the_row_already_shows", () => {
  onRow("poly-sinc-gauss-long", "onPointerEnter");
  const simplified = part("tip-name") !== undefined;
  loadLists({ plain: false });
  assert.deepEqual([simplified, part("tip-name") !== undefined], [true, false]);
});
