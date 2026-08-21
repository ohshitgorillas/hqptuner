// Behavioral suite for the modulator dropdown's two new row markings: the
// favorite heart every option row carries, and the RATE TIER badge a modulator
// with a minimum-rate floor wears.
//
// The floor is the shaper overlay's `min_rate_hz`, joined to the engine's own
// modulator name (docs/architecture.md §2) and reaching the client through
// /api/metadata under `shapers.sdm_modulators` — the same record that already
// grays a row below its floor. The badge names the DSD tier that floor admits:
// 10240000 -> 256+, 20480000 and 22579200 -> 512+, 40960000 -> 1024+. A
// modulator whose record carries no floor wears none, and a filter dropdown
// never wears one at all — the filter fixture below is handed a `min_rate_hz`
// in its own overlay record for exactly that reason, so the absence is the
// dropdown-type rule at work rather than a fixture with nothing to badge.
//
// Every case renders at 49152000 bits/s, above every floor in the fixture, so
// no row is rate-grayed and the markings are read off ordinary rows.
//
// A badge is found by the text a reader sees — the elements inside the row
// whose whole text reads as a tier (`256+`, `512+`, `1024+`) — never by a class
// the component happens to use. The heart is found by the `dd-fav` marking the
// combobox suites already pin (tests/js/components/combobox-fav.test.js, which
// the click helpers here are lifted from), and clicked through the onClick its
// vnode carries, collected via preact's own `options.vnode` creation hook: the
// renderer's public seam, nothing of HQPTuner's stubbed.
//
// Behavior 26 is Standard option style, where no plain-names overlay text
// applies: the ` 512+fs` rate suffix an engine name carries is dropped from the
// ROW, while the closed control still reads the full raw name the config holds.
// The row's name is read with its own markings (heart, tier badge) excised, so
// the badge reading "512+" cannot be mistaken for the trimmed suffix.
//
// NOT covered here (SSR reaches the closed state only, and the open flag is a
// module private written by pointer handlers): that a heart click leaves the
// pop OPEN. Same gap combobox-fav.test.js documents; it belongs to the browser
// hand-back protocol.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/combobox-tier.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { reset, field, META } from "../support/field-harness.js";
import { renderField, textOf } from "../support/vnodeseam.js";
import { elements, classes, text } from "../support/markup.js";
import { staticWire, stagingWire, quiesce } from "../support/wire.js";
import { favoritesState, favoritesRoutes } from "../support/favoriteswire.js";
import {
  favoriteFilters,
  favoriteModulators,
  favoritesError,
  isFavoriteModulator,
} from "../../../hqptuner/static/store/narrow/favorites.js";
import { nApod1x, nQuality } from "../../../hqptuner/static/store/narrow/state.js";
import { plainNames } from "../../../hqptuner/static/store/prefs.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../support/wheel.js").VNode} VNode */
/** @typedef {import("../support/field-harness.js").ConfigField} ConfigField */

// --- the fixtures -------------------------------------------------------------
// One modulator per real floor the shipped overlay carries, plus a floorless
// one. Names are raw engine names; three of them carry the engine's own rate
// suffix, which Standard style trims off the row.

/** @type {[name: string, floor: number | null][]} */
const MODULATORS = [
  ["DSD7 256+fs", 10240000],
  ["AMSDM7 512+fs", 20480000],
  ["ASDM7EC-super 512+fs", 22579200],
  ["AHM5EC5L", 40960000],
  ["ASDM7", null],
];

const BITRATE = "49152000";

/** @type {ConfigField[]} */
const MODULATOR_FIELDS = [
  { name: "defaults_bitrate", value: BITRATE },
  {
    name: "modulator",
    value: "0",
    options: MODULATORS.map(([label], i) => ({ value: String(i), label })),
  },
];

const META_TIERS = {
  ...META,
  shapers: {
    ...META.shapers,
    sdm_modulators: Object.fromEntries(
      MODULATORS.map(([name, floor]) => [
        name,
        floor === null ? { description: "A modulator." } : { min_rate_hz: floor },
      ]),
    ),
  },
  // A filter overlay record carrying a floor of its own: a component reading
  // `min_rate_hz` off any overlay rather than off the modulator dropdown's
  // would badge this row, so the filter cases below fail loudly instead of
  // passing on a fixture with nothing to badge.
  filters: {
    ...META.filters,
    filters: {
      ...META.filters.filters,
      "sinc-M": { description: "A very long sinc.", min_rate_hz: 22579200 },
      "poly-sinc-xtr-mp": { description: "Extra transient.", min_rate_hz: 40960000 },
    },
  },
};

/** @type {ConfigField[]} */
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

