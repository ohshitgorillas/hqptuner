// Rendered suite for hqptuner/static/components/faceplate/lists/Console.js and FacetPopover.js, the narrowing console
// in the option list's head: one window per facet reading its state and lit while it narrows, Reset hidden while the
// console's facets sit at their defaults and clearing only those, a console of its own per list kind, the favorites
// window as a plain switch, the 1x sources window hidden at Nx, a window opening its popover, and the popover's chips,
// segments and checkboxes writing their facets, each carrying the count its pick lands on.
//
// Renders OptionList (the console sits in its head, the popovers beside it on the plate) through
// preact-render-to-string; a tap is fired through the vnode seam. The store is driven at the wire
// (tests/js/support/listsfixture.js). Windows are found by `data-window`, a popover's control groups by `data-facet`,
// chips and segments by their facet value (`data-v`), Reset by its test id. Counts are numbers derived from the
// fixture's lists; no copy is asserted.
//
// Not reachable here: each window sized once to its longest state and a popover parked under its window, both of
// which measure the mounted plate. A browser run closes them.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-lists/console.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { OptionList } from "../../../../hqptuner/static/components/faceplate/lists/OptionList.js";
import { openList, openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { config } from "../../../../hqptuner/static/store/signals.js";
import { flushNarrowing } from "../../../../hqptuner/static/store/narrow/persist.js";
import { facetsMoved, narrowState, setFacet } from "../../../../hqptuner/static/store/faceplate/lists/facets.js";
import { narrowingWire } from "../../support/wire/narrowingwire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements, hasAttr, text } from "../../support/markup.js";
import { loadLists, resetLists } from "../../support/listsfixture.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

beforeEach(() => {
  narrowingWire();
  resetLists();
  loadLists();
  open("sdm_filter_1x");
});

afterEach(async () => {
  await flushNarrowing();
});

/**
 * Open a key's list at a stage.
 *
 * @param {string} key
 * @param {"1x" | "nx"} [stage]
 */
function open(key, stage = "1x") {
  openList.value = { key, stage, value: "", pick: () => undefined };
}

/** Every element the list draws, in document order. @returns {MarkupElement[]} */
const markup = () => elements(render(html`<${OptionList} />`)).sort((a, b) => a.start - b.start);

/** The console's windows. */
const windows = () => markup().filter((e) => attr(e, "data-window") !== undefined);

/**
 * One window, by facet id.
 *
 * @param {string} id
 */
const windowOf = (id) => windows().find((e) => attr(e, "data-window") === id);

/** The console's Reset button. */
const reset = () => markup().find((e) => attr(e, "data-testid") === "narrow-reset");

/**
 * Fire the handler of the first element vnode matching `pred`; answer the props of the vnode hit.
 *
 * @param {(props: Record<string, unknown>) => boolean} pred
 * @param {string} [handler]
 * @param {unknown} [event]
 * @returns {Record<string, unknown> | undefined}
 */
function fire(pred, handler = "onClick", event = undefined) {
  const { seen } = renderTree(html`<${OptionList} />`);
  const hit = seen.find((v) => typeof v.type === "string" && pred(v.props ?? {}));
  const fn = /** @type {((e: unknown) => unknown) | undefined} */ (hit?.props[handler]);
  if (fn) fn(event);
  return hit?.props;
}

/**
 * The count a control in a facet's group carries for one value: the last span inside its button.
 *
 * @param {string} facet
 * @param {string} v
 */
function countOf(facet, v) {
  const group = markup().find((e) => attr(e, "data-facet") === facet);
  const button = group && elements(group.html).find((e) => e.name === "button" && attr(e, "data-v") === v);
  const spans = button ? elements(button.html).filter((e) => e.name === "span") : [];
  const last = spans.sort((a, b) => a.start - b.start).at(-1);
  return last ? text(last) : null;
}

/**
 * Whether a chip in a facet's group is disabled.
 *
 * @param {string} facet
 * @param {string} v
 */
function chipDead(facet, v) {
  const group = markup().find((e) => attr(e, "data-facet") === facet);
  const chip = group && elements(group.html).find((e) => e.name === "button" && attr(e, "data-v") === v);
  return chip ? hasAttr(chip, "disabled") : null;
}

test("test_a_narrowing_facet_lights_its_window_alone", () => {
  setFacet("quality", 3);
  const lit = windows().filter((e) => classes(e).includes("on"));
  assert.deepEqual(
    lit.map((e) => attr(e, "data-window")),
    ["quality"],
  );
});

test("test_reset_hides_while_the_consoles_facets_sit_at_their_defaults", () => {
  const idle = () => {
    const el = reset();
    return el ? classes(el).includes("idle") : null;
  };
  const before = idle();
  setFacet("quality", 3);
  assert.deepEqual([before, idle()], [true, false]);
});

test("test_reset_returns_the_consoles_facets_to_their_defaults", () => {
  setFacet("quality", 3);
  const before = facetsMoved(["quality"]);
  fire((p) => p["data-testid"] === "narrow-reset");
  assert.deepEqual([before, facetsMoved(["quality"])], [true, false]);
});

test("test_reset_on_a_shaper_list_leaves_the_filter_narrowing_alone", () => {
  open("sdm_modulator");
  setFacet("quality", 3);
  setFacet("modTier", ["512+"]);
  fire((p) => p["data-testid"] === "narrow-reset");
  assert.deepEqual([narrowState().quality, narrowState().modTier], [3, []]);
});

test("test_each_list_kind_shows_its_own_console", () => {
  const has = (/** @type {string} */ id) => windowOf(id) !== undefined;
  const bar = () => markup().some((e) => classes(e).includes("fbar"));
  const filters = [has("quality"), has("modTier"), bar()];
  open("sdm_modulator");
  const shapers = [has("modTier"), has("quality")];
  config.value = {
    ...config.value,
    fields: [
      ...config.value.fields,
      {
        name: "pcm_conversion",
        type: "select",
        value: "0",
        options: [
          { value: "0", label: "traditional" },
          { value: "9", label: "sinc-M" },
        ],
      },
    ],
  };
  open("pcm_conversion");
  assert.deepEqual([...filters, ...shapers, bar()], [true, false, true, true, false, false]);
});

test("test_the_favorites_window_switches_favorites_only", () => {
  fire((p) => p["data-window"] === "fav");
  assert.equal(narrowState().fav, true);
});

test("test_a_facet_window_opens_its_own_popover", () => {
  const props = fire((p) => p["data-window"] === "genre");
  assert.equal(openPopover.value, props?.["data-pop"]);
});

test("test_the_1x_sources_window_hides_at_nx", () => {
  const hidden = () => {
    const el = windowOf("lossy");
    return el ? hasAttr(el, "hidden") : null;
  };
  const at1x = hidden();
  open("sdm_filter_nx", "nx");
  assert.deepEqual([at1x, hidden()], [false, true]);
});

test("test_a_genre_chip_writes_its_genre", () => {
  fire((p) => p["data-v"] === "jazz");
  assert.deepEqual(narrowState().genre, ["jazz"]);
});

test("test_a_quality_segment_carries_the_1x_and_nx_counts_its_pick_lands_on", () => {
  assert.deepEqual([countOf("quality", "3"), countOf("quality", "5")], ["2·2", "0·0"]);
});

test("test_an_apodizing_segment_carries_its_own_stages_count", () => {
  assert.deepEqual([countOf("apod1x", "only"), countOf("apodNx", "all")], ["1", "3"]);
});

test("test_a_chip_whose_pick_would_empty_both_lists_is_disabled", () => {
  assert.deepEqual([chipDead("length", "long"), chipDead("length", "short")], [false, true]);
});

test("test_a_rate_rule_checkbox_writes_its_rule", () => {
  fire((p) => p["data-facet"] === "downsafe", "onChange", { target: { checked: true } });
  assert.equal(narrowState().downsafe, true);
});

test("test_a_modulator_rate_floor_chip_counts_the_modulators_it_keeps", () => {
  open("sdm_modulator");
  assert.equal(countOf("modTier", "512+"), "1");
});
