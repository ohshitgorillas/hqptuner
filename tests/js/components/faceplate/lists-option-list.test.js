// Rendered suite for hqptuner/static/components/faceplate/lists/OptionList.js with its columns and rows: the list a
// chain picker opens over the body, drawn from the wire's enumeration. The rows a list draws and the one selected, the
// pick a row's tap fires and the close that follows, sheet for a filter list and panel for a shaper list, a narrowed-out
// option dropping its row, the Simplified outline's variant heads and the fold a tap or a DAC preference applies, a
// modulator's rate floor badge, and the heart that stars a row through the favorites wire.
//
// Renders through preact-render-to-string; a tap is fired through the vnode seam (tests/js/support/vnodeseam.js). The
// store is driven at the wire (tests/js/support/listsfixture.js) and the open list is the view's `openList` signal.
// Rows are found by `role="option"` and their engine name (`data-v`), hearts by `data-fav`, variant heads by
// `data-var`, the list itself by its test id. Every string asserted is a fixture name or a number derived from one.
//
// Not reachable here: the sheet's height and the panel's parking at its picker, which measure the mounted plate, and
// the tap outside a panel that closes it, a document listener. A browser run closes them.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/lists-option-list.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { OptionList } from "../../../../hqptuner/static/components/faceplate/lists/OptionList.js";
import { openList } from "../../../../hqptuner/static/store/faceplate/view.js";
import { hydrateFavorites, isFavorite } from "../../../../hqptuner/static/store/narrow/favorites.js";
import { flushNarrowing } from "../../../../hqptuner/static/store/narrow/persist.js";
import { setDacType } from "../../../../hqptuner/static/store/ui/faceplate.js";
import { setFacet } from "../../../../hqptuner/static/store/faceplate/lists/facets.js";
import { favoritesWire, puts, settle } from "../../support/wire/favoriteswire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements, hasAttr, text } from "../../support/markup.js";
import { loadLists, resetLists } from "../../support/listsfixture.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

/** @type {string[]} */
let picked = [];

beforeEach(() => {
  favoritesWire();
  resetLists();
  loadLists();
  picked = [];
});

afterEach(async () => {
  await flushNarrowing();
});

/**
 * Open a key's list over the body with `value` running in its field; picks land in `picked`.
 *
 * @param {string} key
 * @param {string} value
 */
function open(key, value) {
  openList.value = { key, stage: key.endsWith("_nx") ? "nx" : "1x", value, pick: (v) => picked.push(v) };
}

/** Every element the list draws, in document order. @returns {MarkupElement[]} */
const markup = () => elements(render(html`<${OptionList} />`)).sort((a, b) => a.start - b.start);

/** The rows the list draws. */
const rowEls = () => markup().filter((e) => attr(e, "role") === "option");

/** The engine names of the rows the list draws, in order. */
const rows = () => rowEls().map((e) => attr(e, "data-v"));

/** The list's own element: the sheet, or the panel. */
const sheet = () => markup().find((e) => attr(e, "data-testid") === "option-list");

/**
 * Fire the handler of the first element vnode matching `pred`, or nothing when none matches.
 *
 * @param {(props: Record<string, unknown>) => boolean} pred
 * @param {string} [handler]
 * @param {unknown} [event]
 */
async function fire(pred, handler = "onClick", event = { stopPropagation: () => undefined }) {
  const { seen } = renderTree(html`<${OptionList} />`);
  const hit = seen.find((v) => typeof v.type === "string" && pred(v.props ?? {}));
  const fn = /** @type {((e: unknown) => unknown) | undefined} */ (hit?.props[handler]);
  if (fn) await fn(event);
  await settle();
}

test("test_an_open_list_draws_a_row_for_each_option_its_enumeration_reports", () => {
  open("sdm_filter_1x", "IIR");
  assert.deepEqual(rows(), ["poly-sinc-gauss-long", "sinc-M", "IIR"]);
});

test("test_the_running_value_is_the_one_selected_row", () => {
  open("sdm_filter_1x", "sinc-M");
  const selected = rowEls().filter((e) => attr(e, "aria-selected") === "true");
  assert.deepEqual(
    selected.map((e) => attr(e, "data-v")),
    ["sinc-M"],
  );
});

test("test_tapping_a_row_hands_its_engine_name_to_the_pick", async () => {
  open("sdm_filter_1x", "sinc-M");
  await fire((p) => p.role === "option" && p["data-v"] === "IIR");
  assert.deepEqual(picked, ["IIR"]);
});

test("test_tapping_a_row_closes_the_list", async () => {
  open("sdm_filter_1x", "sinc-M");
  await fire((p) => p.role === "option" && p["data-v"] === "IIR");
  assert.equal(openList.value, null);
});

