// Rendered suite for hqptuner/static/components/faceplate/builders/SnapshotBuilder.js: the body of rail, hairline and
// page; the page's title row with Delete only on a saved record, Discard and Save following the state, and the close
// going back to the chain; the head's name window, stations menu and caption; the confirm line only while a question is
// asked, its first button answering and its second cancelling; the rows closing the page; Delete asking and Save with
// no name refusing.
//
// Driven at the wire, as tests/js/components/faceplate-builders/rail.test.js is: the engine on `engineState` and
// `enums`, the stations and the loaded one on `config`, the book on `liveBook`; the record being edited, its staged
// edits, the confirm line's question and the refusal are the shell's `cur`, `staged`, `ask` and `refused`, and the body
// on the plate is the view's `body`. Taps and typing are fired through the renderer's vnode seam, since
// render-to-string fires no events; a control the page draws itself is found by walking its own vnode tree in document
// order, the close as the title row's one button that is not a `btn`. Every name asserted is the fixture's own.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-builders/builder.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { SnapshotBuilder } from "../../../../hqptuner/static/components/faceplate/builders/SnapshotBuilder.js";
import { SnapshotRail } from "../../../../hqptuner/static/components/faceplate/builders/SnapshotRail.js";
import { SnapshotRows } from "../../../../hqptuner/static/components/faceplate/builders/SnapshotRows.js";
import { StationsMenu } from "../../../../hqptuner/static/components/faceplate/builders/StationsMenu.js";
import { cur, staged, ask, refused } from "../../../../hqptuner/static/store/faceplate/builders/shell.js";
import { editNow } from "../../../../hqptuner/static/store/faceplate/builders/snapshot.js";
import { body, openStage, openList, openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { config, engineState, engineStatus, enums } from "../../../../hqptuner/static/store/signals.js";
import { liveBook } from "../../../../hqptuner/static/store/live/presets.js";
import { NEW, keyOf } from "../../../../hqptuner/static/model/builders/builder.js";
import { elements, attr, classes, hasAttr, text } from "../../support/markup.js";
import { renderTree } from "../../support/vnodeseam.js";
import { propsOf } from "../../support/wheel.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/wheel.js").VNode} VNode */
/** @typedef {import("../../../../hqptuner/static/model/builders/snapshot.js").Edit} Edit */
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

/** A fresh book: Headphones holds Desk and Bed, Speakers one. */
const book = () => ({
  Speakers: { S01: { chain: "pcm", fields: { mode: "pcm", filter1x: "40" }, names: {} } },
  Headphones: {
    Desk: { chain: "pcm", fields: { mode: "pcm", filter1x: "40", dither: "6" }, names: {} },
    Bed: { chain: "pcm", fields: { filter1x: "41" }, names: {} },
  },
});

/** Write one idle PCM engine onto the wire-side signals, Headphones loaded. */
function wire() {
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
    active: "Headphones",
  };
}

const DESK = { st: "Headphones", name: "Desk" };
const BED = { st: "Headphones", name: "Bed" };
const FRESH = { st: "Headphones", name: NEW };

//: A question the confirm line is handed, and a name typed into the name window.
const QUESTION = "Lounge already holds this one";
const TYPED = "Lounge";

/**
 * Desk's edit renamed, staged so the record reads dirty.
 *
 * @returns {Edit}
 */
const renamed = () => ({
  name: "Desk2",
  stations: ["Headphones"],
  inc: new Set(["mode"]),
  vals: { mode: "pcm", adaptive: "1", pcm: {}, sdm: {} },
});

/** Stage Desk's renamed edit. */
const dirtyDesk = () => {
  staged.value = new Map([[keyOf(DESK), renamed()]]);
};

/** How many times the question's own action ran. */
let runs = 0;

beforeEach(() => {
  wire();
  liveBook.value = book();
  staged.value = new Map();
  cur.value = DESK;
  ask.value = null;
  refused.value = false;
  body.value = "snapshots";
  openStage.value = null;
  openList.value = null;
  openPopover.value = null;
  runs = 0;
});

const tree = () => html`<${SnapshotBuilder} />`;

// --- markup ------------------------------------------------------------------------------------------------------

/** Every element of one render of the builder. */
const drawn = () => elements(render(tree()));

/**
 * Whether an element is a `name` carrying every class in `cls`.
 *
 * @param {MarkupElement | undefined} e
 * @param {string} name
 * @param {string[]} cls
 */
const isEl = (e, name, cls) => e !== undefined && e.name === name && cls.every((c) => classes(e).includes(c));

/**
 * Every element of a list that is a `name` with the classes in `cls`.
 *
 * @param {MarkupElement[]} all
 * @param {string} name
 * @param {...string} cls
 */
