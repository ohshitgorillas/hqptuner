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

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */
/** @typedef {{ index: string, value: string, name: string }} EnumItem */

const { html } = await import("../../../../hqptuner/static/lib/dom.js");
const { config, engineState, engineStatus, enums, metadata } =
  await import("../../../../hqptuner/static/store/signals.js");
const { plainNames } = await import("../../../../hqptuner/static/store/ui/prefs.js");
const { liveBook } = await import("../../../../hqptuner/static/store/live/presets.js");
const { openList, openPopover } = await import("../../../../hqptuner/static/store/faceplate/view.js");
const { cur, staged } = await import("../../../../hqptuner/static/store/faceplate/builders/shell.js");
const { editNow, snapshotRows } = await import("../../../../hqptuner/static/store/faceplate/builders/snapshot.js");
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

/** The rows a snapshot can hold, sorted. */
const IDS = ["1x", "adaptive", "mode", "nx", "sh"];

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

/**
 * Whether an element is a `name` carrying every class in `cls`.
 *
 * @param {MarkupElement} e
 * @param {string} name
 * @param {string[]} cls
 */
const isA = (e, name, cls) => e.name === name && cls.every((c) => classes(e).includes(c));

/**
 * Every element of a list that is a `name` with the classes in `cls`.
 *
 * @param {MarkupElement[]} all
 * @param {string} name
 * @param {...string} cls
 */
const every = (all, name, ...cls) => all.filter((e) => isA(e, name, cls));

/**
 * The elements inside `e`, `e` itself left out; none when `e` is missing.
 *
 * @param {MarkupElement | undefined} e
 */
const inside = (e) => (e ? elements(e.html).slice(0, -1) : []);

/**
 * The elements directly inside `e`.
 *
 * @param {MarkupElement | undefined} e
 */
const kids = (e) => {
  const all = inside(e);
  return all.filter(
    (k) => !all.some((o) => o !== k && o.start <= k.start && o.start + o.html.length >= k.start + k.html.length),
  );
};

/** The first `name.cls…` inside `e`. @param {MarkupElement | undefined} e @param {string} name @param {...string} cls */
const first = (e, name, ...cls) => every(inside(e), name, ...cls)[0];

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

/** One view of snapshotRows(), by id. @param {string} id */
const viewOf = (id) => snapshotRows()?.find((v) => v.id === id);

// --- taps --------------------------------------------------------------------------------------------------------

/** A vnode's classes. @param {VNode} v */
const vcls = (v) => String(propsOf(v).class ?? propsOf(v).className ?? "").split(/\s+/);

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

/**
 * Fire one handler of a vnode, if it carries it.
 *
 * @param {VNode | undefined} v
 * @param {string} handler
 */
async function fire(v, handler = "onClick") {
  const fn = v ? propsOf(v)[handler] : undefined;
  if (typeof fn === "function") await fn({ preventDefault: () => {}, stopPropagation: () => {} });
}

// --- the column heads --------------------------------------------------------------------------------------------

test("test_the_column_heads_lead_the_rows_with_a_take_all_button_in_the_second_head", () => {
  const all = drawn();
  const [head] = every(all, "div", "brow", "bcols");
  const heads = every(kids(head), "span", "bct");
  assert.deepEqual(
    {
      heads: every(all, "div", "brow", "bcols").length,
      leads: every(all, "div", "brow")[0] === head,
      bct: heads.length,
      blh: heads.map((s) => classes(s).includes("blh")),
      take: every(inside(heads[1]), "button", "btn", "sm").length,
    },
    { heads: 1, leads: true, bct: 2, blh: [false, true], take: 1 },
  );
});

test("test_tapping_take_all_fills_a_held_row_from_the_engine", async () => {
  await fire(controls("button", "btn", "sm")[0]);
  assert.equal(editNow()?.vals?.pcm?.["1x"], "41");
});

// --- one row per view --------------------------------------------------------------------------------------------

test("test_one_row_is_drawn_per_view_in_the_views_order", () => {
  const ids = rowIds();
  assert.deepEqual({ ids, sorted: [...ids].sort() }, { ids: (snapshotRows() ?? []).map((v) => v.id), sorted: IDS });
});

test("test_a_row_without_a_stage_continues_and_a_row_not_on_is_off", () => {
  editing("Headphones", "Bed");
  assert.deepEqual(
    byId((r) => ({ cont: classes(r).includes("cont"), off: classes(r).includes("off") })),
    Object.fromEntries(IDS.map((id) => [id, { cont: !viewOf(id)?.stage, off: id !== "adaptive" }])),
  );
});

