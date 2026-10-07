// Behavioral suite for hqptuner/static/store/faceplate/stations.js: the header's Station · Snapshot tree. One station
// per named preset the config offers, the loaded one marked, each carrying the live snapshots the book holds under its
// name; one station unfolded at a time.
//
// Driven by assigning the exported signals the tree is read from: the config the poll writes and the live-snapshot
// book the LIVE store reads. Where the book is read off the wire, a fetch fake answers /api/livepresets in its real
// shape. Preset and snapshot names are the fixture's own wire data.
//
// A snapshot's tip is read off one /api/livepresets record: its `names` are the fixture's own wire data, and the
// Simplified name rides the /api/metadata overlay (`plain_names`) as an invented leaf.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/stations.test.js

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { config, metadata } from "../../../../hqptuner/static/store/signals.js";
import { liveMode, plainNames } from "../../../../hqptuner/static/store/ui/prefs.js";
import { liveBook, bookWanted } from "../../../../hqptuner/static/store/live/presets.js";
import { schema } from "../../../../hqptuner/static/store/schema.js";
import {
  stationTree,
  unfolded,
  toggleStation,
  snapshotTip,
} from "../../../../hqptuner/static/store/faceplate/stations.js";
import { rec, presetWire, settle } from "../../support/wire/livepresetwire.js";

/** @type {{ fetch?: unknown }} */
const env = globalThis;
const REAL_FETCH = env.fetch;
afterEach(() => {
  env.fetch = REAL_FETCH;
});

/** @typedef {ReturnType<typeof stationTree>[number]} Station */

/**
 * A config as /api/config serves it, offering the "(no preset)" entry and the named presets given.
 *
 * @param {string} active  the loaded preset
 * @param {string[]} names
 */
const offering = (active, names) => ({
  fields: [],
  active,
  profiles: { value: active, options: [{ value: "", label: "" }, ...names.map((n) => ({ value: n, label: n }))] },
});

/** A live snapshot record as the book holds it. */
const snap = () => ({ chain: "pcm", fields: { mode: "pcm" }, names: {} });

/** The invented Simplified leaf the overlay carries for sinc-MGa, and its short, kept distinct. */
const MGA_LEAF = "Leaf MGa";
const MGA_SHORT = "Short MGa";

/** A fresh /api/metadata payload whose filters overlay knows sinc-MGa: the same object written twice does not notify. */
const overlays = () => ({
  settings: {},
  filters: { filters: {}, aliases: {} },
  shapers: { pcm_dithers: {}, sdm_modulators: {} },
  plain_names: {
    filters: {
      entries: { "sinc-MGa": { family: "Fam MGa", variant: null, leaf: MGA_LEAF, short: MGA_SHORT } },
      families: {},
      variants: {},
    },
    dithers: { entries: {}, families: {}, variants: {} },
    modulators: { entries: {}, families: {}, variants: {} },
  },
});

/** One SDM snapshot record as /api/livepresets serves it, holding both filters, the modulator and Mode. */
const sdmRecord = () => ({
  chain: "sdm",
  fields: { oversampling1x: "50", oversampling: "50", modulator: "12", mode: "sdm" },
  names: { oversampling1x: "sinc-MGa", oversampling: "sinc-MGa", modulator: "AMSDM7EC 512+fs", mode: "SDM (DSD)" },
});

/** The SDM record's tip: each held row's schema label and its `rec.names` value, in SNAP_ROWS order. */
const SDM_TIP = [
  `${schema.sdm_filter_1x.label}: sinc-MGa`,
  `${schema.sdm_filter_nx.label}: sinc-MGa`,
  `${schema.sdm_modulator.label}: AMSDM7EC 512+fs`,
  `${schema.output_mode.label}: SDM (DSD)`,
].join("\n");
const SDM_TIP_1X_SIMPLIFIED = `${schema.sdm_filter_1x.label}: ${MGA_LEAF}`;

beforeEach(() => {
  bookWanted.value = false;
  liveMode.value = false;
  plainNames.value = false;
  metadata.value = overlays();
  config.value = offering("Night", ["Day", "Night"]);
  liveBook.value = { Day: { Warm: snap(), Bright: snap() }, Night: { Quiet: snap() }, "": { Loose: snap() } };
  unfolded.value = null;
});

/** One station of the tree, by name, or undefined. */
const station = (/** @type {string} */ name) => stationTree().find((/** @type {Station} */ s) => s.name === name);

test("test_the_tree_has_one_station_per_named_preset", () => {
  assert.deepEqual(
    stationTree().map((/** @type {Station} */ s) => s.name),
    ["Day", "Night"],
  );
});

test("test_the_loaded_preset_is_the_one_active_station", () => {
  assert.deepEqual(
    stationTree()
      .filter((/** @type {Station} */ s) => s.active)
      .map((/** @type {Station} */ s) => s.name),
    ["Night"],
  );
});

test("test_a_station_carries_the_snapshots_the_book_holds_under_its_name", () => {
  assert.deepEqual(
    station("Day")?.snapshots.map((/** @type {{ name: string }} */ s) => s.name),
    ["Warm", "Bright"],
  );
});

test("test_a_station_the_book_has_no_entry_for_carries_no_snapshots", () => {
  config.value = offering("Night", ["Day", "Night", "Spare"]);
  assert.deepEqual(station("Spare")?.snapshots, []);
});

test("test_before_the_book_is_read_a_station_carries_no_snapshots", () => {
  liveBook.value = null;
  assert.deepEqual(station("Day")?.snapshots, []);
});

test("test_outside_live_a_station_carries_its_snapshots_once_the_book_is_wanted", async () => {
  liveBook.value = null;
  presetWire({ station: "Night", presets: [rec("Quiet", "pcm")], others: { Day: [rec("Warm", "pcm")] } });
  bookWanted.value = true;
  await settle();
  assert.deepEqual(
    station("Day")?.snapshots.map((/** @type {{ name: string }} */ s) => s.name),
    ["Warm"],
  );
});

test("test_unfolding_a_station_opens_it", () => {
  toggleStation("Night");
  assert.equal(station("Night")?.open, true);
});

test("test_unfolding_a_second_station_folds_the_first", () => {
  toggleStation("Day");
  toggleStation("Night");
  assert.equal(station("Day")?.open, false);
});

test("test_unfolding_the_open_station_again_folds_it", () => {
  toggleStation("Night");
  toggleStation("Night");
  assert.equal(station("Night")?.open, false);
});

test("test_a_snapshots_tip_is_one_label_and_name_line_per_held_field_in_row_order", () => {
  assert.equal(snapshotTip(sdmRecord()), SDM_TIP);
});

test("test_a_snapshots_tip_names_the_1x_filter_by_its_simplified_name_with_plain_names_on", () => {
  plainNames.value = true;
  assert.equal(snapshotTip(sdmRecord()).split("\n")[0], SDM_TIP_1X_SIMPLIFIED);
});
