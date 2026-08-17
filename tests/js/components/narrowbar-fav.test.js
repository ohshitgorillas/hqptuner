// Behavioral suite for the narrow bar's favorites-only toggle
// (components/NarrowBar.js): a button on the facet row that engages the
// favorites-only narrowing, disabled while the user has no favorites at all —
// there is nothing an empty favorites set could narrow to.
//
// Policy (docs/testing.md): public API only, one assertion per test, no store
// function stubbed. State is driven by assigning the exported source signals
// the real payloads carry, by resetNarrowing(), and by the favorites set's own
// public toggle. The button is clicked the way narrowbar.test.js clicks a facet
// button — through the onClick its vnode carries, collected via preact's own
// `options.vnode` creation hook (the renderer's public seam).
//
// The toggle is found among the bar's buttons by its favorites marking (a class
// token, title, aria-label or star glyph naming favorites); anything but
// exactly one match throws rather than clicking something else, so a
// restructured bar fails loudly instead of toggling the wrong control.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-fav.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { options } from "preact";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { NarrowBar } from "../../../hqptuner/static/components/NarrowBar.js";
import { config, matrixConfig, enums, metadata, engineState } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrow/state.js";
import {
  favoriteFilters,
  favoritesError,
  toggleFavorite,
  nFavOnly,
} from "../../../hqptuner/static/store/narrow/favorites.js";
import { staticWire } from "../support/wire.js";
import { favoritesState, favoritesRoutes } from "../support/favoriteswire.js";

/** @typedef {import("../support/wheel.js").VNode} VNode */

const FILTERS = [
  { index: "0", name: "gauss-short", value: "0", arg: 0, description: "4/5 transients ⥮ Int", apodizing: false },
  { index: "1", name: "gauss-plain", value: "1", arg: 1, description: "5/5 timbre, space ⥮ Any", apodizing: true },
  { index: "2", name: "gauss-long", value: "2", arg: 0, description: "5/5 timbre ⥮ 2^x", apodizing: false },
];

async function reset() {
  // The favorites set is server-backed: /api/favorites is routed into the
  // suite's own wire so a star's PUT is answered rather than left hanging.
  staticWire({ live: {}, http: {} }, favoritesRoutes(favoritesState()));
  engineState.value = {};
  enums.value = { filters: FILTERS };
  metadata.value = {
    settings: {},
    filters: { filters: {}, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  config.value = { fields: [], file: {}, active: "", profiles: null };
  matrixConfig.value = { fields: [] };
  resetNarrowing();
  favoriteFilters.value = new Set();
  favoritesError.value = "";
  nFavOnly.value = false;
  await discardAll();
}

// One render, with every vnode preact builds along the way; the hook is
// restored even if the render throws, so no case can poison the next.
/** @returns {{ out: string, seen: VNode[] }} */
function renderBar() {
  /** @type {VNode[]} */
  const seen = [];
  const previous = options.vnode;
  options.vnode = (/** @type {VNode} */ vnode) => {
    seen.push(vnode);
    if (previous) previous(vnode);
  };
  try {
    return { out: render(html`<${NarrowBar} />`), seen };
  } finally {
    options.vnode = previous;
  }
}

// Concatenated text of a vnode subtree.
/**
 * @param {unknown} node
 * @returns {string}
 */
function textOf(node) {
  if (node === null || node === undefined || node === false) return "";
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object") {
    const { props } = /** @type {VNode} */ (node);
    if (props) return textOf(props.children);
  }
  return "";
}

// The bar's favorites toggle: the one button marked as the favorites control.
/** @returns {VNode} */
function favButton() {
  const buttons = renderBar().seen.filter((v) => v && v.type === "button" && v.props);
  const marked = buttons.filter((b) => {
    const marking = [b.props.class, b.props.className, b.props.title, b.props["aria-label"]]
      .filter((x) => typeof x === "string")
      .join(" ");
    return /fav|★|☆/i.test(`${marking} ${textOf(b)}`);
  });
  if (marked.length !== 1) throw new Error(`expected one favorites toggle, found ${marked.length}`);
  return marked[0];
}

/** @param {VNode} vnode */
const click = (vnode) => {
  const onClick = /** @type {(event: unknown) => void} */ (vnode.props.onClick);
  onClick({ preventDefault() {}, stopPropagation() {} });
};

// --- disabled while there is nothing to narrow to -------------------------------

test("test_with_zero_favorites_the_toggle_renders_disabled", async () => {
  await reset();
  assert.equal(Boolean(favButton().props.disabled), true);
});

test("test_with_a_favorite_the_toggle_renders_enabled", async () => {
  await reset();
  await toggleFavorite("gauss-plain");
  assert.equal(Boolean(favButton().props.disabled), false);
});

// --- the click engages and releases favorites-only -------------------------------

test("test_clicking_the_toggle_turns_favorites_only_on", async () => {
  await reset();
  await toggleFavorite("gauss-plain");
  click(favButton());
  assert.equal(nFavOnly.value, true);
});

test("test_clicking_the_toggle_again_turns_favorites_only_off", async () => {
  await reset();
  await toggleFavorite("gauss-plain");
  click(favButton());
  click(favButton());
  assert.equal(nFavOnly.value, false);
});
