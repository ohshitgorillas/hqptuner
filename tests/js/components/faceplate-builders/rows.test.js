// Rendered suite for hqptuner/static/components/faceplate/builders/SnapshotRows.js and StationsMenu.js: the Snapshot
// builder's column heads and one row per view (include box, stage and setting, the snapshot's value, the take button,
// the engine's live value), and the stations menu Save writes to. What each row holds, differs from and takes is
// store/faceplate/builders/snapshot.js's, pinned in tests/js/store/faceplate-builders/snapshot.test.js; this suite pins
// how the rows draw it and what a tap hands back to the store.
//
// Driven at the wire, as the store suite is: /api/state into `engineState`, the loaded chain's enumerations into
// `enums`, the /config form into `config`, the overlays into `metadata`, the snapshot book into `liveBook`, and the
// record being edited into the shell's `cur` with nothing staged. Taps are fired through the renderer's vnode seam,
// since render-to-string fires no events. Every engine name and record name asserted is the fixture's own.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-builders/rows.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { elements, attr, classes, hasAttr, text } from "../../support/markup.js";
import { renderTree, textOf } from "../../support/vnodeseam.js";
import { propsOf } from "../../support/wheel.js";
import { every, inside, first, vcls, fire } from "../../support/rendered/treewalk.js";
import { formField } from "../../support/chainenums.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */
/** @typedef {{ index: string, value: string, name: string }} EnumItem */

const { html } = await import("../../../../hqptuner/static/lib/dom.js");
const { config, engineState, engineStatus, enums, matrixConfig, metadata } =
  await import("../../../../hqptuner/static/store/signals.js");
const { plainNames } = await import("../../../../hqptuner/static/store/ui/prefs.js");
const { liveBook } = await import("../../../../hqptuner/static/store/live/presets.js");
const { openList, openPopover } = await import("../../../../hqptuner/static/store/faceplate/view.js");
const { profileChoices } = await import("../../../../hqptuner/static/store/faceplate/page/profile.js");
const { cur, staged } = await import("../../../../hqptuner/static/store/faceplate/builders/shell.js");
const { editNow } = await import("../../../../hqptuner/static/store/faceplate/builders/snapshot.js");
const { SnapshotRows } = await import("../../../../hqptuner/static/components/faceplate/builders/SnapshotRows.js");
const { StationsMenu } = await import("../../../../hqptuner/static/components/faceplate/builders/StationsMenu.js");

/** @type {EnumItem[]} */
const PCM_FILTERS = [
  { index: "0", value: "40", name: "poly-sinc-gauss-long" },
  { index: "1", value: "41", name: "sinc-M" },
  { index: "2", value: "42", name: "IIR" },
];
/** @type {EnumItem[]} */
const PCM_SHAPERS = [
  { index: "0", value: "5", name: "NS9" },
  { index: "1", value: "6", name: "TPDF" },
];
/** @type {EnumItem[]} */
const SDM_FILTERS = [
  { index: "0", value: "38", name: "poly-sinc-gauss-long" },
  { index: "1", value: "39", name: "sinc-M" },
];
/** @type {EnumItem[]} */
const SDM_SHAPERS = [
  { index: "0", value: "3", name: "ASDM7EC 512+fs" },
  { index: "1", value: "4", name: "ASDM5" },
];

/** A fresh /api/metadata payload: writing the same object to a signal does not notify. */
const overlays = () => ({
  settings: {},
  filters: { filters: {}, aliases: {} },
  shapers: { pcm_dithers: {}, sdm_modulators: {} },
  plain_names: {
    filters: { entries: {}, families: {}, variants: {} },
    dithers: { entries: {}, families: {}, variants: {} },
    modulators: { entries: {}, families: {}, variants: {} },
  },
});

/** A fresh book: Speakers holds one SDM snapshot (S01), Headphones a full PCM one (Desk) and one without Mode (Bed). */
const book = () => ({
  Speakers: {
    S01: { chain: "sdm", fields: { mode: "sdm", oversampling1x: "38", oversampling: "39", modulator: "3" }, names: {} },
  },
  Headphones: {
    Desk: {
      chain: "pcm",
      fields: { mode: "pcm", filter1x: "40", filter: "42", dither: "6", adaptive_volume: "0" },
      names: {},
    },
    Bed: { chain: "pcm", fields: { filter1x: "41", adaptive_volume: "1" }, names: {} },
  },
});

