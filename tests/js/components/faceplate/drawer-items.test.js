// Rendered suite for the body items and head parts the stage drawer's grammar adds beyond rows
// (hqptuner/static/components/faceplate/drawer/): a field with no catalog key, a choice's radio lines with their
// detail controls, a section header, a read-only note, a backend group shown by the schema's backend, an intro of
// parts, a tab's status word and the drawer's idle state, and an own form's apply group.
//
// Renders through preact-render-to-string; a handler is fired through the vnode seam (tests/js/support/vnodeseam.js)
// and the store is driven at the wire by the staging fake. A field is found by its id (`data-field`), a choice line by
// its value (`data-v`), a group by its backend (`data-be`); every string asserted is one the test put into the schema.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/drawer-items.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { config, engineState, enums, metadata, pendingPreset } from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { pickApplyMode, showTab } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { ok, stagingWire } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { elements, attr, classes, hasAttr, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").BodyItem} BodyItem */

const FIELDS = [
  { name: "volume_max", type: "number", value: -3 },
  { name: "mode", type: "select", value: "pcm" },
];

/** @type {string[]} */
let applies = [];

/** @param {string} path */
function routes(path) {
  if (path !== "/api/config/apply") return undefined;
  applies.push(path);
  return ok({ report: {} });
}

beforeEach(async () => {
  applies = [];
  stagingWire({ routes });
  config.value = { fields: FIELDS, file: {}, active: "", profiles: null };
  engineState.value = { adaptive: 0 };
  enums.value = null;
  metadata.value = null;
  pendingPreset.value = null;
  openStage.value = null;
  openPopover.value = null;
  cancel();
  await discardAll();
  pickApplyMode("apply");
});

/**
 * A drawer of one tab holding `body`.
 *
 * @param {BodyItem[]} body
 * @param {Partial<DrawerSchema>} [extra]
 * @returns {DrawerSchema}
 */
const drawerOf = (body, extra = {}) => ({
  id: "items",
  title: "items",
  aria: "items",
  tabs: [{ id: "only", label: "only", body }],
  ...extra,
});

/**
 * Every element of a drawer's markup.
 *
 * @param {DrawerSchema} schema
 * @returns {MarkupElement[]}
 */
const markup = (schema) => elements(render(html`<${Drawer} schema=${schema} />`));

/**
 * Fire the click handler of the first vnode matching `pred`.
 *
 * @param {DrawerSchema} schema
 * @param {(props: Record<string, unknown>) => boolean} pred
 */
async function tap(schema, pred) {
  const { seen } = renderTree(html`<${Drawer} schema=${schema} />`);
  const hit = seen.find((v) => typeof v.type === "string" && pred(v.props ?? {}));
  const fn = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (fn) await fn();
}

/** The two options the fields below list. */
const AB = [
  { value: "a", label: "a" },
  { value: "b", label: "b" },
];

/**
 * A drawer holding one field over `value`, writing into `sets`, grayed by `gray` when given.
 *
 * @param {string} value
 * @param {string[]} sets
 * @param {string} [gray]
 * @returns {DrawerSchema}
 */
const fieldOf = (value, sets, gray) =>
  drawerOf([
    {
      field: {
        id: "fx",
        label: "fx",
        man: ["p1", "p2"],
        options: AB,
        value: () => value,
        set: (v) => sets.push(v),
        gray: gray === undefined ? undefined : () => gray,
      },
    },
  ]);

/**
 * The elements inside the field `fx` of a drawer.
 *
 * @param {DrawerSchema} schema
 * @returns {MarkupElement[]}
 */
function inField(schema) {
  const row = markup(schema).find((e) => attr(e, "data-field") === "fx");
  return row ? elements(row.html) : [];
}

/**
 * A drawer holding one choice over `value`, line x's detail volume_max, line y's none; picks land in `picks`.
 *
 * @param {string} value
 * @param {string[]} picks
 * @returns {DrawerSchema}
 */
const choiceOf = (value, picks) =>
  drawerOf([
    {
      choice: {
        id: "cx",
        label: "cx",
        man: ["cp"],
        value: () => value,
        pick: (v) => picks.push(v),
        lines: [
          { v: "x", label: "x", man: "mx", key: "volume_max" },
          { v: "y", label: "y", man: "my" },
        ],
      },
    },
  ]);

/**
 * The elements inside a choice line, found by its value.
 *
 * @param {DrawerSchema} schema
 * @param {string} v
 * @returns {MarkupElement[]}
 */
function inLine(schema, v) {
  const line = markup(schema).find((e) => e.name === "div" && attr(e, "data-v") === v);
  return line ? elements(line.html) : [];
}

