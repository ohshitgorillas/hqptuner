// Rendered suite for the row half of the stage drawer's grammar (hqptuner/static/components/faceplate/drawer/): a row's
// sublabel, band tag and hint, the option list it draws under itself with every option's line, the picked option's line
// a select prints full width, a row left out by its `when`, a row's own options, and the widgets drawn as a select, a
// number box or a text box.
//
// Renders through preact-render-to-string; a handler is fired through the vnode seam (tests/js/support/vnodeseam.js)
// and the store is driven at the wire by the staging fake. Rows are found by their schema key (`data-k`), options by
// their value (`data-v`); every string asserted is one the test put on the wire or into the schema.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawer-rows.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { config, engineState, enums, metadata, pendingPreset } from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { stagingWire } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { elements, attr, classes, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").RowSpec} RowSpec */

const FIELDS = [
  { name: "volume_max", type: "number", value: -3 },
  { name: "fixed_volume_enabled", type: "checkbox", value: false },
  { name: "gain_comp", type: "number", value: 0 },
  { name: "matrix_pipelines", type: "text", value: "1" },
  {
    name: "idle_time",
    type: "select",
    value: "30",
    options: [
      { value: "30", label: "30" },
      { value: "60", label: "60" },
    ],
  },
  {
    name: "fft_size",
    type: "select",
    value: "16384",
    options: [
      { value: "16384", label: "16384" },
      { value: "32768", label: "32768" },
    ],
  },
  { name: "mode", type: "select", value: "pcm" },
];

/** @type {import("../../support/wire/wire.js").StagingWire} */
let wire;

beforeEach(async () => {
  wire = stagingWire();
  config.value = { fields: FIELDS, file: {}, active: "", profiles: null };
  engineState.value = { adaptive: 0 };
  enums.value = null;
  metadata.value = null;
  pendingPreset.value = null;
  openStage.value = null;
  openPopover.value = null;
  cancel();
  await discardAll();
});

/** The per-option lines two schemas below write for idle_time. */
const LINED = [
  { value: "30", label: "30", man: "line30" },
  { value: "60", label: "60", man: "line60" },
];

/**
 * A drawer of one tab holding the given rows.
 *
 * @param {...RowSpec} rows
 * @returns {DrawerSchema}
 */
const rowsOf = (...rows) => ({
  id: "rows",
  title: "rows",
  aria: "rows",
  tabs: [{ id: "only", label: "only", body: rows.map((row) => ({ row })) }],
});

/**
 * The elements inside the row drawn for `key`, or none when it is not drawn.
 *
 * @param {DrawerSchema} schema
 * @param {string} key
 * @returns {MarkupElement[]}
 */
function inRow(schema, key) {
  const all = elements(render(html`<${Drawer} schema=${schema} />`));
  const row = all.find((e) => attr(e, "data-k") === key);
  return row ? elements(row.html) : [];
}

/**
 * The text of the first element in a row carrying class `cls`.
 *
 * @param {DrawerSchema} schema
 * @param {string} key
 * @param {string} cls
 * @returns {string | undefined}
 */
function textIn(schema, key, cls) {
  const el = inRow(schema, key).find((e) => classes(e).includes(cls));
  return el ? text(el) : undefined;
}

/**
 * The value attribute of a row's input, or undefined when it draws none of that type.
 *
 * @param {DrawerSchema} schema
 * @param {string} key
 * @param {string} type
 */
function inputValue(schema, key, type) {
  const input = inRow(schema, key).find((e) => e.name === "input" && attr(e, "type") === type);
  return input ? attr(input, "value") : undefined;
}

/**
 * Fire a handler on the first vnode matching `pred`.
 *
 * @param {DrawerSchema} schema
 * @param {(props: Record<string, unknown>, type: unknown) => boolean} pred
 * @param {string} handler
 * @param {unknown} [event]
 */
async function fire(schema, pred, handler, event) {
  const { seen } = renderTree(html`<${Drawer} schema=${schema} />`);
  const hit = seen.find((v) => typeof v.type === "string" && pred(v.props ?? {}, v.type));
  const fn = /** @type {((e: unknown) => unknown) | undefined} */ (hit?.props[handler]);
  if (fn) await fn(event);
}