/**
 * Write one idle engine onto the wire-side signals: the PCM chain loaded and running sinc-M, IIR and NS9 with Adaptive
 * volume on unless told otherwise, the SDM chain dormant on the /config form, Headphones loaded.
 *
 * @param {{ f1x?: string, adaptive?: string }} [r]
 */
function wire({ f1x = "1", adaptive = "1" } = {}) {
  engineState.value = { state: "0", active_chain: "pcm", filter1x: f1x, filterNx: "2", shaper: "0", adaptive };
  engineStatus.value = {};
  enums.value = { filters: PCM_FILTERS, shapers: PCM_SHAPERS };
  config.value = {
    fields: [
      { name: "mode", value: "pcm", options: [] },
      formField("filter1x", "40", PCM_FILTERS),
      formField("filter", "41", PCM_FILTERS),
      formField("dither", "6", PCM_SHAPERS),
      formField("oversampling1x", "38", SDM_FILTERS),
      formField("oversampling", "39", SDM_FILTERS),
      formField("modulator", "4", SDM_SHAPERS),
    ],
    file: {},
    profiles: { options: [{ value: "" }, { value: "Speakers" }, { value: "Headphones" }] },
    active: "Headphones",
  };
  matrixConfig.value = { fields: [], rows: [], live_profiles: ["Room EQ", "Desk"], live_active: "Room EQ" };
  metadata.value = overlays();
  plainNames.value = false;
}

/**
 * Put the shell on one record of the book, nothing staged.
 *
 * @param {string} st
 * @param {string} name
 */
function editing(st, name) {
  staged.value = new Map();
  cur.value = { st, name };
}

beforeEach(() => {
  wire();
  liveBook.value = book();
  openList.value = null;
  openPopover.value = null;
  editing("Headphones", "Desk");
});

// --- markup ------------------------------------------------------------------------------------------------------

/** Every element of one render of the rows. */
const drawn = () => elements(render(html`<${SnapshotRows} />`));

/** The rows drawn, column heads left out, in document order. @param {MarkupElement[]} [all] */
const rows = (all = drawn()) => every(all, "div", "brow").filter((r) => attr(r, "data-id") !== undefined);

/** The ids of the rows drawn, in document order. */
const rowIds = () => rows().map((r) => attr(r, "data-id"));

/**
 * One reading of every row drawn, keyed by its id.
 *
 * @template T
 * @param {(row: MarkupElement) => T} read
 * @returns {Record<string, T>}
 */
const byId = (read) => Object.fromEntries(rows().map((r) => [String(attr(r, "data-id")), read(r)]));

// --- taps --------------------------------------------------------------------------------------------------------

/**
 * The vnodes of one render of `tree` that are a `name` carrying every class in `cls`, in document order.
 *
 * @param {Parameters<typeof render>[0]} tree
 * @param {string} name
 * @param {...string} cls
 */
const vnodes = (tree, name, ...cls) =>
  renderTree(tree).seen.filter((v) => v.type === name && cls.every((c) => vcls(v).includes(c)));

/** The rows' vnodes that are a `name` with the classes in `cls`. @param {string} name @param {...string} cls */
const controls = (name, ...cls) => vnodes(html`<${SnapshotRows} />`, name, ...cls);

/**
 * The one control of class `cls` on the row `id`, by the row's place among the rows drawn.
 *
 * @param {string} cls
 * @param {string} id
 */
const rowControl = (cls, id) => controls("button", cls)[rowIds().indexOf(id)];

// --- the column heads --------------------------------------------------------------------------------------------

test("test_tapping_take_all_fills_a_held_row_from_the_engine", async () => {
  await fire(controls("button", "btn", "sm")[0]);
  assert.equal(editNow()?.vals?.pcm?.["1x"], "41");
});

// --- the include box ---------------------------------------------------------------------------------------------

test("test_tapping_an_include_box_holds_a_row_the_snapshot_leaves_out", async () => {
  editing("Headphones", "Bed");
  await fire(rowControl("binc", "mode"));
  assert.equal(editNow()?.inc?.has("mode"), true);
});