test("test_a_field_lights_the_option_its_value_names", () => {
  const on = (/** @type {string} */ v) => {
    const b = inField(fieldOf("b", [])).find((e) => e.name === "button" && attr(e, "data-v") === v);
    return b ? classes(b).includes("on") : null;
  };
  assert.deepEqual([on("b"), on("a")], [true, false]);
});

test("test_tapping_a_fields_option_writes_it_at_once", async () => {
  /** @type {string[]} */
  const sets = [];
  await tap(fieldOf("a", sets), (p) => p["data-v"] === "b");
  assert.deepEqual(sets, ["b"]);
});

test("test_a_fields_gray_reason_disables_its_options", () => {
  const disabled = (/** @type {string | undefined} */ gray) => {
    const b = inField(fieldOf("a", [], gray)).find((e) => e.name === "button");
    return b ? hasAttr(b, "disabled") : null;
  };
  assert.deepEqual([disabled(""), disabled("why")], [false, true]);
});

test("test_a_fields_gray_reason_prints_under_its_options", () => {
  const reason = inField(fieldOf("a", [], "why")).find((e) => classes(e).includes("gr"));
  assert.equal(reason ? text(reason) : undefined, "why");
});

test("test_a_field_prints_each_paragraph_of_its_copy", () => {
  const paras = inField(fieldOf("a", []))
    .filter((e) => e.name === "p")
    .map(text);
  assert.deepEqual(paras, ["p1", "p2"]);
});

test("test_a_choice_checks_the_line_its_value_names", () => {
  const checked = (/** @type {string} */ v) => {
    const radio = inLine(choiceOf("y", []), v).find((e) => attr(e, "role") === "radio");
    return radio ? attr(radio, "aria-checked") : undefined;
  };
  assert.deepEqual([checked("y"), checked("x")], ["true", "false"]);
});

test("test_tapping_a_line_picks_it_and_tapping_the_picked_one_picks_nothing", async () => {
  /** @type {string[]} */
  const picks = [];
  await tap(choiceOf("x", picks), (p) => p.role === "radio" && p["aria-label"] === "y");
  await tap(choiceOf("x", picks), (p) => p.role === "radio" && p["aria-label"] === "x");
  assert.deepEqual(picks, ["y"]);
});

test("test_a_lines_detail_control_is_disabled_unless_its_line_is_picked", () => {
  const disabled = (/** @type {string} */ value) => {
    const input = inLine(choiceOf(value, []), "x").find((e) => e.name === "input");
    return input ? hasAttr(input, "disabled") : null;
  };
  assert.deepEqual([disabled("x"), disabled("y")], [false, true]);
});

test("test_a_lines_detail_control_shows_its_keys_staged_value", async () => {
  await edit("volume_max", "-6");
  const input = inLine(choiceOf("x", []), "x").find((e) => e.name === "input");
  assert.equal(input ? attr(input, "value") : undefined, "-6");
});

test("test_a_choice_line_prints_its_paragraph", () => {
  const paras = inLine(choiceOf("x", []), "y")
    .filter((e) => e.name === "p")
    .map(text);
  assert.deepEqual(paras, ["my"]);
});

test("test_a_head_item_prints_its_section_title", () => {
  const head = markup(drawerOf([{ head: "headfixture" }])).find((e) => classes(e).includes("msec"));
  assert.equal(head ? text(head) : undefined, "headfixture");
});

test("test_a_note_prints_what_its_function_reads_now", () => {
  let now = "first";
  const schema = drawerOf([{ note: () => now }]);
  const read = () => {
    const note = markup(schema).find((e) => classes(e).includes("mnote"));
    return note ? text(note) : undefined;
  };
  const before = read();
  now = "second";
  assert.deepEqual([before, read()], ["first", "second"]);
});

test("test_a_group_shows_while_the_schema_names_its_backend_or_combo", () => {
  const hidden = (/** @type {string} */ backend) => {
    const schema = drawerOf([{ group: "net", label: "net", rows: [{ key: "volume_max" }] }], { group: () => backend });
    const grp = markup(schema).find((e) => attr(e, "data-be") === "net");
    return grp ? hasAttr(grp, "hidden") : null;
  };
  assert.deepEqual([hidden("alsa"), hidden("net"), hidden("combo")], [true, false, false]);
});

test("test_a_drawer_whose_backend_is_combo_reads_combo", () => {
  const combo = (/** @type {string} */ backend) => {
    const aside = markup(drawerOf([], { group: () => backend })).find((e) => e.name === "aside");
    return aside ? classes(aside).includes("combo") : null;
  };
  assert.deepEqual([combo("combo"), combo("net")], [true, false]);
});

