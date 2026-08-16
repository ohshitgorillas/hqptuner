// Behavioral suite for the favorite-filter affordance on the custom combobox
// (controls/Combobox.js `fav`/`onFav`, wired by Field for the filter
// dropdowns): each option row of a filter dropdown carries a star the user
// clicks to toggle that filter's favorite, and a dropdown without the wiring —
// a dither, say — renders exactly the plain rows it renders today.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. State is driven through the field harness's reset (source signals
// plus a faked wire); the favorites set is emptied through its own public
// toggle on every case, because module-level signals outlive a test.
//
// A star is clicked the way narrowbar.test.js clicks a facet button: through
// the onClick its vnode carries, collected via preact's own `options.vnode`
// creation hook — the renderer's public seam, nothing of HQPTuner's stubbed.
// The star is found as a clickable INSIDE a dd-opt row (the row's own onClick is
// the commit) that carries the favorites marking narrowbar-fav.test.js uses — a
// class token, title, aria-label or star glyph naming favorites. That couples
// these cases to the row shape the combobox suite already pins; a markup change
// fails them for a reason that is not a regression — check the shape before
// reading the failure as one.
//
// NOT covered here (SSR reaches the closed state only, and the open flag is a
// module private written by pointer handlers): that a star click leaves the
// pop open. That belongs to the browser hand-back protocol.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/combobox-fav.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { options } from "preact";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Field } from "../../../hqptuner/static/components/Field.js";
import { reset } from "../support/field-harness.js";
import { staticWire, stagingWire, quiesce } from "../support/wire.js";
import { favoritesState, favoritesRoutes } from "../support/favoriteswire.js";
import { favoriteFilters, favoritesError, isFavorite } from "../../../hqptuner/static/store/favorites.js";
import { nApod1x, nQuality } from "../../../hqptuner/static/store/narrowing.js";

const FILTER_FIELDS = [
  {
    name: "filter1x",
    value: "0",
    options: [
      { value: "0", label: "sinc-M" },
      { value: "1", label: "poly-sinc-xtr-mp" },
    ],
  },
];

// A desc-carrying dropdown Field does NOT hand the fav props: a dither. The
// rate sits above NS9's 352.8k floor so no row is rate-grayed and the row text
// is nothing but the label.
const DITHER_FIELDS = [
  { name: "defaults_samplerate", value: "384000" },
  {
    name: "dither",
    value: "0",
    options: [
      { value: "0", label: "TPDF" },
      { value: "1", label: "NS9" },
    ],
  },
];

/**
 * @typedef {import("../support/wheel.js").VNode} VNode
 * @typedef {import("../support/field-harness.js").ConfigField} ConfigField
 */

// The favorites set is server-backed now, so the harness's own wire has to keep
// answering /api/favorites: an unanswered PUT from a star click would leave a
// promise nothing settles. The set and its error line are emptied by assigning
// the exported signals, the way the source signals are driven everywhere else.
/** @param {ConfigField[]} fields */
async function start(fields) {
  await reset({ fields });
  favoriteFilters.value = new Set();
  favoritesError.value = "";
  staticWire({ live: {}, http: {} }, favoritesRoutes(favoritesState()));
}

// The FILTER fixture, which the 1x stage narrows: its apodizing switch defaults
// to apodizing-only and the quality facet to a 3/5 floor, and neither spares any
// option, the selected one included — so a case wanting both filter rows listed
// opens both first. The dither fixture is not narrowed at all and starts
// through `start` alone.
async function startFilters() {
  await start(FILTER_FIELDS);
  nApod1x.value = "all";
  nQuality.value = 0;
}

// One render of a Field, with every vnode preact builds along the way.
// `options.vnode` is restored even if the render throws.
/** @param {string} k */
function renderField(k) {
  /** @type {VNode[]} */
  const seen = [];
  const previous = options.vnode;
  options.vnode = (/** @type {VNode} */ vnode) => {
    seen.push(vnode);
    if (previous) previous(vnode);
  };
  try {
    return { out: render(html`<${Field} k=${k} />`), seen };
  } finally {
    options.vnode = previous;
  }
}

/** @param {VNode} vnode */
const classTokens = (vnode) => {
  const cls = (vnode.props && (vnode.props.class || vnode.props.className)) || "";
  return typeof cls === "string" ? cls.split(/\s+/) : [];
};

// The dd-opt rows of one rendered field, in document order.
/** @param {VNode[]} seen */
const rowsOf = (seen) => seen.filter((v) => v && v.props && classTokens(v).includes("dd-opt"));