// The favorites set is server-backed, so the harness's own wire has to keep
// answering /api/favorites: an unanswered PUT from a heart click would leave a
// promise nothing settles. Both sets and the error line are emptied by
// assigning the exported signals, the way every source signal is driven.
/** @param {ConfigField[]} fields */
async function start(fields) {
  await reset({ fields, meta: META_TIERS });
  plainNames.value = false;
  favoriteFilters.value = new Set();
  favoriteModulators.value = new Set();
  favoritesError.value = "";
  staticWire({ live: {}, http: {} }, favoritesRoutes(favoritesState()));
}

async function modulatorField() {
  await start(MODULATOR_FIELDS);
  return field("sdm_modulator");
}

// The 1x stage narrows to apodizing and a 3/5 quality floor by default, and
// neither spares the fixture's rows; these cases are about the markings.
async function filterField() {
  await start(FILTER_FIELDS);
  nApod1x.value = "all";
  nQuality.value = 0;
  return field("pcm_filter_1x");
}

// --- markup readers ------------------------------------------------------------

/** @param {MarkupElement} el */
const endOf = (el) => el.start + el.html.length;

/**
 * Whether `a` encloses `b` in the fragment (and is not `b` itself).
 *
 * @param {MarkupElement} a
 * @param {MarkupElement} b
 */
const encloses = (a, b) =>
  a.start <= b.start && endOf(a) >= endOf(b) && !(a.start === b.start && a.html.length === b.html.length);

/**
 * The dd-opt rows of a render, in document order.
 *
 * @param {string} out
 * @returns {MarkupElement[]}
 */
const rows = (out) =>
  elements(out)
    .filter((el) => classes(el).includes("dd-opt"))
    .sort((a, b) => a.start - b.start);

/**
 * The option row whose text includes `needle`. Throws when no row does, so an
 * absence fails loudly instead of comparing against nothing.
 *
 * @param {string} out
 * @param {string} needle
 * @returns {MarkupElement}
 */
function rowIncluding(out, needle) {
  const hit = rows(out).find((el) => text(el).includes(needle));
  if (!hit) throw new Error(`no option row reads "${needle}"`);
  return hit;
}

// A rate tier as a reader sees it: a whole number of DSD multiples with a "+".
const TIER = /^\d+\+$/;

/**
 * The distinct tier wordings rendered inside a region, by the text they show.
 * Distinct rather than raw, so a badge that wraps its own text in a span is
 * one badge rather than two.
 *
 * @param {string} out
 * @param {MarkupElement} box
 * @returns {string[]}
 */
const tiersIn = (out, box) => [
  ...new Set(
    elements(out)
      .filter((el) => encloses(box, el) && TIER.test(text(el)))
      .map(text),
  ),
];

/**
 * @param {string} out
 * @param {MarkupElement} row
 * @returns {MarkupElement[]}
 */
const heartsIn = (out, row) => elements(out).filter((el) => classes(el).includes("dd-fav") && encloses(row, el));

/**
 * A row's NAME: its text with its own markings — the favorite heart and the
 * tier badge — excised whole, so neither can be read as part of the name.
 *
 * @param {string} out
 * @param {MarkupElement} row
 * @returns {string}
 */
function nameOf(out, row) {
  const markings = elements(out).filter(
    (el) => encloses(row, el) && (classes(el).includes("dd-fav") || TIER.test(text(el))),
  );
  const bare = markings.reduce((markup, el) => markup.replace(el.html, " "), row.html);
  return text({ ...row, html: bare });
}

/**
 * Text a user reads off the closed combobox button — the same reader
 * combobox-plainnames.test.js uses.
 *
 * @param {string} out
 * @returns {string}
 */
function boxText(out) {
  const m = /<button\b[^<>]*\bclass="[^"]*\bdd-box\b[^"]*"[^<>]*>([\s\S]*?)<\/button>/.exec(out || "");
  if (!m) throw new Error("no closed combobox button in the rendered output");
  return m[1].replace(/<[^<>]*>/g, "").trim();
}

// --- vnode readers, for the one affordance SSR cannot click ---------------------

/** @param {VNode} vnode */
const classTokens = (vnode) => {
  const cls = (vnode.props && (vnode.props.class || vnode.props.className)) || "";
  return typeof cls === "string" ? cls.split(/\s+/) : [];
};

/** @param {VNode[]} seen */
const vnodeRows = (seen) => seen.filter((v) => v && v.props && classTokens(v).includes("dd-opt"));

/**
 * Every clickable vnode strictly inside a subtree (never the subtree root).
 *
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

/** @param {VNode} vnode */
const favMarked = (vnode) => classTokens(vnode).includes("dd-fav");

