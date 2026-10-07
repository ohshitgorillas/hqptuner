// Rendered suite for hqptuner/static/components/faceplate/drawer/: the stage drawer drawn from its schema over the v1
// store. Its frame (closed unless its stage is open, close, tabs and panels), its rows (value, dirty and gray state,
// label and paragraph, the write each control makes), its intro and block items, the open question pinned under its
// head, and the apply group with its split button and mode menu.
//
// Renders through preact-render-to-string. A click is fired through the vnode seam (tests/js/support/vnodeseam.js),
// since server rendering fires no events; the store is driven at the wire by the staging fake. Controls are found by
// their schema key (`data-k`), option value (`data-v`), tab id (`data-tab`) or a `data-testid`; every string asserted
// is one the test itself put on the wire or into the schema.
//
// Not reachable here: the mode menu's placement under its key, which is a stylesheet's, and the menu closing on a
// click outside it, which the plate's document listener owns. A browser run closes both.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawer.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { config, engineState, enums, metadata, pendingPreset } from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { askWarn, cancel, question } from "../../../../hqptuner/static/store/ask.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { applyMode, pickApplyMode, showTab, shownTab } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { ok, stagingWire } from "../../support/wire/wire.js";
import { renderTree, textOf } from "../../support/vnodeseam.js";
import { elements, attr, classes, hasAttr, text } from "../../support/markup.js";

/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */
/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

const STATION = "Living room";

const FIELDS = [
  { name: "volume_max", type: "number", value: -3 },
  { name: "fixed_volume_enabled", type: "checkbox", value: false },
  { name: "quick_pause", type: "checkbox", value: true },
  {
    name: "idle_time",
    type: "select",
    value: "30",
    options: [
      { value: "30", label: "30" },
      { value: "60", label: "60" },
    ],
  },
  { name: "mode", type: "select", value: "pcm" },
];

/** @type {string[]} */
let applies = [];
/** @type {import("../../support/wire/wire.js").StagingWire} */
let wire;

/** @param {string} path @param {{ body?: string }} opts */
function routes(path, opts) {
  if (path !== "/api/config/apply") return undefined;
  applies.push(String(opts.body ?? "{}"));
  return ok({ report: {} });
}

/** @param {string} active */
const loadConfig = (active) => {
  config.value = { fields: FIELDS, file: {}, active, profiles: null };
};

beforeEach(async () => {
  applies = [];
  wire = stagingWire({ routes });
  loadConfig(STATION);
  engineState.value = { adaptive: 0 };
  enums.value = null;
  metadata.value = null;
  pendingPreset.value = null;
  openStage.value = null;
  openPopover.value = null;
  cancel();
  await discardAll();
  pickApplyMode("apply");
  showTab("vol", "range");
});

/** @type {DrawerSchema} */
const VOL = {
  id: "vol",
  title: "vol-title",
  aria: "vol",
  tabs: [
    {
      id: "range",
      label: "range",
      body: [{ intro: "intro-fixture" }, { row: { key: "volume_max" } }, { row: { key: "fixed_volume_enabled" } }],
    },
    { id: "misc", label: "misc", body: [{ row: { key: "quick_pause" } }, { row: { key: "idle_time" } }] },
  ],
};

/**
 * A drawer of one tab holding the given rows.
 *
 * @param {...string} keys
 * @returns {DrawerSchema}
 */
const solo = (...keys) => ({
  id: "solo",
  title: "solo-title",
  aria: "solo",
  tabs: [{ id: "only", label: "only", body: keys.map((key) => ({ row: { key } })) }],
});

/** A drawer whose first tab holds a live row only, and whose second a restart row. @type {DrawerSchema} */
const LIVE_FIRST = {
  id: "mixed",
  title: "mixed-title",
  aria: "mixed",
  tabs: [
    { id: "live", label: "live", body: [{ row: { key: "output_mode" } }] },
    { id: "range", label: "range", body: [{ row: { key: "volume_max" } }] },
  ],
};