// --- the include box ---------------------------------------------------------------------------------------------

test("test_the_include_box_carries_the_rows_hold_and_is_disabled_while_gated", () => {
  editing("Headphones", "Bed");
  assert.deepEqual(
    byId((r) => {
      const box = first(r, "button", "binc");
      return (
        box && {
          role: attr(box, "role"),
          checked: attr(box, "aria-checked"),
          label: hasAttr(box, "aria-label"),
          disabled: hasAttr(box, "disabled"),
        }
      );
    }),
    {
      adaptive: { role: "checkbox", checked: "true", label: true, disabled: false },
      "1x": { role: "checkbox", checked: "false", label: true, disabled: true },
      nx: { role: "checkbox", checked: "false", label: true, disabled: true },
      sh: { role: "checkbox", checked: "false", label: true, disabled: true },
      mode: { role: "checkbox", checked: "false", label: true, disabled: false },
    },
  );
});

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

// --- the setting cell --------------------------------------------------------------------------------------------

test("test_the_setting_cell_shows_the_views_stage_and_label", () => {
  assert.deepEqual(
    byId((r) => {
      const set = first(r, "div", "bset");
      const stage = first(set, "span", "bst2");
      const label = first(first(set, "span", "bl"), "b");
      return { stage: stage ? text(stage) : null, label: label ? text(label) : null };
    }),
    Object.fromEntries(
      IDS.map((id) => [id, { stage: viewOf(id)?.stage || null, label: viewOf(id)?.label ?? "no-such-view" }]),
    ),
  );
});

// --- the value cell ----------------------------------------------------------------------------------------------

test("test_the_value_cell_grays_and_locks_its_controls_while_the_row_is_off", () => {
  editing("Headphones", "Bed");
  assert.deepEqual(
    byId((r) => {
      const cell = first(r, "div", "bval");
      const ctl = every(inside(cell), "button");
      return {
        grayed: cell ? classes(cell).includes("grayed") : null,
        locked: ctl.length > 0 ? ctl.every((b) => hasAttr(b, "disabled")) : null,
      };
    }),
    Object.fromEntries(IDS.map((id) => [id, { grayed: id !== "adaptive", locked: id !== "adaptive" }])),
  );
});

test("test_a_seg_row_draws_segment_buttons_and_a_list_row_a_picker", () => {
  assert.deepEqual(
    byId((r) => {
      const cell = first(r, "div", "bval");
      return {
        seg: every(inside(cell), "div", "seg").length,
        pick: every(inside(cell), "button", "vfd", "vpick").length,
      };
    }),
    {
      adaptive: { seg: 1, pick: 0 },
      "1x": { seg: 0, pick: 1 },
      nx: { seg: 0, pick: 1 },
      sh: { seg: 0, pick: 1 },
      mode: { seg: 1, pick: 0 },
    },
  );
});

