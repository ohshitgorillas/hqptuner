// Behavioral suite for the AutoEq library's selection: picking a hit selects
// that profile, and `clearLibrarySelection` drops it again.
//
// The selection lives in a module-private signal, so it is read the way a user
// sees it: the hit carrying the `selected` class on a fresh render.
//
// Run: node --test --import ./tests/js/support/vendor-resolve.js tests/js/components/matrix/library-select.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { LibraryPicker, clearLibrarySelection } from "../../../../hqptuner/static/components/matrix/Library.js";
import { renderTree, textOf } from "../../support/vnodeseam.js";
import { classTokens, clickablesIn, click } from "../../support/easy/comborows.js";
import { ok } from "../../support/wire/wire.js";

/** @typedef {import("../../support/wheel.js").VNode} VNode */

const PROFILES = [
  { model: "HD 600", source: "oratory1990", text: "Preamp: -6.0 dB\nFilter 1: ON PK Fc 100 Hz Gain 3.0 dB Q 1.00\n" },
  { model: "HD 650", source: "oratory1990", text: "Preamp: -5.0 dB\nFilter 1: ON PK Fc 200 Hz Gain 2.0 dB Q 0.70\n" },
];

globalThis.fetch = /** @type {typeof fetch} */ (
  /** @type {unknown} */ (
    async (/** @type {string} */ path) =>
      path === "/api/autoeq" ? ok({ meta: { profiles: 2, sha: "0123456789abcdef" }, profiles: PROFILES }) : ok({})
  )
);

const picker = () => renderTree(html`<${LibraryPicker} applyText=${() => {}} />`);

/** @param {VNode} v */
const isHit = (v) => classTokens(v).includes("mtx-lib-hit");

/** @returns {string | null} the model of the hit a fresh render marks selected */
function selectedModel() {
  const sel = picker().seen.find((v) => isHit(v) && classTokens(v).includes("selected"));
  if (!sel) return null;
  const model = [sel.props.children]
    .flat()
    .find((k) => typeof k === "object" && k !== null && "type" in k && k.type === "span");
  return textOf(model);
}

test("a clicked hit is selected and clearLibrarySelection drops it", async () => {
  const input = /** @type {VNode} */ (
    picker().seen.find((v) => v.type === "input" && typeof v.props.onInput === "function")
  );
  await new Promise((resolve) => setImmediate(resolve));
  /** @type {(e: object) => void} */ (input.props.onInput)({ target: { value: "HD 6" } });
  click(clickablesIn(picker().seen.filter(isHit))[0]);
  const afterClick = selectedModel();
  clearLibrarySelection();
  assert.deepEqual([afterClick, selectedModel()], [PROFILES[0].model, null]);
});