test("test_a_filter_list_draws_a_sheet_and_a_shaper_list_a_panel", () => {
  open("sdm_filter_1x", "IIR");
  const filters = sheet();
  open("sdm_modulator", "ASDM5");
  const modulators = sheet();
  const panel = (/** @type {MarkupElement | undefined} */ e) => (e ? classes(e).includes("opanel") : null);
  assert.deepEqual([panel(filters), panel(modulators)], [false, true]);
});

test("test_a_closed_list_is_marked_closed_and_an_open_one_is_not", () => {
  const closed = sheet();
  open("sdm_filter_1x", "IIR");
  const shown = sheet();
  const mark = (/** @type {MarkupElement | undefined} */ e) => (e ? hasAttr(e, "data-closed") : null);
  assert.deepEqual([mark(closed), mark(shown)], [true, false]);
});

test("test_a_narrowed_out_option_draws_no_row", () => {
  setFacet("quality", 3);
  open("sdm_filter_1x", "IIR");
  assert.deepEqual(rows(), ["poly-sinc-gauss-long", "IIR"]);
});

test("test_a_standard_row_names_the_engine_option_and_a_simplified_row_its_leaf", () => {
  const name = () => {
    const row = rowEls().find((e) => attr(e, "data-v") === "IIR");
    const first =
      row &&
      elements(row.html)
        .filter((e) => e.name === "span")
        .sort((a, b) => a.start - b.start)[0];
    return first ? text(first) : null;
  };
  open("sdm_filter_1x", "IIR");
  const standard = name();
  loadLists({ plain: true });
  assert.deepEqual([standard, name()], ["IIR", "Leaf iir"]);
});

test("test_simplified_draws_one_head_for_each_variant_the_list_holds", () => {
  loadLists({ plain: true });
  open("sdm_filter_1x", "IIR");
  const heads = markup().filter((e) => attr(e, "data-var") !== undefined);
  assert.deepEqual(
    heads.map((e) => text(e)),
    ["Var A", "Var B"],
  );
});

test("test_a_family_the_placement_does_not_name_still_lists_its_rows", () => {
  loadLists({ plain: true });
  open("sdm_filter_1x", "IIR");
  assert.deepEqual([...rows()].sort(), ["IIR", "poly-sinc-gauss-long", "sinc-M"]);
});

test("test_tapping_a_variant_head_folds_its_rows", async () => {
  loadLists({ plain: true });
  open("sdm_filter_1x", "IIR");
  await fire((p) => p["data-var"] === "Var A");
  assert.deepEqual([...rows()].sort(), ["IIR", "sinc-M"]);
});

test("test_an_r2r_dac_folds_the_additive_dither_rows", () => {
  loadLists({ plain: true });
  setDacType("r2r");
  open("pcm_dither", "none");
  assert.deepEqual([...rows()].sort(), ["NS9", "none"]);
});

test("test_a_modulator_row_carries_the_badge_its_rate_floor_names", () => {
  open("sdm_modulator", "ASDM5");
  const row = rowEls().find((e) => attr(e, "data-v") === "ASDM7EC 512+fs");
  const badge = row && elements(row.html).find((e) => attr(e, "role") === "img");
  assert.equal(badge ? text(badge) : null, "512+");
});

test("test_a_hearts_tap_stars_its_filter_on_the_favorites_wire", async () => {
  const w = favoritesWire();
  open("sdm_filter_1x", "IIR");
  await fire((p) => p["data-fav"] === "sinc-M");
  assert.deepEqual(puts(w).at(-1), ["sinc-M"]);
});

test("test_a_hearts_tap_stars_without_picking_or_closing", async () => {
  open("sdm_filter_1x", "IIR");
  await fire((p) => p["data-fav"] === "sinc-M");
  assert.deepEqual([isFavorite("sinc-M"), picked, openList.value?.key], [true, [], "sdm_filter_1x"]);
});

test("test_a_starred_filter_draws_its_heart_pressed", async () => {
  favoritesWire({ filters: ["IIR"] });
  await hydrateFavorites();
  open("sdm_filter_1x", "IIR");
  const pressed = markup().filter((e) => attr(e, "data-fav") !== undefined && attr(e, "aria-pressed") === "true");
  assert.deepEqual(
    pressed.map((e) => attr(e, "data-fav")),
    ["IIR"],
  );
});

test("test_a_filter_row_carries_a_heart_and_a_dither_row_none", () => {
  const hearts = () => markup().filter((e) => attr(e, "data-fav") !== undefined).length;
  open("sdm_filter_1x", "IIR");
  const filters = hearts();
  open("pcm_dither", "none");
  assert.deepEqual([filters, hearts()], [3, 0]);
});