const every = (all, name, ...cls) => all.filter((e) => isEl(e, name, cls));

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

/** The first `name.cls…` of one render. @param {string} name @param {...string} cls */
const one = (name, ...cls) => every(drawn(), name, ...cls)[0];

/** The title row's small buttons, in document order. */
const titleButtons = () => every(inside(one("div", "btitle")), "button", "btn", "sm");

/** Whether the title row's Discard is disabled. */
const discardOff = () => {
  const b = titleButtons().at(-2);
  return b && hasAttr(b, "disabled");
};

/** Whether the title row's Save is disabled. */
const saveOff = () => {
  const b = titleButtons().at(-1);
  return b && hasAttr(b, "disabled");
};

/** The name window's input. */
const nameInput = () => every(inside(one("label", "vfd", "bname")), "input", "bnin")[0];

/** The head's caption. */
const caption = () => every(inside(one("div", "bhead")), "div", "bcap")[0];

/** The confirm lines drawn. */
const askLines = () => every(drawn(), "div", "bask").filter((e) => attr(e, "role") === "alert");

// --- vnodes ------------------------------------------------------------------------------------------------------

/** A vnode's classes. @param {VNode | undefined} v */
const vcls = (v) => (v ? String(propsOf(v).class ?? propsOf(v).className ?? "").split(/\s+/) : []);

/**
 * Whether a vnode is a host `name` carrying every class in `cls`.
 *
 * @param {VNode | undefined} v
 * @param {string} name
 * @param {...string} cls
 */
const isV = (v, name, ...cls) => v !== undefined && v.type === name && cls.every((c) => vcls(v).includes(c));

/**
 * Whether a value is a vnode.
 *
 * @param {unknown} c
 * @returns {c is VNode}
 */
const isVNode = (c) => typeof c === "object" && c !== null && "type" in c && "props" in c;

/**
 * The vnodes directly under `v`, empty slots left out.
 *
 * @param {VNode | undefined} v
 * @returns {VNode[]}
 */
const vkids = (v) => (v ? [propsOf(v).children].flat(Infinity).filter(isVNode) : []);

/**
 * `v` and every vnode under it, in document order; a component's own output is not under it.
 *
 * @param {VNode | undefined} v
 * @returns {VNode[]}
 */
const descend = (v) => (v ? [v, ...vkids(v).flatMap(descend)] : []);

/** The first vnode of one render that is a host `name.cls…`. @param {string} name @param {...string} cls */
const vone = (name, ...cls) => renderTree(tree()).seen.find((v) => isV(v, name, ...cls));

/** The title row's small buttons' vnodes, in document order. */
const vtitleButtons = () => descend(vone("div", "btitle")).filter((v) => isV(v, "button", "btn", "sm"));

/** The title row's close: its one button that is not a `btn`. */
const vclose = () => descend(vone("div", "btitle")).filter((v) => v.type === "button" && !vcls(v).includes("btn"))[0];

/**
 * Fire one handler of a vnode, if it carries it.
 *
 * @param {VNode | undefined} v
 * @param {string} [handler]
 * @param {Record<string, unknown>} [extra]  what the event carries beyond the no-op methods
 */
async function fire(v, handler = "onClick", extra = {}) {
  const fn = v ? propsOf(v)[handler] : undefined;
  if (typeof fn === "function") await fn({ preventDefault: () => {}, stopPropagation: () => {}, ...extra });
}

/** Type `value` into the name window. @param {string} value */
const typeName = (value) => {
  const box = descend(vone("label", "vfd", "bname")).find((v) => isV(v, "input", "bnin"));
  const target = { value };
  return fire(box, "onInput", { target, currentTarget: target });
};

/** Put the fixture's question on the confirm line. */
const asking = () => {
  ask.value = {
    text: QUESTION,
    onConfirm: () => {
      runs += 1;
    },
  };
};

// --- the body ----------------------------------------------------------------------------------------------------

test("test_the_snapshots_body_holds_the_rail_the_hairline_and_the_page_in_that_order", () => {
  const root = renderTree(tree()).seen.find((v) => isV(v, "div", "body") && propsOf(v)["data-body"] === "snapshots");
  const k = vkids(root);
  assert.deepEqual(
    [k.length, k[0]?.type === SnapshotRail, isV(k[1], "div", "vrule"), isV(k[2], "main", "page", "bpage")],
    [3, true, true, true],
  );
});

test("test_the_page_carries_an_accessible_name", () => {
  const page = one("main", "page", "bpage");
  assert.equal(page ? hasAttr(page, "aria-label") : null, true);
});