// Concatenated text of a vnode subtree.
/**
 * @param {unknown} node
 * @returns {string}
 */
function textOf(node) {
  if (node === false || node == null) return "";
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node !== "object" || node === null) return "";
  const props = /** @type {VNode} */ (node).props;
  return props ? textOf(props.children) : "";
}

// Every clickable vnode strictly inside a subtree (never the subtree root).
/**
 * @param {unknown} node
 * @param {VNode[]} [found]
 * @returns {VNode[]}
 */
function clickablesIn(node, found = []) {
  if (Array.isArray(node)) {
    for (const kid of node) clickablesIn(kid, found);
    return found;
  }
  if (!node || typeof node !== "object" || !("props" in node) || !node.props) return found;
  const vnode = /** @type {VNode} */ (node);
  if (typeof vnode.props.onClick === "function") found.push(vnode);
  return clickablesIn(vnode.props.children, found);
}

// The favorites marking narrowbar-fav.test.js identifies the bar's toggle by: a
// class token, title, aria-label or star glyph naming favorites. A clickable
// carrying none of it is some other affordance — a label wrapped in a clickable
// span is not a star — so counting bare clickables would score a row with no
// star at all.
/** @param {VNode} vnode */
const favMarked = (vnode) => {
  const marking = [vnode.props.class, vnode.props.className, vnode.props.title, vnode.props["aria-label"]]
    .filter((x) => typeof x === "string")
    .join(" ");
  return /fav|★|☆/i.test(`${marking} ${textOf(vnode)}`);
};

/** @param {VNode} row */
const starsOf = (row) => clickablesIn(row.props.children).filter(favMarked);

// The star of the row labelled `label`; anything but exactly one match throws
// rather than clicking something else.
/**
 * @param {VNode[]} seen
 * @param {string} label
 */
function star(seen, label) {
  const row = rowsOf(seen).find((r) => textOf(r).includes(label));
  if (!row) throw new Error(`no dd-opt row labelled ${label}`);
  const stars = starsOf(row);
  if (stars.length !== 1) throw new Error(`expected one star on ${label}, found ${stars.length}`);
  return stars[0];
}

/** @param {VNode} vnode */
const click = (vnode) =>
  /** @type {(event: object) => void} */ (vnode.props.onClick)({ preventDefault() {}, stopPropagation() {} });

// --- rendering: the star exists exactly where the fav wiring is -----------------

test("test_each_filter_row_carries_one_star_affordance", async () => {
  await startFilters();
  const { seen } = renderField("pcm_filter_1x");
  assert.deepEqual(
    rowsOf(seen).map((r) => starsOf(r).length),
    [1, 1],
  );
});

test("test_a_dropdown_without_fav_wiring_renders_rows_with_no_star", async () => {
  await start(DITHER_FIELDS);
  const { seen } = renderField("pcm_dither");
  assert.deepEqual(
    rowsOf(seen).map((r) => starsOf(r).length),
    [0, 0],
  );
});

test("test_a_dropdown_without_fav_wiring_keeps_its_row_text_bare", async () => {
  await start(DITHER_FIELDS);
  const { seen } = renderField("pcm_dither");
  assert.deepEqual(
    rowsOf(seen).map((r) => textOf(r).trim()),
    ["TPDF", "NS9"],
  );
});

// --- clicking: the star toggles THAT filter's favorite, and nothing else ---------

test("test_clicking_a_rows_star_marks_that_filter_favorite", async () => {
  await startFilters();
  click(star(renderField("pcm_filter_1x").seen, "poly-sinc-xtr-mp"));
  assert.equal(isFavorite("poly-sinc-xtr-mp"), true);
});

test("test_clicking_one_star_leaves_the_other_options_unfavorited", async () => {
  await startFilters();
  click(star(renderField("pcm_filter_1x").seen, "poly-sinc-xtr-mp"));
  assert.equal(isFavorite("sinc-M"), false);
});

// A row's own click commits the option; the star's must not — no stage request
// may reach the wire. The star's OWN request (PUT /api/favorites) is routed and
// answered, so `quiesce` sees a wire that went quiet rather than one still
// waiting.
test("test_clicking_a_rows_star_commits_no_value", async () => {
  await startFilters();
  const w = stagingWire({ routes: favoritesRoutes(favoritesState()) });
  click(star(renderField("pcm_filter_1x").seen, "poly-sinc-xtr-mp"));
  await quiesce(w);
  assert.equal(w.stages.length, 0);
});