test("test_a_seg_row_lights_the_edits_value", () => {
  const lit = () => {
    const [row] = rows().filter((r) => attr(r, "data-id") === "adaptive");
    const on = every(inside(first(row, "div", "bval")), "button", "on")[0];
    return on && attr(on, "data-v");
  };
  const desk = lit();
  editing("Headphones", "Bed");
  assert.deepEqual([desk, lit()], ["0", "1"]);
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

test("test_tapping_a_list_picker_opens_the_option_list_on_the_snapshots_chain_key", async () => {
  await fire(pickerOf("1x"));
  const desk = [openList.value?.key, openList.value?.value];
  openList.value = null;
  editing("Speakers", "S01");
  await fire(pickerOf("1x"));
  const s01 = /** @type {import("../../../../hqptuner/static/store/faceplate/view.js").ListRequest | null} */ (
    openList.value
  );
  assert.deepEqual(
    [desk, [s01?.key, s01?.value]],
    [
      ["pcm_filter_1x", "40"],
      ["sdm_filter_1x", "38"],
    ],
  );
});

test("test_a_pick_from_the_open_list_writes_the_edit", async () => {
  await fire(pickerOf("1x"));
  await openList.value?.pick("42");
  assert.equal(editNow()?.vals?.pcm?.["1x"], "42");
});

// --- the take button ---------------------------------------------------------------------------------------------

test("test_the_take_button_is_disabled_unless_the_row_can_take", () => {
  assert.deepEqual(
    byId((r) => {
      const take = first(r, "button", "round", "btake");
      return take && hasAttr(take, "disabled");
    }),
    { adaptive: false, "1x": false, nx: true, sh: false, mode: true },
  );
});

test("test_tapping_the_take_button_writes_the_live_value_into_the_edit", async () => {
  await fire(rowControl("btake", "1x"));
  assert.equal(editNow()?.vals?.pcm?.["1x"], "41");
});

// --- the live cell -----------------------------------------------------------------------------------------------

test("test_the_live_cell_marks_a_held_row_that_differs", () => {
  assert.deepEqual(
    byId((r) => {
      const live = first(r, "div", "vfd", "blive");
      return live && { diff: classes(live).includes("diff"), title: hasAttr(live, "title") };
    }),
    {
      adaptive: { diff: true, title: true },
      "1x": { diff: true, title: true },
      nx: { diff: false, title: true },
      sh: { diff: true, title: true },
      mode: { diff: false, title: true },
    },
  );
});

test("test_the_live_cell_marks_no_difference_on_a_row_that_is_off", () => {
  wire({ f1x: "0", adaptive: "0" });
  editing("Headphones", "Bed");
  const diff = byId((r) => {
    const live = first(r, "div", "vfd", "blive");
    return live && classes(live).includes("diff");
  });
  assert.deepEqual([diff.adaptive, diff["1x"]], [true, false]);
});

test("test_the_live_cell_prints_the_engines_name_for_a_list_row", () => {
  const bt = byId((r) => {
    const t = first(first(first(r, "div", "vfd", "blive"), "span", "v"), "span", "bt");
    return t && text(t);
  });
  assert.deepEqual([bt["1x"], bt.nx, bt.sh], ["sinc-M", "IIR", "NS9"]);
});

test("test_the_idle_mark_shows_only_on_a_chain_the_engine_is_not_running", () => {
  editing("Speakers", "S01");
  assert.deepEqual(
    byId((r) => every(inside(first(r, "div", "vfd", "blive")), "span", "bidle").length),
    { adaptive: 0, "1x": 1, nx: 1, sh: 1, mode: 0 },
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

test("test_the_stations_trigger_and_its_menu_panel_are_drawn", () => {
  picks = [];
  const all = menuDrawn();
  const [wrap] = every(all, "div", "bstw");
  const [trigger] = every(inside(wrap), "button", "vfd", "bstn");
  const box = panel(all);
  assert.deepEqual(
    {
      trigger: every(inside(wrap), "button", "vfd", "bstn").length,
      popup: trigger && attr(trigger, "aria-haspopup"),
      l: every(inside(trigger), "span", "l").length,
      v: every(inside(trigger), "span", "v").length,
      panel: box ? ["pop", "pmenu", "bstmenu"].map((c) => classes(box).includes(c)) : null,
    },
    { trigger: 1, popup: "menu", l: 1, v: 1, panel: [true, true, true] },
  );
});

test("test_tapping_the_stations_trigger_opens_its_menu", async () => {
  picks = [];
  const shut = panel(menuDrawn());
  await fire(vnodes(menu(), "button", "bstn")[0]);
  const open = panel(menuDrawn());
  assert.deepEqual([shut && hasAttr(shut, "hidden"), open && hasAttr(open, "hidden")], [true, false]);
});

test("test_the_trigger_lists_the_ticked_stations", () => {
  const listed = (/** @type {string[]} */ ticked) => {
    const [v] = every(inside(every(menuDrawn(ticked), "button", "bstn")[0]), "span", "v");
    return v ? text(v).split(" · ") : null;
  };
  assert.deepEqual([listed(["Speakers", "Headphones"]), listed(["Den"])], [["Speakers", "Headphones"], ["Den"]]);
});

test("test_each_station_is_a_menu_row_checked_while_ticked", () => {
  assert.deepEqual(
    every(inside(panel(menuDrawn())), "button", "pmrow").map((r) => {
      const b = first(r, "b");
      return { role: attr(r, "role"), checked: attr(r, "aria-checked"), station: b ? text(b) : null };
    }),
    [
      { role: "menuitemcheckbox", checked: "true", station: "Speakers" },
      { role: "menuitemcheckbox", checked: "false", station: "Den" },
      { role: "menuitemcheckbox", checked: "true", station: "Headphones" },
    ],
  );
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