/**
 * Every element of a drawer's markup.
 *
 * @param {DrawerSchema} schema
 * @param {Record<string, unknown>} [blocks]
 * @returns {MarkupElement[]}
 */
const markup = (schema, blocks = {}) => elements(render(html`<${Drawer} schema=${schema} blocks=${blocks} />`));

/**
 * The first element matching `pred`, from a drawer's markup.
 *
 * @param {DrawerSchema} schema
 * @param {(el: MarkupElement) => boolean} pred
 * @returns {MarkupElement | undefined}
 */
const find = (schema, pred) => markup(schema).find(pred);

/**
 * The elements inside a row, found by its schema key.
 *
 * @param {DrawerSchema} schema
 * @param {string} key
 * @returns {MarkupElement[]}
 */
function inRow(schema, key) {
  const row = find(schema, (e) => attr(e, "data-k") === key);
  return row ? elements(row.html) : [];
}

/**
 * Fire the handler of the first vnode matching `pred`, or nothing when none matches.
 *
 * @param {DrawerSchema} schema
 * @param {(props: Record<string, unknown>, v: VNode) => boolean} pred
 * @param {string} [handler]
 * @param {unknown} [event]
 */
async function fire(schema, pred, handler = "onClick", event = undefined) {
  const { seen } = renderTree(html`<${Drawer} schema=${schema} blocks=${{}} />`);
  const hit = seen.find((v) => typeof v.type === "string" && pred(v.props ?? {}, v));
  const fn = /** @type {((e: unknown) => unknown) | undefined} */ (hit?.props[handler]);
  if (fn) await fn(event);
}

/** @param {string} id */
const byTestId = (id) => (/** @type {MarkupElement} */ e) => attr(e, "data-testid") === id;

test("test_a_drawer_is_closed_unless_its_stage_is_the_open_one", () => {
  const closed = () => {
    const aside = find(VOL, (e) => e.name === "aside");
    return aside ? hasAttr(aside, "data-closed") : null;
  };
  const before = closed();
  openStage.value = "vol";
  assert.deepEqual([before, closed()], [true, false]);
});

test("test_the_close_button_closes_the_open_drawer", async () => {
  openStage.value = "vol";
  await fire(VOL, (p) => p["data-testid"] === "drawer-close");
  assert.equal(openStage.value, null);
});

test("test_a_staged_edit_marks_its_own_tab_in_the_head", async () => {
  await edit("volume_max", "-6");
  const tab = (/** @type {string} */ id) => {
    const el = find(VOL, (e) => attr(e, "role") === "tab" && attr(e, "data-tab") === id);
    return el ? classes(el).includes("dirty") : false;
  };
  assert.deepEqual([tab("range"), tab("misc")], [true, false]);
});

test("test_a_one_tab_drawer_draws_no_tabs", () => {
  const tabs = (/** @type {DrawerSchema} */ s) => markup(s).filter((e) => attr(e, "role") === "tab").length;
  assert.deepEqual([tabs(solo("volume_max")), tabs(VOL)], [0, 2]);
});

test("test_a_one_tab_drawer_carries_its_dot_on_the_title", async () => {
  await edit("volume_max", "-6");
  const title = find(solo("volume_max"), (e) => e.name === "span" && text(e) === "solo-title");
  assert.equal(title ? classes(title).includes("dirty") : false, true);
});

test("test_only_the_shown_tabs_panel_is_visible", () => {
  showTab("vol", "misc");
  const hidden = (/** @type {string} */ id) => {
    const el = find(VOL, (e) => e.name === "div" && attr(e, "data-tab") === id);
    return el ? hasAttr(el, "hidden") : null;
  };
  assert.deepEqual([hidden("range"), hidden("misc")], [true, false]);
});

test("test_tapping_a_tab_shows_it", async () => {
  await fire(VOL, (p) => p.role === "tab" && p["data-tab"] === "misc");
  assert.equal(shownTab(VOL), "misc");
});

test("test_a_number_row_shows_its_staged_value", async () => {
  await edit("volume_max", "-6");
  const input = inRow(VOL, "volume_max").find((e) => e.name === "input");
  assert.equal(input ? attr(input, "value") : undefined, "-6");
});

