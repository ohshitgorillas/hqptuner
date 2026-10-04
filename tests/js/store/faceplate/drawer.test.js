// Behavioral suite for hqptuner/static/store/faceplate/drawer.js, the stage drawer's store half: which tabs carry a
// dirty dot, when the title carries it, when the apply group shows and when its buttons are live, how a drawer family
// shares its staged state, which tab a drawer shows, which open question a drawer renders, and the apply mode the
// split button runs.
//
// The store is driven at the wire: a staging fake answers the real REST paths (tests/js/support/wire/wire.js) and the
// source signals are assigned the shapes their endpoints serve. The schema keys are v1 catalog keys chosen for their
// lane: volume_max and quick_pause stage for a restart, output_mode is an http field the write path routes live, and
// adaptive_volume is a live-lane setter. The storage key is named because it is the contract a persisted preference
// makes with the browser.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/drawer.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { config, engineState, enums, metadata, pendingPreset } from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { askWarn, cancel } from "../../../../hqptuner/static/store/ask.js";
import { openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import {
  applyMode,
  canSave,
  drawerHead,
  drawerQuestion,
  pickApplyMode,
  registerDrawer,
  runApply,
  showTab,
  shownTab,
} from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { ok, stagingWire } from "../../support/wire/wire.js";
import { useStorage } from "../../support/storage.js";

/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

const STATION = "Living room";

/** The /config form fields the rows read their baselines from. */
const FIELDS = [
  { name: "volume_max", type: "number", value: -3 },
  { name: "quick_pause", type: "checkbox", value: false },
  { name: "mode", type: "select", value: "pcm" },
];

/** @type {string[]} */
let applies = [];

/** @param {string} path @param {{ body?: string }} opts */
function routes(path, opts) {
  if (path !== "/api/config/apply") return undefined;
  applies.push(String(opts.body ?? "{}"));
  return ok({ report: {} });
}

beforeEach(async () => {
  applies = [];
  stagingWire({ routes });
  config.value = { fields: FIELDS, file: {}, active: STATION, profiles: null };
  engineState.value = { adaptive: 0 };
  enums.value = null;
  metadata.value = null;
  pendingPreset.value = null;
  openPopover.value = null;
  cancel();
  await discardAll();
  pickApplyMode("apply");
});

/**
 * A drawer of two tabs: a restart tab and a tab of live rows only.
 *
 * @param {string} id
 * @param {string} [family]
 * @returns {DrawerSchema}
 */
const twoTabs = (id, family) => ({
  id,
  title: id,
  aria: id,
  family,
  tabs: [
    { id: "range", label: "range", body: [{ row: { key: "volume_max" } }] },
    { id: "live", label: "live", body: [{ row: { key: "output_mode" } }, { row: { key: "adaptive_volume" } }] },
  ],
});

/**
 * A drawer of one tab holding one row.
 *
 * @param {string} id
 * @param {string} key
 * @param {string} [family]
 * @returns {DrawerSchema}
 */
const oneTab = (id, key, family) => ({
  id,
  title: id,
  aria: id,
  family,
  tabs: [{ id: "only", label: "only", body: [{ row: { key } }] }],
});

test("test_an_edit_to_a_restart_row_marks_its_tab_and_live_row_edits_mark_none", async () => {
  await edit("volume_max", "-6");
  await edit("output_mode", "sdm");
  await edit("adaptive_volume", "1");
  assert.deepEqual(drawerHead(twoTabs("d1"), "range").dirty, ["range"]);
});

test("test_the_dot_goes_on_the_title_of_a_one_tab_drawer_only", async () => {
  await edit("volume_max", "-6");
  const single = drawerHead(oneTab("d2", "volume_max"), "only").titleDot;
  const many = drawerHead(twoTabs("d3"), "range").titleDot;
  assert.deepEqual([single, many], [true, false]);
});

test("test_the_apply_group_shows_on_a_restart_tab_with_nothing_staged", () => {
  assert.equal(drawerHead(twoTabs("d4"), "range").apply.shown, true);
});

test("test_the_apply_group_hides_on_a_live_tab_until_something_is_staged", async () => {
  const before = drawerHead(twoTabs("d5"), "live").apply.shown;
  await edit("volume_max", "-6");
  const after = drawerHead(twoTabs("d5"), "live").apply.shown;
  assert.deepEqual([before, after], [false, true]);
});

test("test_staged_edits_make_the_apply_buttons_live", async () => {
  await edit("volume_max", "-6");
  assert.equal(drawerHead(twoTabs("d6"), "range").apply.live, true);
});

test("test_a_family_members_staged_edit_lights_the_apply_group_of_its_siblings_only", async () => {
  const sibling = oneTab("f1-a", "volume_max", "f1");
  const other = oneTab("f2-a", "volume_max", "f2");
  registerDrawer(sibling);
  registerDrawer(other);
  registerDrawer(oneTab("f1-b", "quick_pause", "f1"));
  await edit("quick_pause", "1");
  const lit = [drawerHead(sibling, "only").apply.live, drawerHead(other, "only").apply.live];
  assert.deepEqual(lit, [true, false]);
});

test("test_a_drawer_shows_the_tab_last_picked", () => {
  showTab("d7", "live");
  assert.equal(shownTab(twoTabs("d7")), "live");
});

test("test_a_drawer_nobody_picked_a_tab_in_shows_its_first", () => {
  showTab("d8", "live");
  assert.equal(shownTab(twoTabs("d9")), "range");
});

test("test_a_question_asked_by_a_row_belongs_to_the_drawer_holding_that_row", () => {
  askWarn("quick_pause", "q");
  const mine = drawerQuestion(oneTab("d10", "quick_pause")) !== null;
  const theirs = drawerQuestion(oneTab("d11", "volume_max")) !== null;
  assert.deepEqual([mine, theirs], [true, false]);
});

test("test_the_apply_time_question_belongs_to_every_drawer", () => {
  askWarn("pending", "q");
  assert.equal(drawerQuestion(oneTab("d12", "volume_max"))?.owner, "pending");
});

test("test_picking_a_mode_persists_it_under_its_storage_key", () => {
  const storage = useStorage();
  pickApplyMode("save");
  assert.equal(storage.map.get("hqptuner.applyMode"), "save");
});

const MODULE = "../../../../hqptuner/static/store/faceplate/drawer.js";

test("test_the_stored_mode_is_the_mode_the_page_comes_up_with", async () => {
  useStorage().setItem("hqptuner.applyMode", "save");
  const fresh = await import(`${MODULE.replace(/\.js$/, ".fresh-load.js")}`);
  assert.equal(fresh.applyMode.value, "save");
});

test("test_picking_a_mode_closes_the_mode_menu", () => {
  openPopover.value = "applymode";
  pickApplyMode("save");
  assert.equal(openPopover.value, null);
});

test("test_picking_a_mode_outside_the_two_leaves_the_mode_standing", () => {
  pickApplyMode("save");
  pickApplyMode("autosave");
  assert.equal(applyMode.value, "save");
});

test("test_apply_and_save_is_available_only_with_a_loaded_station", () => {
  const loaded = canSave.value;
  config.value = { fields: FIELDS, file: {}, active: "", profiles: null };
  assert.deepEqual([loaded, canSave.value], [true, false]);
});

test("test_the_apply_mode_posts_the_staged_set_without_a_save", async () => {
  await edit("volume_max", "-6");
  await runApply();
  assert.deepEqual(
    applies.map((b) => JSON.parse(b).save),
    [undefined],
  );
});

test("test_the_save_mode_saves_into_the_loaded_station", async () => {
  await edit("volume_max", "-6");
  pickApplyMode("save");
  await runApply();
  assert.deepEqual(
    applies.map((b) => JSON.parse(b).save?.name),
    [STATION],
  );
});

test("test_the_save_mode_sends_nothing_with_no_loaded_station", async () => {
  await edit("volume_max", "-6");
  pickApplyMode("save");
  config.value = { fields: FIELDS, file: {}, active: "", profiles: null };
  await runApply();
  pickApplyMode("apply");
  await runApply();
  assert.equal(applies.length, 1);
});
