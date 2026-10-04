// Rendered suite for hqptuner/static/components/faceplate/builders/SnapshotRail.js: one fold per station in the tree's
// order with its count, the loaded station and a station holding a staged edit marked on its fold, a tapped fold opening
// and the open one shutting, the open station's entries on its page, the entry lit with the edit and the same-named one
// in a ticked station, a staged entry, the blank lines a short last page keeps, the pager only past one page, a tapped
// entry and New snapshot going to their record, and a page holding more entries on a taller rail.
//
// The seam is the wire the store reads, stated as tests/js/store/faceplate-builders/snapshot.test.js states it: the
// engine on `engineState` and `enums`, the stations and the loaded one on `config`, the book on `liveBook`; the record
// being edited and its staged edits are the shell's `cur` and `staged`. The rail's height is the `height` prop, since
// its layout-effect measurement never runs under SSR. Every expected string is a station or snapshot name this file put
// in. Which fold is open and which page it shows are the rail's own state, so a case that needs one opens it by tapping.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-builders/rail.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { SnapshotRail } from "../../../../hqptuner/static/components/faceplate/builders/SnapshotRail.js";
import { cur, staged } from "../../../../hqptuner/static/store/faceplate/builders/shell.js";
import { config, engineState, engineStatus, enums } from "../../../../hqptuner/static/store/signals.js";
import { liveBook } from "../../../../hqptuner/static/store/live/presets.js";
import { NEW, keyOf } from "../../../../hqptuner/static/model/builders/builder.js";
import { elements, attr, classes, text } from "../../support/markup.js";
import { renderTree, textOf } from "../../support/vnodeseam.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/wheel.js").VNode} VNode */
/** @typedef {import("../../../../hqptuner/static/model/builders/snapshot.js").Edit} Edit */

//: A rail tall enough for six lines a page, and one for four: with Speakers open, two folds, its pager and New snapshot
//: take 150 and each line 28.
const TALL = 318;
const SHORT = 262;

/** @typedef {{ index: string, value: string, name: string }} EnumItem */

/** @type {EnumItem[]} */
const PCM_FILTERS = [
  { index: "0", value: "40", name: "poly-sinc-gauss-long" },
  { index: "1", value: "41", name: "sinc-M" },
];
/** @type {EnumItem[]} */
const PCM_SHAPERS = [
  { index: "0", value: "5", name: "NS9" },
  { index: "1", value: "6", name: "TPDF" },
];

/**
 * One /config form field quoting a list in the enum-ID domain.
 *
 * @param {string} name
 * @param {string} value
 * @param {EnumItem[]} items
 */
const formField = (name, value, items) => ({
  name,
  value,
  options: items.map((i) => ({ value: i.value, label: i.name })),
});

//: Speakers' ten snapshot names, in list order: past one page at either height, its last page short.
const SPEAKER_NAMES = Array.from({ length: 10 }, (_, i) => `S${String(i + 1).padStart(2, "0")}`);

/** A fresh book: Speakers holds ten snapshots, Headphones two (Desk, Bed). */
const book = () => ({
  Speakers: Object.fromEntries(
    SPEAKER_NAMES.map((n) => [n, { chain: "pcm", fields: { mode: "pcm", filter1x: "40" }, names: {} }]),
  ),
  Headphones: {
    Desk: { chain: "pcm", fields: { mode: "pcm", filter1x: "40", dither: "6" }, names: {} },
    Bed: { chain: "pcm", fields: { filter1x: "41" }, names: {} },
  },
});

/**
 * Write one idle PCM engine onto the wire-side signals, with `active` the loaded station.
 *
 * @param {string} active
 */
