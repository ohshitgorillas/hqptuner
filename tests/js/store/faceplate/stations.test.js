// Behavioral suite for hqptuner/static/store/faceplate/stations.js: the header's Station · Snapshot tree. One station
// per named preset the config offers, the loaded one marked, each carrying the live snapshots the book holds under its
// name; one station unfolded at a time.
//
// Driven by assigning the exported signals the tree is read from: the config the poll writes and the live-snapshot
// book store/live/presets.js reads. Preset and snapshot names are the fixture's own wire data.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/faceplate/stations.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { config } from "../../../../hqptuner/static/store/signals.js";
import { liveBook, bookWanted } from "../../../../hqptuner/static/store/live/presets.js";
import { stationTree, unfolded, toggleStation } from "../../../../hqptuner/static/store/faceplate/stations.js";

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

beforeEach(() => {
  bookWanted.value = false;
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