test("test_a_group_draws_its_rows", () => {
  const schema = drawerOf([{ group: "net", label: "net", rows: [{ key: "volume_max" }] }], { group: () => "net" });
  const grp = markup(schema).find((e) => attr(e, "data-be") === "net");
  const keys = grp ? elements(grp.html).map((e) => attr(e, "data-k")) : [];
  assert.deepEqual(keys.filter(Boolean), ["volume_max"]);
});

test("test_an_intro_of_parts_prints_strings_and_place_names_plain", () => {
  const intro = markup(drawerOf([{ intro: ["one", { label: "Two" }, "three"] }])).find((e) => e.name === "p");
  assert.equal(intro ? text(intro) : undefined, "oneTwothree");
});

/**
 * A drawer of two tabs, the second with a status word.
 *
 * @type {DrawerSchema}
 */
const STATUSED = {
  id: "st",
  title: "st",
  aria: "st",
  tabs: [
    { id: "run", label: "run", body: [], status: () => "" },
    { id: "other", label: "other", body: [], status: () => "idlefixture" },
  ],
};

test("test_a_tabs_status_word_prints_after_its_label", () => {
  const tab = markup(STATUSED).find((e) => attr(e, "role") === "tab" && attr(e, "data-tab") === "other");
  const word = tab ? elements(tab.html).find((e) => classes(e).includes("cst")) : undefined;
  assert.equal(word ? text(word) : undefined, "idlefixture");
});

test("test_a_drawer_showing_a_tab_with_a_status_reads_idle", () => {
  const idle = (/** @type {string} */ tab) => {
    showTab("st", tab);
    const aside = markup(STATUSED).find((e) => e.name === "aside");
    return aside ? classes(aside).includes("idle") : null;
  };
  assert.deepEqual([idle("other"), idle("run")], [true, false]);
});

/**
 * A one-tab drawer whose own form reports `staged` and counts its applies and discards into `calls`.
 *
 * @param {boolean} staged
 * @param {string[]} calls
 * @returns {DrawerSchema}
 */
const ownOf = (staged, calls) =>
  drawerOf([{ block: "form" }], {
    own: { staged: () => staged, apply: () => calls.push("apply"), discard: () => calls.push("discard") },
  });

test("test_an_own_forms_apply_runs_the_form_and_not_the_staged_set", async () => {
  await edit("volume_max", "-6");
  /** @type {string[]} */
  const calls = [];
  await tap(ownOf(true, calls), (p) => p["data-testid"] === "apply");
  assert.deepEqual([calls, applies], [["apply"], []]);
});

test("test_an_own_forms_discard_runs_the_form", async () => {
  /** @type {string[]} */
  const calls = [];
  await tap(ownOf(true, calls), (p) => p["data-testid"] === "discard");
  assert.deepEqual(calls, ["discard"]);
});

test("test_an_own_forms_apply_needs_no_loaded_station_in_save_mode", () => {
  pickApplyMode("save");
  const b = markup(ownOf(true, [])).find((e) => attr(e, "data-testid") === "apply");
  assert.equal(b ? hasAttr(b, "disabled") : null, false);
});

test("test_a_choice_lines_detail_lists_the_options_the_line_names_in_place_of_the_catalogs", () => {
  const schema = drawerOf([
    {
      choice: {
        id: "cx",
        label: "cx",
        man: ["cp"],
        value: () => "x",
        pick: () => {},
        lines: [{ v: "x", label: "x", man: "mx", key: "output_mode", options: [{ value: "pcm", label: "onlyone" }] }],
      },
    },
  ]);
  const options = inLine(schema, "x")
    .filter((e) => e.name === "button" && attr(e, "data-v") !== undefined)
    .map(text);
  assert.deepEqual(options, ["onlyone"]);
});

test("test_a_row_prints_the_label_its_schema_names_over_the_metadatas", () => {
  const row = markup(drawerOf([{ row: { key: "volume_max", label: "ownlabel" } }])).find(
    (e) => attr(e, "data-k") === "volume_max",
  );
  const head = row ? elements(row.html).find((e) => e.name === "b") : undefined;
  assert.equal(head ? text(head) : undefined, "ownlabel");
});

test("test_a_field_whose_when_is_false_is_left_out", () => {
  const schema = fieldOf("a", []);
  const shown = inField(schema).length > 0;
  const spec = /** @type {{ field: { when?: () => boolean } }} */ (schema.tabs[0].body[0]);
  spec.field.when = () => false;
  assert.deepEqual([shown, inField(schema).length], [true, 0]);
});