function wire(active) {
  engineState.value = { state: "0", active_chain: "pcm", filter1x: "1", filterNx: "0", shaper: "0", adaptive: "1" };
  engineStatus.value = {};
  enums.value = { filters: PCM_FILTERS, shapers: PCM_SHAPERS };
  config.value = {
    fields: [
      { name: "mode", value: "pcm", options: [] },
      formField("filter1x", "40", PCM_FILTERS),
      formField("filter", "41", PCM_FILTERS),
      formField("dither", "6", PCM_SHAPERS),
    ],
    file: {},
    profiles: { options: [{ value: "" }, { value: "Speakers" }, { value: "Headphones" }] },
    active,
  };
}

/**
 * An edit named `name` that Save writes to `stations`.
 *
 * @param {string} name
 * @param {string[]} stations
 * @returns {Edit}
 */
const edit = (name, stations) => ({ name, stations, inc: new Set(["mode"]), vals: { mode: "pcm", pcm: {}, sdm: {} } });

const DESK = { st: "Headphones", name: "Desk" };
const BED = { st: "Headphones", name: "Bed" };

beforeEach(() => {
  wire("Headphones");
  liveBook.value = book();
  staged.value = new Map();
  cur.value = DESK;
});

/** @param {number} height */
const tree = (height) => html`<${SnapshotRail} height=${height} />`;

/**
 * Every element of the rendered rail.
 *
 * @param {number} [height]
 */
const rendered = (height = TALL) => elements(render(tree(height)));

/**
 * The rendered elements named `name` carrying class `cls`.
 *
 * @param {string} name
 * @param {string} cls
 * @param {number} [height]
 */
const tagged = (name, cls, height) => rendered(height).filter((e) => e.name === name && classes(e).includes(cls));

/** The station folds. */
const folds = () => tagged("button", "brh");

/**
 * The snapshot entries, New snapshot left out.
 *
 * @param {number} [height]
 */
const entries = (height) => tagged("button", "bst", height).filter((e) => !classes(e).includes("bnew"));

/** New snapshot's entry, or an empty element when there is none. @returns {MarkupElement} */
const newEntry = () => tagged("button", "bnew")[0] || { name: "", attrs: "", start: -1, html: "" };

/** The open station's pagers. */
const pagers = () => tagged("div", "opg").filter((e) => classes(e).includes("bpg"));

/**
 * Tap the first vnode `pick` finds in one render of the rail.
 *
 * @param {(v: VNode) => boolean} pick
 * @param {number} [height]
 */
function tap(pick, height = TALL) {
  const { seen } = renderTree(tree(height));
  const hit = /** @type {VNode[]} */ (seen).find(pick);
  const onClick = hit && hit.props.onClick;
  if (typeof onClick === "function") onClick();
}

/**
 * Whether a vnode is a host element of tag `name` carrying class `cls`.
 *
 * @param {VNode} v
 * @param {string} name
 * @param {string} cls
 */
const isTagged = (v, name, cls) =>
  v.type === name &&
  String(v.props.class ?? "")
    .split(/\s+/)
    .includes(cls);

/** @param {string} st */
const tapFold = (st) => tap((v) => isTagged(v, "button", "brh") && textOf(v.props.children).includes(st));

/**
 * Tap the open station's page button numbered `k`.
 *
 * @param {number} k
 * @param {number} [height]
 */
const tapPage = (k, height) =>
  tap((v) => isTagged(v, "button", "opb") && textOf(v.props.children).trim() === String(k), height);

/**
 * Open station `st` on its first page: tap its fold unless it is open, then its first page button where it has one.
 *
 * @param {string} st
 * @param {number} [height]
 */
function openOn(st, height) {
  const fold = folds().find((f) => text(f).includes(st));
  if (fold && attr(fold, "aria-expanded") !== "true") tapFold(st);
  tapPage(1, height);
}

test("test_one_fold_per_station_in_the_trees_order", () => {
  assert.deepEqual(tagged("span", "sn").map(text), ["Speakers", "Headphones"]);
});

test("test_each_fold_counts_its_stations_snapshots", () => {
  assert.deepEqual(tagged("span", "cnt").map(text), ["10", "2"]);
});

