// Behavioral suite for hqptuner/static/store/faceplate/builders/snapshot.js: what a snapshot can hold and on which wire
// field, the engine now, the book and its stations, a stored record as an edit, the edit showing and how a change
// stages it, what a save sends, each row's view against the engine, and the rail's paging at a height.
//
// The wire is the seam: /api/state into `engineState`, the loaded chain's enumerations into `enums`, the /config form
// (the dormant chain's values, Output mode, the stations and the loaded one) into `config`, the overlays into
// `metadata`, the snapshot book into `liveBook`. The record being edited and its staged edits are the shell's `cur` and
// `staged` (./shell.js), loaded only by the cases that edit.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate-builders/snapshot.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { config, engineState, engineStatus, enums, metadata } from "../../../../hqptuner/static/store/signals.js";
import { plainNames } from "../../../../hqptuner/static/store/ui/prefs.js";
import { liveBook } from "../../../../hqptuner/static/store/live/presets.js";
import { keyOf } from "../../../../hqptuner/static/model/builders/builder.js";
import {
  SNAP_ROWS,
  SNAP_COPY,
  liveNow,
  snapshotBook,
  stations,
  home,
  fromRecord,
  editNow,
  change,
  recordOf,
  takeAll,
  snapshotRows,
} from "../../../../hqptuner/static/store/faceplate/builders/snapshot.js";
import { railView } from "../../../../hqptuner/static/store/faceplate/builders/rail.js";

const SHELL = "../../../../hqptuner/static/store/faceplate/builders/shell.js";

/** @typedef {{ index: string, value: string, name: string }} EnumItem */

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
    filters: {
      entries: {
        "poly-sinc-gauss-long": { family: "Fam A", variant: "Var A", leaf: "Leaf gauss", short: "gauss" },
        "sinc-M": { family: "Fam A", variant: "Var B", leaf: "Leaf sinc", short: "sinc" },
        IIR: { family: "Fam B", variant: null, leaf: "Leaf iir", short: "iir" },
      },
      families: {},
      variants: {},
    },
    dithers: {
      entries: {
        NS9: { family: "Noise shaping", variant: null, leaf: "Leaf ns9", short: "NS9" },
        TPDF: { family: "Additive", variant: null, leaf: "Leaf tpdf", short: "TPDF" },
      },
      families: {},
      variants: {},
    },
    modulators: { entries: {}, families: {}, variants: {} },
  },
});

/** Speakers' twelve snapshot names, in list order. */
const SPEAKER_NAMES = Array.from({ length: 12 }, (_, i) => `S${String(i + 1).padStart(2, "0")}`);

/**
 * A fresh book: Speakers holds twelve SDM snapshots, Headphones a full PCM one (Desk) and one without Mode (Bed).
 *
 * @returns {Record<string, Record<string, { chain: string, fields: Record<string, string>, names: Record<string, string> }>>}
 */
