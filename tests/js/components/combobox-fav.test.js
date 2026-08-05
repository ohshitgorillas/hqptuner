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
// The star is found structurally, as the interactive element INSIDE a dd-opt
// row (the row's own onClick is the commit; a nested clickable is the
// affordance that is not it). That couples these cases to the row shape the
// combobox suite already pins; a markup change fails them for a reason that is
// not a regression — check the shape before reading the failure as one.
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
import { stagingWire, quiesce } from "../support/wire.js";
import { favoriteFilters, toggleFavorite, isFavorite } from "../../../hqptuner/static/store/favorites.js";

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

async function start(fields) {
  await reset({ fields });
  for (const name of [...favoriteFilters.value]) toggleFavorite(name);
}

// One render of a Field, with every vnode preact builds along the way.
// `options.vnode` is restored even if the render throws.
function renderField(k) {
  const seen = [];
  const previous = options.vnode;
  options.vnode = (vnode) => {
    seen.push(vnode);
    if (previous) previous(vnode);
  };
  try {
    return { out: render(html`<${Field} k=${k} />`), seen };
  } finally {
    options.vnode = previous;
  }
}

const classTokens = (vnode) => {
  const cls = (vnode.props && (vnode.props.class || vnode.props.className)) || "";
  return typeof cls === "string" ? cls.split(/\s+/) : [];
};

// The dd-opt rows of one rendered field, in document order.
const rowsOf = (seen) => seen.filter((v) => v && v.props && classTokens(v).includes("dd-opt"));

// Concatenated text of a vnode subtree.
function textOf(node) {
  if (node === null || node === undefined || node === false) return "";
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object" && node.props) return textOf(node.props.children);
  return "";
}

// Every clickable vnode strictly inside a subtree (never the subtree root).
function clickablesIn(node, found = []) {
  if (Array.isArray(node)) {
    for (const kid of node) clickablesIn(kid, found);
    return found;
  }
  if (!node || typeof node !== "object" || !node.props) return found;
  if (typeof node.props.onClick === "function") found.push(node);
  return clickablesIn(node.props.children, found);
}

const starsOf = (row) => clickablesIn(row.props.children);

// The star of the row labelled `label`; anything but exactly one match throws
// rather than clicking something else.
function star(seen, label) {
  const row = rowsOf(seen).find((r) => textOf(r).includes(label));
  if (!row) throw new Error(`no dd-opt row labelled ${label}`);
  const stars = starsOf(row);
  if (stars.length !== 1) throw new Error(`expected one star on ${label}, found ${stars.length}`);
  return stars[0];
}

const click = (vnode) => vnode.props.onClick({ preventDefault() {}, stopPropagation() {} });

// --- rendering: the star exists exactly where the fav wiring is -----------------

test("test_each_filter_row_carries_one_star_affordance", async () => {
  await start(FILTER_FIELDS);
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
  await start(FILTER_FIELDS);
  click(star(renderField("pcm_filter_1x").seen, "poly-sinc-xtr-mp"));
  assert.equal(isFavorite("poly-sinc-xtr-mp"), true);
});

test("test_clicking_one_star_leaves_the_other_options_unfavorited", async () => {
  await start(FILTER_FIELDS);
  click(star(renderField("pcm_filter_1x").seen, "poly-sinc-xtr-mp"));
  assert.equal(isFavorite("sinc-M"), false);
});

// A row's own click commits the option; the star's must not — no stage request
// may reach the wire.
test("test_clicking_a_rows_star_commits_no_value", async () => {
  await start(FILTER_FIELDS);
  const w = stagingWire();
  click(star(renderField("pcm_filter_1x").seen, "poly-sinc-xtr-mp"));
  await quiesce(w);
  assert.equal(w.stages.length, 0);
});