test("test_tapping_an_include_box_lets_go_of_a_row_the_snapshot_holds", async () => {
  editing("Headphones", "Bed");
  await fire(rowControl("binc", "adaptive"));
  assert.equal(editNow()?.inc?.has("adaptive"), false);
});

// --- the value cell ----------------------------------------------------------------------------------------------

const lit = () => {
  const [row] = rows().filter((r) => attr(r, "data-id") === "adaptive");
  const on = every(inside(first(row, "div", "bval")), "button", "on")[0];
  return on && attr(on, "data-v");
};

test("test_a_seg_row_lights_the_edits_value_over_the_engines_live_value", () => {
  assert.equal(lit(), "0");
});

test("test_a_seg_row_lights_the_value_of_the_record_now_being_edited", () => {
  editing("Headphones", "Bed");
  assert.equal(lit(), "1");
});

test("test_tapping_a_seg_button_writes_the_edit", async () => {
  const [one] = controls("button").filter((v) => propsOf(v)["data-v"] === "1");
  await fire(one);
  assert.equal(editNow()?.vals?.adaptive, "1");
});

/** The picker on the row `id`, by the row's place among the rows that draw one. @param {string} id */
const pickerOf = (id) => {
  const ids = rows()
    .filter((r) => first(r, "button", "vpick"))
    .map((r) => attr(r, "data-id"));
  return controls("button", "vpick")[ids.indexOf(id)];
};

test("test_tapping_a_list_picker_on_a_pcm_snapshot_opens_the_pcm_chains_list", async () => {
  await fire(pickerOf("1x"));
  assert.equal(openList.value?.key, "pcm_filter_1x");
});

test("test_tapping_a_list_picker_on_a_pcm_snapshot_opens_the_list_at_the_snapshots_value", async () => {
  await fire(pickerOf("1x"));
  assert.equal(openList.value?.value, "poly-sinc-gauss-long");
});

test("test_tapping_a_list_picker_on_an_sdm_snapshot_opens_the_sdm_chains_list", async () => {
  editing("Speakers", "S01");
  await fire(pickerOf("1x"));
  assert.equal(openList.value?.key, "sdm_filter_1x");
});

test("test_tapping_a_list_picker_on_an_sdm_snapshot_opens_the_list_at_the_snapshots_value", async () => {
  editing("Speakers", "S01");
  await fire(pickerOf("1x"));
  assert.equal(openList.value?.value, "poly-sinc-gauss-long");
});

test("test_a_pick_from_the_open_list_writes_the_picked_names_enum_id_into_the_edit", async () => {
  await fire(pickerOf("1x"));
  await openList.value?.pick("IIR");
  assert.equal(editNow()?.vals?.pcm?.["1x"], "42");
});

test("test_the_1x_picker_names_the_list_it_opens_for_the_panel_to_park_at", async () => {
  const picker = first(
    rows().find((r) => attr(r, "data-id") === "1x"),
    "button",
    "vpick",
  );
  const named = picker && attr(picker, "data-list");
  await fire(pickerOf("1x"));
  assert.equal(named, openList.value?.key ?? "no-list-opened");
});

/** The profile row's select in the markup. */
const profileSelect = () =>
  first(
    first(
      rows().find((r) => attr(r, "data-id") === "profile"),
      "div",
      "bval",
    ),
    "select",
    "vfd",
  );

test("test_the_profile_select_lists_the_pages_profile_choices", () => {
  assert.deepEqual(
    every(inside(profileSelect()), "option").map((o) => attr(o, "value") ?? ""),
    profileChoices().options.map((o) => o.value),
  );
});

test("test_the_profile_select_is_disabled_while_the_row_is_off", () => {
  const off = profileSelect();
  assert.equal(off ? hasAttr(off, "disabled") : null, true);
});

test("test_changing_the_profile_select_writes_the_edit", async () => {
  await fire(rowControl("binc", "profile"));
  await fire(controls("select", "vfd")[0], "onChange", { currentTarget: { value: "Desk" } });
  assert.equal(editNow()?.vals?.profile, "Desk");
});

// --- the take button ---------------------------------------------------------------------------------------------