const book = () => ({
  Speakers: Object.fromEntries(
    SPEAKER_NAMES.map((n) => [
      n,
      { chain: "sdm", fields: { mode: "sdm", oversampling1x: "38", oversampling: "39", modulator: "3" }, names: {} },
    ]),
  ),
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
 * @typedef {object} Running
 * @property {"pcm" | "sdm"} [chain]  the chain the engine has loaded (and, idle, runs)
 * @property {string} [f1x]       the 1x filter's list index
 * @property {string} [fnx]       the Nx filter's list index
 * @property {string} [shaper]    the shaper's list index
 * @property {string} [adaptive]  Adaptive volume's State flag
 * @property {string} [mode]      the /config form's Output mode
 * @property {string} [active]    the loaded station
 */

/**
 * Write one idle engine onto the wire-side signals: by default the PCM chain loaded, the SDM chain dormant on the
 * /config form, Headphones loaded.
 *
 * @param {Running} [r]
 */
function wire({
  chain = "pcm",
  f1x = "1",
  fnx = "2",
  shaper = "0",
  adaptive = "1",
  mode = "pcm",
  active = "Headphones",
} = {}) {
  const sdm = chain === "sdm";
  engineState.value = { state: "0", active_chain: chain, filter1x: f1x, filterNx: fnx, shaper, adaptive };
  engineStatus.value = {};
  enums.value = sdm ? { filters: SDM_FILTERS, shapers: SDM_SHAPERS } : { filters: PCM_FILTERS, shapers: PCM_SHAPERS };
  config.value = {
    fields: [
      { name: "mode", value: mode, options: [] },
      formField("filter1x", "40", PCM_FILTERS),
      formField("filter", "41", PCM_FILTERS),
      formField("dither", "6", PCM_SHAPERS),
      formField("oversampling1x", "38", SDM_FILTERS),
      formField("oversampling", "39", SDM_FILTERS),
      formField("modulator", "4", SDM_SHAPERS),
    ],
    file: {},
    profiles: { options: [{ value: "" }, { value: "Speakers" }, { value: "Headphones" }] },
    active,
  };
  metadata.value = overlays();
  plainNames.value = false;
}

beforeEach(() => {
  wire();
  liveBook.value = book();
});

/**
 * Load the shell and put it on one record with the staged edits given.
 *
 * @param {{ st: string, name: string }} ref
 * @param {Map<string, unknown>} [held]
 */
async function editing(ref, held = new Map()) {
  const shell = await import(SHELL);
  shell.staged.value = held;
  shell.cur.value = ref;
  return shell;
}

/** @param {string} st @param {string} name */
const rec = (st, name) => book()[st][name];

/** One row of SNAP_ROWS, by id. @param {string} id */
const rowOf = (id) => SNAP_ROWS.find((r) => r.id === id);

/** One view of snapshotRows(), by id. @param {string} id */
const viewOf = (id) => snapshotRows()?.find((r) => r.id === id);

/** The sorted wire fields a save of the edit sends. @param {import('../../../../hqptuner/static/model/builders/snapshot.js').Edit} e */
const sentFields = (e) => [...(recordOf(e)?.fields ?? [])].sort();

// --- what a snapshot can hold -----------------------------------------------------------------

const FIELDS = [
  ["adaptive", "adaptive_volume"],
  ["1x", { pcm: "filter1x", sdm: "oversampling1x" }],
  ["nx", { pcm: "filter", sdm: "oversampling" }],
  ["sh", { pcm: "dither", sdm: "modulator" }],
  ["mode", "mode"],
];
for (const [id, field] of FIELDS) {
  test(`test_the_${id}_row_writes_its_live_wire_field`, () => {
    assert.deepEqual(rowOf(String(id))?.field, field);
  });
}

const KEYS = [
  ["adaptive", "adaptive_volume"],
  ["1x", { pcm: "pcm_filter_1x", sdm: "sdm_filter_1x" }],
  ["nx", { pcm: "pcm_filter_nx", sdm: "sdm_filter_nx" }],
  ["sh", { pcm: "pcm_dither", sdm: "sdm_modulator" }],
  ["mode", "output_mode"],
];
for (const [id, key] of KEYS) {
  test(`test_the_${id}_row_reads_its_catalog_key`, () => {
    assert.deepEqual(rowOf(String(id))?.key, key);
  });
}

test("test_adaptive_volume_offers_the_engines_two_flag_values", () => {
  assert.deepEqual(
    rowOf("adaptive")?.options?.map((o) => o.v),
    ["0", "1"],
  );
});

test("test_output_mode_offers_one_chain_each_and_no_auto", () => {
  assert.deepEqual(
    rowOf("mode")?.options?.map((o) => o.v),
    ["pcm", "sdm"],
  );
});

test("test_the_filters_and_shaper_are_the_chain_rows", () => {
  assert.deepEqual(
    SNAP_ROWS.filter((r) => r.chain).map((r) => r.id),
    ["1x", "nx", "sh"],
  );
});

test("test_output_mode_is_the_row_the_chain_rows_need", () => {
  assert.deepEqual(
    SNAP_ROWS.filter((r) => r.gate).map((r) => r.id),
    ["mode"],
  );
});

test("test_the_overwrite_question_names_the_snapshot", () => {
  assert.ok(SNAP_COPY.overwrite("fixture-snap").includes("fixture-snap"));
});

test("test_the_delete_question_names_the_snapshot", () => {
  assert.ok(SNAP_COPY.remove("fixture-snap").includes("fixture-snap"));
});

// --- the engine now ------------------------------------------------------------------------------

test("test_live_mode_reads_the_config_forms_pcm", () => {
  assert.equal(liveNow()?.mode, "pcm");
});

test("test_live_mode_reads_the_config_forms_auto", () => {
  wire({ mode: "auto" });
  assert.equal(liveNow()?.mode, "auto");
});

test("test_an_idle_engine_runs_the_pcm_chain_it_has_loaded", () => {
  assert.equal(liveNow()?.run, "pcm");
});

test("test_an_idle_engine_runs_the_sdm_chain_it_has_loaded", () => {
  wire({ chain: "sdm" });
  assert.equal(liveNow()?.run, "sdm");
});

test("test_the_loaded_chains_1x_filter_reads_the_enum_id_at_the_index_the_engine_reports", () => {
  assert.equal(liveNow()?.pcm?.["1x"], "41");
});

test("test_the_loaded_chains_shaper_reads_the_enum_id_at_the_index_the_engine_reports", () => {
  wire({ shaper: "1" });
  assert.equal(liveNow()?.pcm?.sh, "6");
});

test("test_the_dormant_chains_modulator_reads_the_config_form", () => {
  assert.equal(liveNow()?.sdm?.sh, "4");
});

test("test_live_adaptive_volume_reads_the_engines_flag_on", () => {
  assert.equal(liveNow()?.adaptive, "1");
});

test("test_live_adaptive_volume_reads_the_engines_flag_off", () => {
  wire({ adaptive: "0" });
  assert.equal(liveNow()?.adaptive, "0");
});

// --- the book and its stations -------------------------------------------------------------------

test("test_the_book_lists_each_stations_snapshots_in_order", () => {
  assert.deepEqual(Object.keys(snapshotBook()?.Headphones ?? {}), ["Desk", "Bed"]);
});

test("test_the_book_is_empty_before_it_is_read", () => {
  liveBook.value = null;
  assert.deepEqual(snapshotBook(), {});
});

test("test_the_stations_are_the_configs_named_presets_in_order", () => {
  assert.deepEqual(stations(), ["Speakers", "Headphones"]);
});

test("test_home_is_the_loaded_headphones", () => {
  assert.equal(home(), "Headphones");
});

test("test_home_is_the_loaded_speakers", () => {
  wire({ active: "Speakers" });
  assert.equal(home(), "Speakers");
});

// --- a record as an edit -------------------------------------------------------------------------

test("test_a_new_snapshot_holds_every_row", () => {
  assert.deepEqual([...(fromRecord(null)?.inc ?? [])].sort(), ["1x", "adaptive", "mode", "nx", "sh"]);
});

test("test_a_new_snapshot_takes_the_chain_the_engine_runs", () => {
  wire({ chain: "sdm" });
  assert.equal(fromRecord(null)?.vals?.mode, "sdm");
});

test("test_a_pcm_records_1x_filter_lands_on_the_pcm_chain", () => {
  assert.equal(fromRecord(rec("Headphones", "Desk"))?.vals?.pcm?.["1x"], "40");
});

test("test_an_sdm_records_modulator_lands_on_the_sdm_chain", () => {
  assert.equal(fromRecord(rec("Speakers", "S01"))?.vals?.sdm?.sh, "3");
});

test("test_a_record_takes_the_chain_it_was_saved_on", () => {
  assert.equal(fromRecord(rec("Speakers", "S01"))?.vals?.mode, "sdm");
});

test("test_a_record_holds_the_rows_its_fields_carry", () => {
  assert.deepEqual([...(fromRecord(rec("Headphones", "Bed"))?.inc ?? [])].sort(), ["1x", "adaptive"]);
});

test("test_a_row_the_record_leaves_out_reads_the_engine", () => {
  wire({ chain: "sdm" });
  assert.equal(fromRecord(rec("Speakers", "S01"))?.vals?.adaptive, "1");
});

// --- what a save sends ---------------------------------------------------------------------------

test("test_a_save_sends_the_pcm_chains_wire_fields_with_mode", () => {
  assert.deepEqual(sentFields(fromRecord(rec("Headphones", "Desk"))), [
    "adaptive_volume",
    "dither",
    "filter",
    "filter1x",
    "mode",
  ]);
});

test("test_a_save_sends_the_sdm_chains_wire_fields_with_mode", () => {
  assert.deepEqual(sentFields(fromRecord(rec("Speakers", "S01"))), [
    "mode",
    "modulator",
    "oversampling",
    "oversampling1x",
  ]);
});

test("test_a_save_without_mode_drops_the_chain_rows", () => {
  assert.deepEqual(sentFields(fromRecord(rec("Headphones", "Bed"))), ["adaptive_volume"]);
});

test("test_a_save_sends_each_held_row_at_the_edits_value", () => {
  assert.equal(recordOf(fromRecord(rec("Speakers", "S01")))?.values?.oversampling1x, "38");
});

// --- use live settings ---------------------------------------------------------------------------

test("test_taking_all_fills_a_held_chain_row_from_the_engine", () => {
  const e = fromRecord(rec("Headphones", "Desk"));
  takeAll(e);
  assert.equal(e?.vals?.pcm?.["1x"], "41");
});

test("test_taking_all_moves_a_held_mode_to_the_chain_the_engine_runs", () => {
  wire({ chain: "sdm" });
  const e = fromRecord(rec("Headphones", "Desk"));
  takeAll(e);
  assert.equal(e?.vals?.mode, "sdm");
});

test("test_taking_all_fills_the_new_chains_rows_after_mode_moves", () => {
  wire({ chain: "sdm", f1x: "1" });
  const e = fromRecord(rec("Headphones", "Desk"));
  takeAll(e);
  assert.equal(e?.vals?.sdm?.["1x"], "39");
});

test("test_taking_all_leaves_a_row_the_snapshot_does_not_hold", () => {
  wire({ chain: "sdm" });
  const e = fromRecord(rec("Headphones", "Bed"));
  takeAll(e);
  assert.equal(e?.vals?.mode, "pcm");
});

// --- the edit showing and a change ---------------------------------------------------------------

test("test_the_edit_showing_is_the_staged_one", async () => {
  const ref = { st: "Headphones", name: "Desk" };
  const staged = { ...fromRecord(rec("Headphones", "Desk")), name: "fixture-staged" };
  await editing(ref, new Map([[keyOf(ref), staged]]));
  assert.equal(editNow()?.name, "fixture-staged");
});

test("test_the_edit_showing_is_the_saved_record_with_nothing_staged", async () => {
  await editing({ st: "Headphones", name: "Desk" });
  assert.equal(editNow()?.vals?.pcm?.["1x"], "40");
});

test("test_a_change_shows_in_the_edit", async () => {
  await editing({ st: "Headphones", name: "Desk" });
  change((e) => {
    e.vals.pcm["1x"] = "42";
  });
  assert.equal(editNow()?.vals?.pcm?.["1x"], "42");
});

test("test_a_change_off_the_saved_value_stages_the_edit", async () => {
  const ref = { st: "Headphones", name: "Desk" };
  const shell = await editing(ref);
  change((e) => {
    e.vals.pcm["1x"] = "42";
  });
  assert.equal(shell.staged.value.has(keyOf(ref)), true);
});

test("test_a_change_back_to_the_saved_value_unstages_the_edit", async () => {
  const ref = { st: "Headphones", name: "Desk" };
  const shell = await editing(ref);
  change((e) => {
    e.vals.pcm["1x"] = "42";
  });
  change((e) => {
    e.vals.pcm["1x"] = "40";
  });
  assert.equal(shell.staged.value.has(keyOf(ref)), false);
});

// --- each row's view -----------------------------------------------------------------------------

test("test_a_held_row_off_the_engines_value_differs", async () => {
  await editing({ st: "Headphones", name: "Desk" });
  assert.equal(viewOf("1x")?.differs, true);
});

test("test_a_held_row_at_the_engines_value_does_not_differ", async () => {
  await editing({ st: "Headphones", name: "Desk" });
  assert.equal(viewOf("nx")?.differs, false);
});

test("test_a_chain_row_without_mode_is_gated", async () => {
  await editing({ st: "Headphones", name: "Bed" });
  assert.equal(viewOf("1x")?.gated, true);
});

test("test_a_chain_row_with_mode_is_not_gated", async () => {
  await editing({ st: "Headphones", name: "Desk" });
  assert.equal(viewOf("1x")?.gated, false);
});

test("test_a_chain_row_on_the_chain_the_engine_is_not_running_is_idle", async () => {
  await editing({ st: "Speakers", name: "S01" });
  assert.equal(viewOf("1x")?.idle, true);
});

test("test_a_seg_rows_live_text_is_its_options_label", async () => {
  await editing({ st: "Headphones", name: "Desk" });
  const want = rowOf("adaptive")?.options?.find((o) => o.v === "1")?.label ?? "no-such-option";
  assert.equal(viewOf("adaptive")?.liveText, want);
});

test("test_a_list_rows_live_text_is_its_plain_leaf_in_simplified", async () => {
  await editing({ st: "Headphones", name: "Desk" });
  plainNames.value = true;
  assert.equal(viewOf("1x")?.liveText, "Leaf sinc");
});

test("test_a_list_rows_value_text_is_its_plain_leaf_in_simplified", async () => {
  await editing({ st: "Headphones", name: "Desk" });
  plainNames.value = true;
  assert.equal(viewOf("1x")?.valueText, "Leaf gauss");
});

test("test_a_list_rows_live_text_is_its_engine_name_in_standard", async () => {
  await editing({ st: "Headphones", name: "Desk" });
  assert.equal(viewOf("1x")?.liveText, "sinc-M");
});

// --- the rail ------------------------------------------------------------------------------------

test("test_a_page_holds_the_lines_that_fit_a_tall_rail", () => {
  assert.equal(railView(318, { open: "Speakers", pages: new Map() })?.per, 6);
});

test("test_a_page_holds_the_lines_that_fit_a_short_rail", () => {
  assert.equal(railView(262, { open: "Speakers", pages: new Map() })?.per, 4);
});

test("test_the_open_station_lists_its_first_page", () => {
  assert.deepEqual(railView(318, { open: "Speakers", pages: new Map() })?.folds?.[0]?.items, SPEAKER_NAMES.slice(0, 6));
});

test("test_the_open_station_lists_the_page_asked_for", () => {
  assert.deepEqual(
    railView(318, { open: "Speakers", pages: new Map([["Speakers", 1]]) })?.folds?.[0]?.items,
    SPEAKER_NAMES.slice(6, 12),
  );
});

test("test_the_loaded_station_folds_as_loaded", () => {
  assert.equal(railView(318, { open: null, pages: new Map() })?.folds?.[1]?.loaded, true);
});

test("test_a_station_holding_a_staged_edit_folds_dirty", async () => {
  const desk = { st: "Headphones", name: "Desk" };
  await editing({ st: "Speakers", name: "S01" }, new Map([[keyOf(desk), fromRecord(rec("Headphones", "Desk"))]]));
  assert.equal(railView(318, { open: null, pages: new Map() })?.folds?.[1]?.dirty, true);
});