test("test_a_segment_row_lights_its_effective_option", () => {
  const on = (/** @type {string} */ v) => {
    const b = inRow(VOL, "fixed_volume_enabled").find((e) => attr(e, "data-v") === v);
    return b ? classes(b).includes("on") : null;
  };
  assert.deepEqual([on("0"), on("1")], [true, false]);
});

test("test_a_checkbox_row_is_a_segment_lighting_its_truth", () => {
  showTab("vol", "misc");
  const on = (/** @type {string} */ v) => {
    const b = inRow(VOL, "quick_pause").find((e) => e.name === "button" && attr(e, "data-v") === v);
    return b ? classes(b).includes("on") : null;
  };
  assert.deepEqual([on("1"), on("0")], [true, false]);
});

test("test_a_select_row_selects_its_effective_option", async () => {
  await edit("idle_time", "60");
  const selected = (/** @type {string} */ v) => {
    const o = inRow(VOL, "idle_time").find((e) => e.name === "option" && attr(e, "value") === v);
    return o ? hasAttr(o, "selected") : null;
  };
  assert.deepEqual([selected("60"), selected("30")], [true, false]);
});

test("test_tapping_a_segment_option_stages_it", async () => {
  await fire(solo("fixed_volume_enabled"), (p) => p["data-v"] === "1");
  assert.equal(wire.staged.http.fixed_volume_enabled, "1");
});

test("test_changing_a_select_row_stages_the_choice", async () => {
  await fire(solo("idle_time"), (p, v) => v.type === "select", "onChange", { currentTarget: { value: "60" } });
  assert.equal(wire.staged.http.idle_time, "60");
});

test("test_changing_a_number_row_stages_the_typed_value", async () => {
  await fire(solo("volume_max"), (p, v) => v.type === "input", "onChange", { currentTarget: { value: "-9" } });
  assert.equal(wire.staged.http.volume_max, "-9");
});

test("test_a_gray_reason_disables_the_rows_control", async () => {
  const disabled = () => {
    const input = inRow(VOL, "volume_max").find((e) => e.name === "input");
    return input ? hasAttr(input, "disabled") : null;
  };
  const before = disabled();
  await edit("fixed_volume_enabled", "1");
  assert.deepEqual([before, disabled()], [false, true]);
});

test("test_a_gray_reason_prints_under_the_rows_control", async () => {
  const printed = () => inRow(VOL, "volume_max").some((e) => classes(e).includes("gr"));
  const before = printed();
  await edit("fixed_volume_enabled", "1");
  assert.deepEqual([before, printed()], [false, true]);
});

test("test_a_staged_row_reads_dirty", async () => {
  const dirty = () => {
    const row = find(VOL, (e) => attr(e, "data-k") === "volume_max");
    return row ? hasAttr(row, "data-dirty") : null;
  };
  const before = dirty();
  await edit("volume_max", "-6");
  assert.deepEqual([before, dirty()], [false, true]);
});

test("test_a_row_takes_its_label_from_the_settings_metadata", () => {
  metadata.value = { settings: { volume: { volume_max: { label: "label-fixture", tooltip: "para-fixture" } } } };
  const label = inRow(VOL, "volume_max").find((e) => e.name === "b");
  assert.equal(label ? text(label) : undefined, "label-fixture");
});

test("test_a_row_takes_its_paragraph_from_the_settings_metadata", () => {
  metadata.value = { settings: { volume: { volume_max: { label: "label-fixture", tooltip: "para-fixture" } } } };
  const para = inRow(VOL, "volume_max").find((e) => e.name === "p");
  assert.equal(para ? text(para) : undefined, "para-fixture");
});

test("test_an_intro_item_prints_its_paragraph", () => {
  assert.equal(markup(VOL).filter((e) => e.name === "p" && text(e) === "intro-fixture").length, 1);
});