test("test_the_page_runs_title_head_confirm_line_then_the_rows", () => {
  asking();
  const k = vkids(vone("main", "page", "bpage"));
  assert.deepEqual(
    [
      k.length,
      isV(k[0], "div", "btitle"),
      isV(k[1], "div", "bhead"),
      isV(k[2], "div", "bask"),
      k[3]?.type === SnapshotRows,
    ],
    [4, true, true, true, true],
  );
});

// --- the title row -----------------------------------------------------------------------------------------------

test("test_the_title_row_carries_delete_only_on_a_saved_record", () => {
  const saved = titleButtons().length;
  cur.value = FRESH;
  assert.deepEqual([saved, titleButtons().length], [3, 2]);
});

test("test_discard_is_disabled_while_the_edit_is_clean", () => {
  const clean = discardOff();
  dirtyDesk();
  assert.deepEqual([clean, discardOff()], [true, false]);
});

test("test_save_is_disabled_only_on_a_clean_saved_record", () => {
  const clean = saveOff();
  dirtyDesk();
  const dirty = saveOff();
  staged.value = new Map();
  cur.value = FRESH;
  assert.deepEqual([clean, dirty, saveOff()], [true, false, false]);
});

test("test_tapping_close_shows_the_chain", async () => {
  await fire(vclose());
  const fromSnapshots = body.value;
  body.value = "settings";
  await fire(vclose());
  assert.deepEqual([fromSnapshots, body.value], ["chain", "chain"]);
});

test("test_tapping_delete_asks_to_remove_the_record_edited", async () => {
  cur.value = BED;
  await fire(vtitleButtons()[0]);
  assert.equal(ask.value?.text.includes("Bed"), true);
});

test("test_tapping_save_with_no_name_refuses", async () => {
  cur.value = FRESH;
  await fire(vtitleButtons().at(-1));
  assert.equal(refused.value, true);
});

// --- the head ----------------------------------------------------------------------------------------------------

test("test_the_name_window_holds_its_legend_then_its_input", () => {
  const k = kids(one("label", "vfd", "bname"));
  assert.deepEqual([k.length, isEl(k[0], "span", ["l"]), isEl(k[1], "input", ["bnin"])], [2, true, true]);
});

test("test_the_name_window_shows_the_edits_name", () => {
  const clean = nameInput();
  dirtyDesk();
  const dirty = nameInput();
  assert.deepEqual([clean && attr(clean, "value"), dirty && attr(dirty, "value")], ["Desk", "Desk2"]);
});

test("test_the_name_window_takes_at_most_forty_characters", () => {
  const box = nameInput();
  assert.equal(box ? attr(box, "maxlength") : null, "40");
});

test("test_typing_a_name_renames_the_edit", async () => {
  await typeName(TYPED);
  assert.equal(editNow().name, TYPED);
});

test("test_typing_a_name_clears_the_refusal", async () => {
  cur.value = FRESH;
  refused.value = true;
  await typeName(TYPED);
  assert.equal(refused.value, false);
});

test("test_the_head_holds_the_stations_menu", () => {
  assert.equal(descend(vone("div", "bhead")).filter((v) => v.type === StationsMenu).length, 1);
});

test("test_the_caption_holds_the_refusal_only_while_refused", () => {
  const before = every(inside(caption()), "span", "bref").length;
  refused.value = true;
  assert.deepEqual([before, every(inside(caption()), "span", "bref").length], [0, 1]);
});

test("test_the_caption_reads_only_on_a_new_record", () => {
  const saved = caption();
  cur.value = FRESH;
  const fresh = caption();
  assert.deepEqual([saved && text(saved) !== "", fresh && text(fresh) !== ""], [false, true]);
});

// --- the confirm line --------------------------------------------------------------------------------------------

test("test_the_confirm_line_shows_only_while_a_question_is_asked", () => {
  const idle = askLines().length;
  asking();
  assert.deepEqual([idle, askLines().length], [0, 1]);
});

test("test_the_confirm_line_shows_the_question_asked", () => {
  asking();
  const said = kids(askLines()[0])
    .filter((k) => k.name !== "button")
    .map(text);
  assert.deepEqual(said, [QUESTION]);
});

/** The confirm line's buttons' vnodes, in document order. */
const vaskButtons = () => descend(vone("div", "bask")).filter((v) => isV(v, "button", "btn", "sm"));

test("test_the_confirm_lines_first_button_answers_the_question", async () => {
  asking();
  await fire(vaskButtons()[0]);
  assert.deepEqual([runs, ask.value], [1, null]);
});

test("test_the_confirm_lines_second_button_cancels_the_question", async () => {
  asking();
  await fire(vaskButtons()[1]);
  assert.deepEqual([runs, ask.value], [0, null]);
});
