// Behavioral suite for hqptuner/static/store/faceplate/xref.js: the place a reason line names as its cause or fix,
// and going there. A reason the matrix bypass, fixed volume or a 0/0 range gives, the gated-loudness line that begins
// with one of the volume reasons, the Speakers drawer's Direct SDM line and the DSD meter line each name their place;
// a line naming none, or naming the tab it sits on, carries no link, while one on another tab of the drawer it names
// links that tab. Going to a place opens its drawer on its tab,
// a tab the drawer would not open on included, and closes the open popover.
//
// Reason lines are produced by the app's own graying rules over a table of effective values; every value asserted is
// a place id or a drawer or tab id.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/xref.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { goTo, reasonXref } from "../../../../hqptuner/static/store/faceplate/xref.js";
import { openList, openPopover, openStage, togglePopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { showTab, shownTab } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import {
  isSdm,
  loudnessGated,
  matrixBypassed,
  volumeBypassed,
  volumeRangeGray,
} from "../../../../hqptuner/static/store/schema/gray.js";
import { DIRECT_SDM_NOTE } from "../../../../hqptuner/static/store/faceplate/drawers/speakers.js";
import { METER_NOTES } from "../../../../hqptuner/static/store/faceplate/drawers/source.js";

/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

/**
 * A graying context over a table of effective values.
 *
 * @param {Record<string, string | number | boolean>} table
 */
const ctx = (table) => ({ mode: "", effective: (/** @type {string} */ k) => table[k] });

/**
 * A drawer of the given tab ids.
 *
 * @param {string} id
 * @param {string[]} tabs
 * @param {() => string} [opensOn]
 * @returns {DrawerSchema}
 */
const drawerOf = (id, tabs, opensOn) => ({
  id,
  title: id,
  aria: id,
  tabs: tabs.map((t) => ({ id: t, label: t, body: [] })),
  opensOn,
});

const VOLUME = drawerOf("volume", ["level", "gain", "range"]);
const DSD = drawerOf("dsd", ["pcm", "sdm"], () => "pcm");

const BYPASSED = matrixBypassed(ctx({}));

beforeEach(() => {
  openStage.value = null;
  openPopover.value = null;
  openList.value = null;
  showTab("volume", "gain");
});

test("test_a_matrix_bypass_reason_names_the_matrix_engine", () => {
  assert.equal(reasonXref(BYPASSED, { drawer: "crossfeed" }), "matrix");
});

test("test_a_fixed_volume_reason_names_the_level_tab", () => {
  assert.equal(
    reasonXref(volumeRangeGray(ctx({ fixed_volume_enabled: true })), { drawer: "loudness" }),
    "volume-level",
  );
});

test("test_a_zero_range_reason_names_the_range_tab", () => {
  assert.equal(
    reasonXref(volumeBypassed(ctx({ volume_min: 0, volume_max: 0 })), { drawer: "loudness" }),
    "volume-range",
  );
});

test("test_a_gated_loudness_line_under_fixed_volume_names_the_level_tab", () => {
  const line = loudnessGated(ctx({ matrix_enabled: true, fixed_volume_enabled: true }));
  assert.equal(reasonXref(line, { drawer: "loudness" }), "volume-level");
});

test("test_a_gated_loudness_line_under_a_zero_range_names_the_range_tab", () => {
  const line = loudnessGated(ctx({ matrix_enabled: true, volume_min: 0, volume_max: 0 }));
  assert.equal(reasonXref(line, { drawer: "loudness" }), "volume-range");
});

test("test_the_direct_sdm_speakers_line_names_dsd_playback", () => {
  assert.equal(reasonXref(DIRECT_SDM_NOTE, { drawer: "speakers" }), "dsdplay");
});

test("test_the_dsd_meter_line_on_the_page_names_the_matrix_engine", () => {
  assert.equal(reasonXref(METER_NOTES.matrix, null), "matrix");
});

test("test_a_reason_on_the_tab_it_names_carries_no_link", () => {
  const inside = { drawer: "matrix", tab: "basic" };
  assert.deepEqual([reasonXref(BYPASSED, { drawer: "pipelines" }), reasonXref(BYPASSED, inside)], ["matrix", null]);
});

test("test_a_fixed_volume_reason_on_another_tab_of_its_drawer_names_the_level_tab", () => {
  const fixed = volumeRangeGray(ctx({ fixed_volume_enabled: true }));
  const on = (/** @type {string} */ tab) => reasonXref(fixed, { drawer: "volume", tab });
  assert.deepEqual([on("gain"), on("range"), on("level")], ["volume-level", "volume-level", null]);
});

test("test_a_zero_range_reason_off_the_range_tab_names_the_range_tab", () => {
  const zero = volumeBypassed(ctx({ volume_min: 0, volume_max: 0 }));
  const on = (/** @type {string} */ tab) => reasonXref(zero, { drawer: "volume", tab });
  assert.deepEqual([on("gain"), on("range")], ["volume-range", null]);
});

test("test_a_reason_naming_no_place_carries_no_link", () => {
  const other = isSdm(ctx({ output_mode: "sdm" }));
  assert.deepEqual(
    [reasonXref(BYPASSED, { drawer: "shaping" }), reasonXref(other, { drawer: "shaping" })],
    ["matrix", null],
  );
});

test("test_going_to_a_place_opens_its_drawer", () => {
  goTo("volume-range");
  assert.equal(openStage.value, "volume");
});

test("test_going_to_a_place_shows_its_tab", () => {
  goTo("volume-range");
  assert.equal(shownTab(VOLUME), "range");
});

test("test_going_to_a_tab_the_drawer_does_not_open_on_shows_that_tab", () => {
  goTo("dsdplay");
  assert.equal(shownTab(DSD), "sdm");
});

test("test_going_to_a_place_closes_the_open_popover", () => {
  togglePopover("stations");
  goTo("matrix");
  assert.equal(openPopover.value, null);
});