test("test_a_rows_sublabel_prints_in_its_head", () => {
  assert.equal(textIn(rowsOf({ key: "volume_max", sub: "subfixture" }), "volume_max", "s"), "subfixture");
});

test("test_a_rows_band_tag_prints_in_its_head", () => {
  assert.equal(textIn(rowsOf({ key: "volume_max", band: "LF" }), "volume_max", "band"), "LF");
});

test("test_a_number_rows_hint_prints_after_its_box", () => {
  assert.equal(textIn(rowsOf({ key: "volume_max", hint: "hintfixture" }), "volume_max", "h"), "hintfixture");
});

test("test_an_option_list_lights_the_effective_option", async () => {
  await edit("idle_time", "60");
  const cur = (/** @type {string} */ v) => {
    const b = inRow(rowsOf({ key: "idle_time", optMan: true }), "idle_time").find(
      (e) => attr(e, "role") === "listitem" && attr(e, "data-v") === v,
    );
    return b ? classes(b).includes("cur") : null;
  };
  assert.deepEqual([cur("60"), cur("30")], [true, false]);
});

test("test_an_option_list_prints_every_options_line", () => {
  const listed = inRow(rowsOf({ key: "idle_time", optMan: true, options: LINED }), "idle_time")
    .filter((e) => attr(e, "role") === "listitem")
    .map((li) => elements(li.html).find((e) => e.name === "span"))
    .map((span) => (span ? text(span) : undefined));
  assert.deepEqual(listed, ["line30", "line60"]);
});

test("test_tapping_a_listed_option_stages_it", async () => {
  await fire(
    rowsOf({ key: "idle_time", optMan: true }),
    (p) => p.role === "listitem" && p["data-v"] === "60",
    "onClick",
  );
  assert.equal(wire.staged.http.idle_time, "60");
});

test("test_a_select_with_option_lines_prints_the_picked_ones_under_the_row", async () => {
  await edit("idle_time", "60");
  const shown = textIn(rowsOf({ key: "idle_time", options: LINED }), "idle_time", "optfull") ?? "";
  assert.deepEqual([shown.includes("line60"), shown.includes("line30")], [true, false]);
});

test("test_a_row_whose_when_is_false_is_left_out", () => {
  const drawn = (/** @type {boolean} */ on) =>
    inRow(rowsOf({ key: "volume_max", when: () => on }), "volume_max").length > 0;
  assert.deepEqual([drawn(true), drawn(false)], [true, false]);
});

test("test_a_rows_own_options_replace_the_catalogs", () => {
  const own = [
    { value: "a", label: "a" },
    { value: "b", label: "b" },
  ];
  const values = inRow(rowsOf({ key: "fixed_volume_enabled", options: own }), "fixed_volume_enabled")
    .filter((e) => e.name === "button")
    .map((e) => attr(e, "data-v"));
  assert.deepEqual(values, ["a", "b"]);
});

test("test_a_steps_row_draws_a_select_over_its_options", () => {
  const values = inRow(rowsOf({ key: "fft_size" }), "fft_size")
    .filter((e) => e.name === "option")
    .map((e) => attr(e, "value"));
  assert.deepEqual(values, ["16384", "32768"]);
});

test("test_a_slidernum_row_draws_a_number_box_holding_its_value", async () => {
  await edit("gain_comp", "-3");
  assert.equal(inputValue(rowsOf({ key: "gain_comp" }), "gain_comp", "number"), "-3");
});

test("test_a_knob_row_draws_a_number_box_holding_its_value", async () => {
  await edit("loudness_low_level", "12");
  assert.equal(inputValue(rowsOf({ key: "loudness_low_level" }), "loudness_low_level", "number"), "12");
});

test("test_a_text_row_draws_a_text_box_holding_its_value", async () => {
  await edit("matrix_pipelines", "4");
  assert.equal(inputValue(rowsOf({ key: "matrix_pipelines" }), "matrix_pipelines", "text"), "4");
});

test("test_changing_a_text_row_stages_the_typed_value", async () => {
  await fire(rowsOf({ key: "matrix_pipelines" }), (p, type) => type === "input", "onChange", {
    currentTarget: { value: "8" },
  });
  assert.equal(wire.staged.http.matrix_pipelines, "8");
});