/**
 * The heart of the row reading `label`; anything but exactly one match throws
 * rather than clicking something else.
 *
 * @param {VNode[]} seen
 * @param {string} label
 * @returns {VNode}
 */
function heart(seen, label) {
  const row = vnodeRows(seen).find((r) => textOf(r).includes(label));
  if (!row) throw new Error(`no dd-opt row labeled ${label}`);
  const hearts = clickablesIn(row.props.children).filter(favMarked);
  if (hearts.length !== 1) throw new Error(`expected one heart on ${label}, found ${hearts.length}`);
  return hearts[0];
}

/** @param {VNode} vnode */
const click = (vnode) =>
  /** @type {(event: object) => void} */ (vnode.props.onClick)({ preventDefault() {}, stopPropagation() {} });

// --- the favorite heart on a modulator row --------------------------------------

test("test_each_modulator_row_carries_one_favorite_heart", async () => {
  const out = await modulatorField();
  assert.deepEqual(
    rows(out).map((r) => heartsIn(out, r).length),
    MODULATORS.map(() => 1),
  );
});

test("test_clicking_a_modulator_rows_heart_marks_that_modulator_favorite", async () => {
  await start(MODULATOR_FIELDS);
  click(heart(renderField("sdm_modulator").seen, "ASDM7EC-super"));
  assert.equal(isFavoriteModulator("ASDM7EC-super 512+fs"), true);
});

test("test_clicking_one_modulator_heart_leaves_the_other_modulators_unstarred", async () => {
  await start(MODULATOR_FIELDS);
  click(heart(renderField("sdm_modulator").seen, "ASDM7EC-super"));
  assert.equal(isFavoriteModulator("ASDM7"), false);
});

// A row's own click commits the option; the heart's must not — no stage request
// may reach the wire. The heart's OWN request (PUT /api/favorites) is routed and
// answered, so `quiesce` sees a wire that went quiet rather than one still
// waiting.
test("test_clicking_a_modulator_rows_heart_commits_no_value", async () => {
  await start(MODULATOR_FIELDS);
  const w = stagingWire({ routes: favoritesRoutes(favoritesState()) });
  click(heart(renderField("sdm_modulator").seen, "ASDM7EC-super"));
  await quiesce(w);
  assert.equal(w.stages.length, 0);
});

// --- the rate tier badge -----------------------------------------------------------
// One case per floor the shipped overlay carries. Rows are located by the part
// of the name before the rate suffix, which Standard style keeps.

/** @type {[needle: string, floor: number, tier: string][]} */
const TIERS = [
  ["DSD7", 10240000, "256+"],
  ["AMSDM7", 20480000, "512+"],
  ["ASDM7EC-super", 22579200, "512+"],
  ["AHM5EC5L", 40960000, "1024+"],
];

for (const [needle, floor, tier] of TIERS) {
  test(`test_a_modulator_floored_at_${floor}_wears_the_${tier.replace("+", "plus")}_tier_badge`, async () => {
    const out = await modulatorField();
    assert.deepEqual(tiersIn(out, rowIncluding(out, needle)), [tier]);
  });
}

// The floorless row, found by the NAME reader rather than by a text needle:
// "ASDM7" is a prefix of three other rows in the fixture.
test("test_a_modulator_with_no_minimum_rate_wears_no_tier_badge", async () => {
  const out = await modulatorField();
  const row = rows(out).find((r) => nameOf(out, r) === "ASDM7");
  if (!row) throw new Error('no option row names exactly "ASDM7"');
  assert.deepEqual(tiersIn(out, row), []);
});

test("test_a_filter_row_wears_no_tier_badge", async () => {
  const out = await filterField();
  assert.deepEqual(tiersIn(out, rowIncluding(out, "sinc-M")), []);
});

test("test_no_filter_row_wears_a_tier_badge", async () => {
  const out = await filterField();
  assert.deepEqual(
    rows(out).map((r) => tiersIn(out, r).length),
    [0, 0],
  );
});

// --- Standard style trims the engine's rate suffix off the ROW ---------------------

test("test_standard_style_drops_the_rate_suffix_from_a_modulator_rows_name", async () => {
  const out = await modulatorField();
  assert.equal(nameOf(out, rowIncluding(out, "ASDM7EC-super")), "ASDM7EC-super");
});

test("test_standard_style_keeps_the_full_raw_name_on_the_closed_control", async () => {
  await start([
    { name: "defaults_bitrate", value: BITRATE },
    {
      name: "modulator",
      value: "2",
      options: MODULATORS.map(([label], i) => ({ value: String(i), label })),
    },
  ]);
  assert.equal(boxText(field("sdm_modulator")), "ASDM7EC-super 512+fs");
});
