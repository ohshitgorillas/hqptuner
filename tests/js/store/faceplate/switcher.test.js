// Behavioral suite for hqptuner/static/store/faceplate/bottom/switcher.js, the Setting Switcher: which target the bar
// switches and its persisted choice, the bar's layout and the catalog key a list target reads on the running chain, the
// two slots each target shows, a remembered name per slot per target, a slot sent live, a slot's list, and the plate
// bottom it reports.
//
// Driven at the wire: the engine's enumerations, State and /config form come from tests/js/support/listsfixture.js
// (SDM chain loaded unless a case loads PCM, Simplified names on so a slot's label differs from its engine name), the
// /matrix form goes into `matrixConfig`, and a fetch fake answers the real REST paths and records every request body:
// POST /api/config/live for a live write, POST /api/matrix/profile for a profile switch. Every engine and profile name
// asserted is the fixture's own.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/switcher.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { useStorage } from "../../support/storage.js";
import { ok } from "../../support/wire/wire.js";

let storage = useStorage();

const { config, engineState, enums, matrixConfig } = await import("../../../../hqptuner/static/store/signals.js");
const { setBottomBar } = await import("../../../../hqptuner/static/store/ui/faceplate.js");
const { openList } = await import("../../../../hqptuner/static/store/faceplate/view.js");
const { loadLists, resetLists } = await import("../../support/listsfixture.js");
const { TARGETS, switcherTarget, setSwitcherTarget, switcherView, setSlot, slotLive, slotList, plateBottom } =
  await import("../../../../hqptuner/static/store/faceplate/bottom/switcher.js");

/** The target read before any case set one, with nothing stored. */
const INITIAL = switcherTarget.value;

const ALL = ["1x filter", "Nx filter", "Modulator", "Matrix profile", "Output mode", "Volume"];

const K_SLOTS = "hqptuner.switcherSlots";
const K_TARGET = "hqptuner.switcherTarget";

/** @type {{ fetch?: unknown }} */
const env = globalThis;

/** @type {{ path: string, body: unknown }[]} */
let posts = [];

/** @type {Record<string, () => unknown>} */
const READS = {
  "/api/state": () => ok({ data: { ...engineState.value } }),
  "/api/enumerations": () => ok({ data: { ...enums.value } }),
  "/api/config": () => ok({ data: { ...config.value } }),
  "/api/matrix": () => ok({ data: { ...matrixConfig.value } }),
  "/api/config/pending": () => ok({ live: {}, http: {} }),
};

/**
 * The answer to one request, each body recorded first.
 *
 * @param {string} path
 * @param {{ body?: string }} [opts]
 */
async function answer(path, opts = {}) {
  if (opts.body) posts.push({ path, body: JSON.parse(opts.body) });
  if (path === "/api/config/live") return ok({ report: { live: [], stored: {} } });
  if (path === "/api/matrix/profile") return ok({ ok: true });
  return READS[path] ? READS[path]() : ok({});
}

/** The bodies posted to one path. @param {string} path */
const sent = (path) => posts.filter((p) => p.path === path).map((p) => p.body);

beforeEach(() => {
  storage = useStorage();
  env.fetch = answer;
  loadLists({ chain: "sdm", plain: true });
  resetLists();
  matrixConfig.value = { fields: [], rows: [], live_profiles: ["Desk", "Lounge"], live_active: "Lounge" };
  setBottomBar("switcher");
  for (const t of ALL) {
    setSwitcherTarget(t);
    setSlot(0, "");
    setSlot(1, "");
  }
  setSwitcherTarget("Modulator");
  posts = [];
});

/** One field of both slots of the current view. @param {"name" | "label" | "aka" | "on" | "empty"} f */
const slotField = (f) => switcherView()?.slots.map((s) => s[f]);

/** One member of the view under each target, in ALL's order. @param {"layout" | "key"} f */
const underEach = (f) =>
  ALL.map((t) => {
    setSwitcherTarget(t);
    return switcherView()?.[f];
  });

// --- targets -------------------------------------------------------------------------------------------------------

test("test_the_targets_are_the_six_switchable_settings_in_order", () => {
  assert.deepEqual(TARGETS, ALL);
});

test("test_with_nothing_stored_the_target_reads_as_the_modulator", () => {
  assert.equal(INITIAL, "Modulator");
});

test("test_setting_a_target_persists_it", () => {
  setSwitcherTarget("Volume");
  assert.equal(storage.map.get(K_TARGET), "Volume");
});