test("test_a_block_item_mounts_the_component_the_caller_passes", () => {
  /** @type {DrawerSchema} */
  const schema = { ...solo("volume_max"), tabs: [{ id: "only", label: "only", body: [{ block: "probe" }] }] };
  const probe = () => html`<i data-testid="probe"></i>`;
  assert.equal(markup(schema, { probe }).filter(byTestId("probe")).length, 1);
});

test("test_a_question_from_a_drawer_row_is_pinned_under_its_head", () => {
  askWarn("volume_max", "message-fixture", { confirm: "yes-fixture", decline: "no-fixture" });
  const line = find(VOL, (e) => attr(e, "data-sev") === "warn");
  assert.match(line ? text(line) : "", /message-fixture/);
});

test("test_declining_the_pinned_question_withdraws_it", async () => {
  askWarn("volume_max", "message-fixture", { confirm: "yes-fixture", decline: "no-fixture" });
  await fire(VOL, (p, v) => v.type === "button" && textOf(v) === "no-fixture");
  assert.equal(question.value, null);
});

test("test_confirming_the_pinned_question_answers_yes", async () => {
  /** @type {unknown} */
  let answer;
  askWarn("volume_max", "message-fixture", { confirm: "yes-fixture", decline: "no-fixture" }).then((v) => {
    answer = v;
  });
  await fire(VOL, (p, v) => v.type === "button" && textOf(v) === "yes-fixture");
  await Promise.resolve();
  assert.equal(answer, true);
});

test("test_the_apply_group_on_a_live_tab_shows_once_something_is_staged", async () => {
  const hidden = () => {
    const group = find(LIVE_FIRST, byTestId("apply-group"));
    return group ? hasAttr(group, "hidden") : null;
  };
  const before = hidden();
  await edit("volume_max", "-6");
  assert.deepEqual([before, hidden()], [true, false]);
});

test("test_discard_is_live_only_with_staged_edits", async () => {
  const disabled = () => {
    const b = find(VOL, byTestId("discard"));
    return b ? hasAttr(b, "disabled") : null;
  };
  const before = disabled();
  await edit("volume_max", "-6");
  assert.deepEqual([before, disabled()], [true, false]);
});

test("test_tapping_discard_drops_the_staged_edits", async () => {
  await edit("volume_max", "-6");
  await fire(VOL, (p) => p["data-testid"] === "discard");
  assert.equal("volume_max" in wire.staged.http, false);
});

test("test_tapping_the_split_body_applies_the_staged_set", async () => {
  await edit("volume_max", "-6");
  await fire(VOL, (p) => p["data-testid"] === "apply");
  assert.equal(applies.length, 1);
});

test("test_the_split_body_in_save_mode_needs_a_loaded_station", async () => {
  await edit("volume_max", "-6");
  pickApplyMode("save");
  const disabled = () => {
    const b = find(VOL, byTestId("apply"));
    return b ? hasAttr(b, "disabled") : null;
  };
  const loaded = disabled();
  loadConfig("");
  assert.deepEqual([loaded, disabled()], [false, true]);
});

test("test_the_save_choice_in_the_mode_menu_needs_a_loaded_station", () => {
  const disabled = () => {
    const b = find(VOL, (e) => attr(e, "data-mode") === "save");
    return b ? hasAttr(b, "disabled") : null;
  };
  const loaded = disabled();
  loadConfig("");
  assert.deepEqual([loaded, disabled()], [false, true]);
});

test("test_the_mode_menu_ticks_the_mode_in_force", () => {
  pickApplyMode("save");
  const checked = (/** @type {string} */ m) => {
    const b = find(VOL, (e) => attr(e, "data-mode") === m);
    return b ? attr(b, "aria-checked") : undefined;
  };
  assert.deepEqual([checked("save"), checked("apply")], ["true", "false"]);
});

test("test_picking_a_choice_in_the_mode_menu_sets_the_mode", async () => {
  await fire(VOL, (p) => p["data-mode"] === "save");
  assert.equal(applyMode.value, "save");
});

test("test_the_split_key_opens_the_mode_menu", async () => {
  await fire(VOL, (p, v) => v.type === "button" && p["data-pop"] === "applymode");
  assert.equal(openPopover.value, "applymode");
});
