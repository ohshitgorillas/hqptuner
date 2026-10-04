// Behavioral suite for the stage drawer's row grammar in hqptuner/static/store/faceplate/drawer.js: the catalog keys a
// tab stages beyond its rows (a block's keys, a choice line's detail key, a backend group's rows) and so which tab takes
// the dot, when a row left out or a hidden group still makes a tab a restart tab, a drawer's own form standing in for
// the staged set, the tab a closed drawer opens on, and the options and per-option lines a row lists.
//
// Driven at the wire as drawer.test.js is: a staging fake answers the real REST paths and the source signals are
// assigned the shapes their endpoints serve. volume_max stages for a restart, output_mode is an http field the write
// path routes live, idle_time is an http select over the daemon form's own list, and junk_filter is a live select over
// an engine enumeration whose per-option prose the settings metadata carries.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/drawer-grammar.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { config, engineState, enums, metadata, pendingPreset } from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { askWarn, cancel } from "../../../../hqptuner/static/store/ask.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import {
  drawerHead,
  drawerQuestion,
  rowLines,
  rowOptions,
  showTab,
  shownTab,
} from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { stagingWire } from "../../support/wire/wire.js";

/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").BodyItem} BodyItem */

const FIELDS = [
  { name: "volume_max", type: "number", value: -3 },
  { name: "mode", type: "select", value: "pcm" },
  {
    name: "idle_time",
    type: "select",
    value: "30",
    options: [
      { value: "30", label: "30" },
      { value: "60", label: "60" },
    ],
  },
];

beforeEach(async () => {
  stagingWire();
  config.value = { fields: FIELDS, file: {}, active: "", profiles: null };
  engineState.value = { adaptive: 0 };
  enums.value = null;
  metadata.value = null;
  pendingPreset.value = null;
  openPopover.value = null;
  openStage.value = null;
  cancel();
  await discardAll();
});

/**
 * A drawer whose tab `a` holds `body` and whose tab `b` a live row only.
 *
 * @param {string} id
 * @param {BodyItem[]} body
 * @param {Partial<DrawerSchema>} [extra]
 * @returns {DrawerSchema}
 */
const drawerOf = (id, body, extra = {}) => ({
  id,
  title: id,
  aria: id,
  tabs: [
    { id: "a", label: "a", body },
    { id: "b", label: "b", body: [{ row: { key: "output_mode" } }] },
  ],
  ...extra,
});

/**
 * A drawer of one tab holding a field only, its own form reporting `staged`.
 *
 * @param {string} id
 * @param {boolean} staged
 * @returns {DrawerSchema}
 */
const ownForm = (id, staged) => ({
  id,
  title: id,
  aria: id,
  tabs: [
    {
      id: "a",
      label: "a",
      body: [{ field: { id: "f", label: "f", man: [], options: [], value: () => "", set: () => {} } }],
    },
  ],
  own: { staged: () => staged, apply: () => {}, discard: () => {} },
});

/** A choice whose first line's detail control is volume_max. @type {BodyItem} */
const CHOICE = {
  choice: {
    id: "c",
    label: "c",
    man: [],
    value: () => "x",
    pick: () => {},
    lines: [
      { v: "x", label: "x", man: "x", key: "volume_max" },
      { v: "y", label: "y", man: "y" },
    ],
  },
};

test("test_a_staged_key_a_block_names_marks_the_blocks_tab", async () => {
  await edit("volume_max", "-6");
  assert.deepEqual(drawerHead(drawerOf("g1", [{ block: "probe", keys: ["volume_max"] }]), "a").dirty, ["a"]);
});

test("test_a_block_naming_a_restart_key_makes_its_tab_a_restart_tab", () => {
  assert.equal(drawerHead(drawerOf("g2", [{ block: "probe", keys: ["volume_max"] }]), "a").apply.shown, true);
});

test("test_a_staged_choice_detail_key_marks_the_choices_tab", async () => {
  await edit("volume_max", "-6");
  assert.deepEqual(drawerHead(drawerOf("g3", [CHOICE]), "a").dirty, ["a"]);
});