test("test_only_the_loaded_station_folds_current", () => {
  cur.value = { st: "Speakers", name: "S01" };
  assert.deepEqual(
    folds().map((f) => classes(f).includes("cur")),
    [false, true],
  );
});

test("test_a_station_holding_a_staged_edit_folds_dirty", () => {
  cur.value = { st: "Speakers", name: "S01" };
  staged.value = new Map([[keyOf(DESK), edit("Desk", ["Headphones"])]]);
  assert.deepEqual(
    folds().map((f) => classes(f).includes("dirty")),
    [false, true],
  );
});

test("test_tapping_a_fold_opens_it_and_shuts_the_open_one", () => {
  openOn("Speakers");
  tapFold("Headphones");
  assert.deepEqual(
    folds().map((f) => attr(f, "aria-expanded")),
    ["false", "true"],
  );
});

test("test_the_open_station_titles_one_entry_per_snapshot", () => {
  openOn("Headphones");
  assert.deepEqual(
    entries().map((e) => attr(e, "title")),
    ["Desk", "Bed"],
  );
});

test("test_the_open_station_names_one_entry_per_snapshot", () => {
  openOn("Headphones");
  assert.deepEqual(
    entries().map((e) => text(e)),
    ["Desk", "Bed"],
  );
});

test("test_the_entry_edited_lights_open", () => {
  openOn("Headphones");
  assert.deepEqual(
    entries().map((e) => classes(e).includes("open")),
    [true, false],
  );
});

test("test_the_entry_edited_is_the_current_one", () => {
  openOn("Headphones");
  assert.deepEqual(
    entries().map((e) => attr(e, "aria-current") === "true"),
    [true, false],
  );
});

test("test_the_same_named_entry_in_a_ticked_station_lights_with_the_edit", () => {
  cur.value = { st: "Speakers", name: "S01" };
  staged.value = new Map([[keyOf(cur.value), edit("Bed", ["Speakers", "Headphones"])]]);
  openOn("Headphones");
  assert.deepEqual(
    entries().map((e) => classes(e).includes("open")),
    [false, true],
  );
});

test("test_an_entry_holding_a_staged_edit_is_dirty", () => {
  staged.value = new Map([[keyOf(BED), edit("Bed", ["Headphones"])]]);
  openOn("Headphones");
  assert.deepEqual(
    entries().map((e) => classes(e).includes("dirty")),
    [false, true],
  );
});

test("test_a_short_last_page_keeps_its_lines_with_blank_ones", () => {
  openOn("Speakers");
  tapPage(2);
  assert.deepEqual([entries().length, tagged("div", "bfill").length], [4, 2]);
});

test("test_only_a_station_past_one_page_carries_a_pager", () => {
  openOn("Speakers");
  const past = pagers().length;
  openOn("Headphones");
  assert.deepEqual([past, pagers().length], [1, 0]);
});

test("test_tapping_an_entry_goes_to_its_snapshot", () => {
  openOn("Headphones");
  tap((v) => isTagged(v, "button", "bst") && v.props.title === "Bed");
  assert.deepEqual(cur.value, BED);
});

test("test_new_snapshot_lights_open_only_while_new_is_edited", () => {
  cur.value = { st: "Headphones", name: NEW };
  const whileNew = classes(newEntry()).includes("open");
  cur.value = DESK;
  assert.deepEqual([whileNew, classes(newEntry()).includes("open")], [true, false]);
});

test("test_tapping_new_snapshot_goes_to_new_in_the_loaded_station", () => {
  wire("Speakers");
  tap((v) => isTagged(v, "button", "bnew"));
  assert.deepEqual(cur.value, { st: "Speakers", name: NEW });
});

test("test_a_taller_rail_lists_more_entries_a_page", () => {
  openOn("Speakers", SHORT);
  const short = entries(SHORT).length;
  openOn("Speakers", TALL);
  assert.ok(entries(TALL).length > short, "a taller rail lists more entries a page");
});