// --- the view ------------------------------------------------------------------------------------------------------

test("test_the_view_names_the_current_target", () => {
  setSwitcherTarget("Nx filter");
  assert.equal(switcherView()?.target, "Nx filter");
});

test("test_volume_and_output_mode_lay_out_their_own_bars_and_the_rest_slots", () => {
  assert.deepEqual(underEach("layout"), ["slots", "slots", "slots", "slots", "mode", "volume"]);
});

test("test_on_the_sdm_chain_each_list_target_reads_its_sdm_key", () => {
  assert.deepEqual(underEach("key"), ["sdm_filter_1x", "sdm_filter_nx", "sdm_modulator", null, null, null]);
});

test("test_on_the_pcm_chain_each_list_target_reads_its_pcm_key", () => {
  loadLists({ chain: "pcm", plain: true });
  assert.deepEqual(underEach("key"), ["pcm_filter_1x", "pcm_filter_nx", "pcm_dither", null, null, null]);
});

// --- list slots ----------------------------------------------------------------------------------------------------

test("test_a_remembered_name_fills_its_slot_with_the_engine_name", () => {
  setSlot(1, "ASDM5");
  assert.equal(switcherView()?.slots[1]?.name, "ASDM5");
});

/** The fixture's plain breakdown of two names: family, variant where one is, leaf. */
const PLAIN = { ASDM5: ["Adaptive", "Fifth order", "Leaf asdm5"], IIR: ["Fam B", "Leaf iir"] };

test("test_a_list_slot_labels_its_name_by_its_plain_family_variant_and_leaf", () => {
  setSlot(1, "ASDM5");
  const modulator = switcherView()?.slots[1]?.label;
  setSwitcherTarget("1x filter");
  setSlot(0, "IIR");
  assert.deepEqual([modulator, switcherView()?.slots[0]?.label], [PLAIN.ASDM5.join(" · "), PLAIN.IIR.join(" · ")]);
});

test("test_a_list_slot_carries_no_aka", () => {
  setSlot(0, "ASDM5");
  assert.equal(switcherView()?.slots[0]?.aka, "");
});

test("test_a_list_slot_is_on_while_its_name_runs", () => {
  setSlot(0, "ASDM7EC 512+fs");
  setSlot(1, "ASDM5");
  assert.deepEqual(slotField("on"), [true, false]);
});

test("test_a_slot_with_no_name_remembered_is_empty", () => {
  setSlot(0, "ASDM5");
  assert.deepEqual(slotField("empty"), [false, true]);
});

test("test_with_both_list_slots_empty_the_first_shows_the_running_value", () => {
  assert.equal(switcherView()?.slots[0]?.name, "ASDM7EC 512+fs");
});

// --- output mode slots ---------------------------------------------------------------------------------------------

test("test_output_mode_shows_the_two_fixed_mode_slots", () => {
  setSwitcherTarget("Output mode");
  assert.deepEqual(
    switcherView()?.slots.map((s) => [s.name, s.aka === ""]),
    [
      ["", true],
      ["", false],
    ],
  );
});

test("test_output_mode_marks_the_running_chain", () => {
  setSwitcherTarget("Output mode");
  const sdm = slotField("on");
  loadLists({ chain: "pcm", plain: true });
  assert.deepEqual(
    [sdm, slotField("on")],
    [
      [false, true],
      [true, false],
    ],
  );
});

// --- matrix profile slots ------------------------------------------------------------------------------------------

test("test_a_profile_slot_names_and_labels_the_remembered_profile", () => {
  setSwitcherTarget("Matrix profile");
  setSlot(0, "Desk");
  const s = switcherView()?.slots[0];
  assert.deepEqual([s?.name, s?.label], ["Desk", "Desk"]);
});

test("test_a_profile_slot_is_on_while_its_profile_runs", () => {
  setSwitcherTarget("Matrix profile");
  setSlot(0, "Desk");
  setSlot(1, "Lounge");
  assert.deepEqual(slotField("on"), [false, true]);
});

// --- remembering ---------------------------------------------------------------------------------------------------

test("test_a_remembered_name_persists_under_its_target", () => {
  setSlot(0, "ASDM5");
  setSlot(1, "ASDM7EC 512+fs");
  assert.deepEqual(JSON.parse(storage.map.get(K_SLOTS) ?? "{}").Modulator, ["ASDM5", "ASDM7EC 512+fs"]);
});