test("test_the_take_button_is_disabled_unless_the_row_can_take", () => {
  assert.deepEqual(
    byId((r) => {
      const take = first(r, "button", "round", "btake");
      return take && hasAttr(take, "disabled");
    }),
    { adaptive: false, "1x": false, nx: true, sh: false, mode: true, profile: true },
  );
});

test("test_tapping_the_take_button_writes_the_live_value_into_the_edit", async () => {
  await fire(rowControl("btake", "1x"));
  assert.equal(editNow()?.vals?.pcm?.["1x"], "41");
});

// --- the live cell -----------------------------------------------------------------------------------------------

test("test_the_live_cell_marks_a_difference_on_a_held_row_the_engine_differs_from", () => {
  wire({ f1x: "0", adaptive: "0" });
  editing("Headphones", "Bed");
  const diff = byId((r) => {
    const live = first(r, "div", "vfd", "blive");
    return live && classes(live).includes("diff");
  });
  assert.equal(diff.adaptive, true);
});

/** @param {MarkupElement} r */
const liveName = (r) => {
  const t = first(first(first(r, "div", "vfd", "blive"), "span", "v"), "span", "bt");
  return t && text(t);
};

test("test_the_1x_rows_live_cell_prints_the_engines_1x_filter_name", () => {
  assert.equal(byId(liveName)["1x"], "sinc-M");
});

test("test_the_nx_rows_live_cell_prints_the_engines_nx_filter_name", () => {
  assert.equal(byId(liveName).nx, "IIR");
});

test("test_the_shaper_rows_live_cell_prints_the_engines_shaper_name", () => {
  assert.equal(byId(liveName).sh, "NS9");
});

test("test_the_profile_rows_live_cell_names_the_engines_active_profile", () => {
  const live = first(
    rows().find((r) => attr(r, "data-id") === "profile"),
    "div",
    "vfd",
    "blive",
  );
  assert.match(live ? text(live) : "", /Room EQ/);
});

test("test_the_idle_mark_shows_only_on_a_chain_the_engine_is_not_running", () => {
  editing("Speakers", "S01");
  assert.deepEqual(
    byId((r) => every(inside(first(r, "div", "vfd", "blive")), "span", "bidle").length),
    { adaptive: 0, "1x": 1, nx: 1, sh: 1, mode: 0, profile: 0 },
  );
});

// --- the stations menu -------------------------------------------------------------------------------------------

const STATIONS = ["Speakers", "Den", "Headphones"];

/** @type {string[][]} */
let picks = [];

/**
 * One stations menu over a book where Speakers and Headphones both hold Desk and Headphones' Desk is being edited.
 *
 * @param {string[]} [ticked]
 */
const menu = (ticked = ["Speakers", "Headphones"]) => html`
  <${StationsMenu}
    stations=${STATIONS}
    ticked=${ticked}
    name="Desk"
    book=${{ Speakers: { Desk: {} }, Den: { Bed: {} }, Headphones: { Desk: {} } }}
    cur=${{ st: "Headphones", name: "Desk" }}
    pick=${(/** @type {string[]} */ list) => void picks.push(list)}
  />
`;

/** Every element of one render of the menu. @param {string[]} [ticked] */
const menuDrawn = (ticked) => elements(render(menu(ticked)));

/** The menu panel drawn. @param {MarkupElement[]} all */
const panel = (all) => all.filter((e) => attr(e, "role") === "menu")[0];

test("test_the_stations_menu_is_hidden_until_its_trigger_is_tapped", () => {
  picks = [];
  const shut = panel(menuDrawn());
  assert.equal(shut ? hasAttr(shut, "hidden") : null, true);
});

test("test_a_row_names_the_record_its_station_already_holds_under_this_name", () => {
  assert.deepEqual(
    every(inside(panel(menuDrawn())), "button", "pmrow").map((r) => {
      const span = first(r, "span");
      return span ? text(span) : null;
    }),
    ["Desk", null, null],
  );
});

test("test_tapping_a_row_picks_the_toggled_stations_in_the_trees_order", async () => {
  picks = [];
  const row = (/** @type {string} */ st) =>
    vnodes(menu(), "button", "pmrow").find((v) => textOf(propsOf(v).children).trim().startsWith(st));
  await fire(row("Den"));
  await fire(row("Speakers"));
  assert.deepEqual(picks, [["Speakers", "Den", "Headphones"], ["Headphones"]]);
});
