// Behavioral suite for mockup/scripts/model/alerts.js: where raised alerts land, free of the DOM. Which homes blink and
// in what colour, which drawers and page sections pin which alert lines, which drawer rows light, which stages go dark,
// and which header homes open a popover and what it shows.
//
// Every home table and alert list is one this file writes.
//
// Run: node --test tests/js/mockup/alerts.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { alertPlan, alertsAt, noteHomes, worseBlink } from "../../../../mockup/scripts/model/shell/alerts.js";

/** @typedef {import("../../../../mockup/scripts/model/shell/alerts.js").Alert} Alert */

//: Homes by alert kind: two on one stage, a bare header element, a header element with a settings category and a
//: drawer row, two sharing a drawer, a page section, and a stage that darkens the two after it.
const HOMES = {
  lamp: { stage: "a" },
  lampToo: { stage: "a" },
  knob: { el: "#k" },
  knobToo: { el: "#k" },
  gear: { el: "#g", set: "t", drawer: "t", row: ["Idle"] },
  vol: { stage: "v", drawer: "v" },
  gain: { drawer: "v", row: ["Gain", "Trim"] },
  page: { stage: "r", section: "Res" },
  mod: { stage: "s", section: "Sh", dark: ["x", "y"] },
  modToo: { section: "Sh", dark: ["y"] },
};

/**
 * One raised alert.
 *
 * @param {string} kind
 * @param {Alert["sev"]} [sev]
 * @param {Partial<Alert>} [more]
 * @returns {Alert}
 */
const raised = (kind, sev = "warn", more = {}) => ({ kind, sev, text: "t", ...more });

/** @param {Alert[]} list */
const plan = (list) => alertPlan(list, HOMES);

/** @param {Alert[]} as */
const kinds = (as) => as.map((a) => a.kind);

test("test_a_warning_blinks_its_stage_amber", () => {
  assert.equal(plan([raised("lamp")]).blinks.stage.get("a"), "warn");
});

test("test_advice_blinks_its_stage_amber", () => {
  assert.equal(plan([raised("lamp", "advice")]).blinks.stage.get("a"), "warn");
});

test("test_a_critical_alert_blinks_its_stage_red", () => {
  assert.equal(plan([raised("lamp", "crit")]).blinks.stage.get("a"), "crit");
});

test("test_a_critical_alert_after_a_warning_on_one_stage_blinks_red", () => {
  assert.equal(plan([raised("lamp"), raised("lampToo", "crit")]).blinks.stage.get("a"), "crit");
});

test("test_a_warning_after_a_critical_alert_on_one_stage_stays_red", () => {
  assert.equal(plan([raised("lamp", "crit"), raised("lampToo")]).blinks.stage.get("a"), "crit");
});

test("test_a_header_home_blinks_its_element", () => {
  assert.equal(plan([raised("knob", "crit")]).blinks.el.get("#k"), "crit");
});

test("test_a_settings_home_blinks_its_category", () => {
  assert.equal(plan([raised("gear")]).blinks.set.get("t"), "warn");
});

test("test_a_header_home_blinks_no_stage", () => {
  assert.equal(plan([raised("knob")]).blinks.stage.size, 0);
});

test("test_an_alert_with_no_home_blinks_no_stage", () => {
  assert.equal(plan([raised("nowhere")]).blinks.stage.size, 0);
});

test("test_an_alert_with_no_home_blinks_no_element", () => {
  assert.equal(plan([raised("nowhere")]).blinks.el.size, 0);
});

test("test_alerts_sharing_a_drawer_pin_in_raised_order", () => {
  assert.deepEqual(kinds(plan([raised("gain"), raised("vol")]).drawers.get("v")?.alerts ?? []), ["gain", "vol"]);
});

test("test_a_drawer_lights_its_homes_fixing_rows", () => {
  const rows = plan([raised("gain")]).drawers.get("v")?.rows ?? [];
  assert.deepEqual(
    rows.map((r) => r.label),
    ["Gain", "Trim"],
  );
});

test("test_an_alerts_own_rows_override_its_homes", () => {
  const rows = plan([raised("gain", "warn", { rows: ["Other"] })]).drawers.get("v")?.rows ?? [];
  assert.deepEqual(
    rows.map((r) => r.label),
    ["Other"],
  );
});

test("test_a_home_with_no_fixing_row_lights_no_row", () => {
  assert.equal(plan([raised("vol")]).drawers.get("v")?.rows.length, 0);
});

test("test_a_lit_row_reads_in_its_alerts_severity", () => {
  assert.equal(plan([raised("gain", "crit")]).drawers.get("v")?.rows[0].sev, "crit");
});

test("test_a_chain_alert_lights_rows_in_its_own_chain", () => {
  assert.equal(plan([raised("gain", "warn", { chain: "sdm" })]).drawers.get("v")?.rows[0].chain, "sdm");
});

test("test_an_alert_with_no_drawer_pins_in_no_drawer", () => {
  assert.equal(plan([raised("lamp")]).drawers.size, 0);
});

test("test_a_page_section_pins_its_alerts_in_raised_order", () => {
  assert.deepEqual(kinds(plan([raised("modToo"), raised("mod")]).sections.get("Sh") ?? []), ["modToo", "mod"]);
});

test("test_an_alert_with_no_section_pins_in_no_section", () => {
  assert.equal(plan([raised("vol")]).sections.size, 0);
});

test("test_a_dead_modulator_darkens_the_stages_after_it", () => {
  assert.deepEqual(plan([raised("mod", "crit")]).dark, ["x", "y"]);
});

test("test_two_alerts_darkening_one_stage_darken_it_once", () => {
  assert.deepEqual(plan([raised("mod", "crit"), raised("modToo", "crit")]).dark, ["x", "y"]);
});

test("test_an_alert_on_a_bare_home_blinks_amber_for_advice", () => {
  assert.equal(worseBlink(undefined, "advice"), "warn");
});

test("test_a_warning_onto_a_red_blink_leaves_it_red", () => {
  assert.equal(worseBlink("crit", "warn"), "crit");
});

test("test_a_critical_alert_onto_an_amber_blink_turns_it_red", () => {
  assert.equal(worseBlink("warn", "crit"), "crit");
});

test("test_a_header_popover_shows_only_the_alerts_homed_on_it", () => {
  assert.deepEqual(kinds(alertsAt([raised("lamp"), raised("knob"), raised("gear")], HOMES, "#k")), ["knob"]);
});

test("test_a_header_popover_skips_an_alert_with_no_home", () => {
  assert.equal(alertsAt([raised("nowhere")], HOMES, "#k").length, 0);
});

test("test_header_homes_without_a_settings_category_open_by_popover_once_each", () => {
  assert.deepEqual(noteHomes(HOMES), ["#k"]);
});