test("test_switching_targets_and_back_keeps_both_slots", () => {
  setSlot(0, "ASDM5");
  setSlot(1, "ASDM7EC 512+fs");
  setSwitcherTarget("1x filter");
  setSlot(0, "sinc-M");
  setSwitcherTarget("Modulator");
  assert.deepEqual(slotField("name"), ["ASDM5", "ASDM7EC 512+fs"]);
});

// --- live ----------------------------------------------------------------------------------------------------------

test("test_live_on_a_list_slot_writes_its_enum_id", async () => {
  setSlot(0, "ASDM5");
  await slotLive(0);
  assert.deepEqual(sent("/api/config/live"), [{ fields: { modulator: "0" } }]);
});

test("test_live_on_an_empty_slot_writes_nothing", async () => {
  setSlot(1, "ASDM5");
  await slotLive(0);
  await slotLive(1);
  assert.deepEqual(sent("/api/config/live"), [{ fields: { modulator: "0" } }]);
});

test("test_live_on_a_profile_slot_switches_the_matrix_to_it", async () => {
  setSwitcherTarget("Matrix profile");
  setSlot(0, "Desk");
  await slotLive(0);
  assert.deepEqual(sent("/api/matrix/profile"), [{ action: "switch", name: "Desk" }]);
});

test("test_live_on_the_output_mode_slots_writes_pcm_then_sdm", async () => {
  setSwitcherTarget("Output mode");
  await slotLive(0);
  await slotLive(1);
  assert.deepEqual(sent("/api/config/live"), [{ fields: { mode: "pcm" } }, { fields: { mode: "sdm" } }]);
});

// --- lists ---------------------------------------------------------------------------------------------------------

test("test_a_list_slots_list_opens_its_keys_option_list_on_its_name", () => {
  setSlot(0, "ASDM5");
  slotList(0);
  assert.deepEqual([openList.value?.key, openList.value?.value], ["sdm_modulator", "ASDM5"]);
});

test("test_the_other_slots_list_replaces_an_open_one_instead_of_closing_it", () => {
  setSlot(0, "ASDM5");
  setSlot(1, "ASDM7EC 512+fs");
  slotList(0);
  slotList(1);
  assert.equal(openList.value?.value, "ASDM7EC 512+fs");
});

test("test_a_pick_from_a_slots_list_remembers_it_in_that_slot", () => {
  setSwitcherTarget("1x filter");
  slotList(1);
  openList.value?.pick("IIR");
  assert.equal(switcherView()?.slots[1]?.name, "IIR");
});

test("test_a_pick_into_the_second_slot_keeps_the_running_value_the_first_shows", () => {
  slotList(1);
  openList.value?.pick("ASDM5");
  assert.deepEqual(slotField("name"), ["ASDM7EC 512+fs", "ASDM5"]);
});

test("test_a_profile_slots_list_is_the_profile_choices", () => {
  setSwitcherTarget("Matrix profile");
  assert.deepEqual(
    slotList(0)?.map((o) => o.value),
    ["", "Desk", "Lounge"],
  );
});

test("test_a_list_slots_list_omits_the_name_the_other_slot_holds", () => {
  setSlot(0, "ASDM5");
  slotList(1);
  assert.equal(openList.value?.omit, "ASDM5");
});

test("test_a_profile_slots_list_omits_the_profile_the_other_slot_holds", () => {
  setSwitcherTarget("Matrix profile");
  setSlot(0, "Desk");
  assert.deepEqual(
    slotList(1)?.map((o) => o.value),
    ["", "Lounge"],
  );
});

test("test_a_slot_list_under_volume_opens_nothing", () => {
  setSwitcherTarget("Volume");
  slotList(0);
  const volume = openList.value;
  setSwitcherTarget("Modulator");
  slotList(0);
  assert.deepEqual([volume, openList.value?.key], [null, "sdm_modulator"]);
});

// --- plate bottom --------------------------------------------------------------------------------------------------

test("test_the_plate_bottom_reads_the_bar_preference", () => {
  const on = plateBottom()?.bottom;
  setBottomBar("none");
  assert.deepEqual([on, plateBottom()?.bottom], ["switcher", "none"]);
});

test("test_the_plate_bottom_marks_volume_only_under_the_volume_target", () => {
  const modulator = plateBottom()?.sw;
  setSwitcherTarget("Volume");
  assert.deepEqual([modulator, plateBottom()?.sw], ["", "volume"]);
});