test("test_a_staged_group_row_marks_the_groups_tab", async () => {
  await edit("volume_max", "-6");
  const schema = drawerOf("g4", [{ group: "net", label: "net", rows: [{ key: "volume_max" }] }]);
  assert.deepEqual(drawerHead(schema, "a").dirty, ["a"]);
});

test("test_a_restart_row_in_a_hidden_group_leaves_its_tab_a_live_tab", () => {
  const shown = (/** @type {string} */ backend) =>
    drawerHead(
      drawerOf("g5", [{ group: "net", label: "net", rows: [{ key: "volume_max" }] }], { group: () => backend }),
      "a",
    ).apply.shown;
  assert.deepEqual([shown("alsa"), shown("net"), shown("combo")], [false, true, true]);
});

test("test_a_restart_row_left_out_by_when_leaves_its_tab_a_live_tab", () => {
  const shown = (/** @type {boolean} */ on) =>
    drawerHead(drawerOf("g6", [{ row: { key: "volume_max", when: () => on } }]), "a").apply.shown;
  assert.deepEqual([shown(false), shown(true)], [false, true]);
});

test("test_an_own_forms_staged_state_makes_the_apply_buttons_live", () => {
  const live = [drawerHead(ownForm("o1", false), "a").apply.live, drawerHead(ownForm("o1", true), "a").apply.live];
  assert.deepEqual(live, [false, true]);
});

test("test_an_own_forms_staged_state_dots_a_one_tab_drawers_title", () => {
  assert.equal(drawerHead(ownForm("o2", true), "a").titleDot, true);
});

test("test_an_own_forms_apply_group_shows_with_nothing_staged", () => {
  assert.equal(drawerHead(ownForm("o3", false), "a").apply.shown, true);
});

test("test_a_closed_drawer_shows_the_tab_its_schema_opens_on", () => {
  assert.equal(shownTab(drawerOf("t1", [], { opensOn: () => "b" })), "b");
});

test("test_a_tab_picked_while_open_holds_until_the_drawer_closes", () => {
  const schema = drawerOf("t2", [], { opensOn: () => "b" });
  openStage.value = "t2";
  showTab("t2", "a");
  const open = shownTab(schema);
  openStage.value = null;
  openStage.value = "t2";
  assert.deepEqual([open, shownTab(schema)], ["a", "b"]);
});

test("test_a_tab_picked_while_closed_is_the_one_the_next_opening_shows", () => {
  const schema = drawerOf("t3", [], { opensOn: () => "b" });
  const before = shownTab(schema);
  showTab("t3", "a");
  openStage.value = "t3";
  assert.deepEqual([before, shownTab(schema)], ["b", "a"]);
});

test("test_a_question_asked_by_a_blocks_key_belongs_to_its_drawer", () => {
  askWarn("volume_max", "q");
  assert.equal(drawerQuestion(drawerOf("q1", [{ block: "probe", keys: ["volume_max"] }]))?.owner, "volume_max");
});

test("test_a_rows_own_options_replace_the_catalogs", () => {
  const own = [
    { value: "a", label: "a" },
    { value: "b", label: "b" },
  ];
  assert.deepEqual(
    rowOptions("idle_time", own).map((o) => o.value),
    ["a", "b"],
  );
});

test("test_an_option_line_reads_the_settings_metadata", () => {
  enums.value = {
    junk_filters: [
      { index: 0, name: "none" },
      { index: 1, name: "20k" },
    ],
  };
  metadata.value = { settings: { output: { junk_filter: { label: "", tooltip: "", options: { 0: "n0", 1: "n1" } } } } };
  assert.deepEqual(
    rowLines("junk_filter").map((l) => l.man),
    ["n0", "n1"],
  );
});

test("test_an_option_line_written_in_the_schema_stands_where_the_metadata_has_none", () => {
  const own = [
    { value: "30", label: "30", man: "m30" },
    { value: "60", label: "60", man: "m60" },
  ];
  assert.deepEqual(
    rowLines("idle_time", own).map((l) => l.man),
    ["m30", "m60"],
  );
});

test("test_the_effective_option_is_the_current_line", async () => {
  await edit("idle_time", "60");
  assert.deepEqual(
    rowLines("idle_time").map((l) => l.cur),
    [false, true],
  );
});
