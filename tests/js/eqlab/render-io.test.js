// Characterization suite for scripts/eqlab/render.js: the jobs that compare or
// move a chain rather than search for one — diff, snapshot, export and plot.
// The header block, probe and evaluate live in render.test.js and the sweep
// jobs in render-search.test.js; fixtures and readers are shared from
// tests/js/support/render-fixtures.js.
//
// Written blind from a spec block; render.js itself was not read. Headings and
// labels are copy this suite does not know, so it asserts the values a report
// is supposed to name, the rows a table is supposed to have, and the lines a
// section costs when its data is there — never a phrase.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqlab/render-io.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  NOTE_DELTA,
  PROCESS_A,
  SAVED_AT,
  SNAP_NAME,
  SNAP_PATH,
  diffBody,
  includesAll,
  lineWith,
  mentionsAll,
  rep,
  rowsWith,
  sectionOmitted,
  show,
} from "../support/render-fixtures.js";

// --- a diff job ---------------------------------------------------------------

test("test_a_diff_names_the_source_it_was_compared_against", () => {
  assert.ok(...includesAll(show(rep("diff", diffBody())), [SNAP_NAME]));
});

test("test_a_diff_reports_both_preamps", () => {
  assert.ok(...mentionsAll(show(rep("diff", diffBody())), [-3.5, -8.5]));
});

test("test_a_diff_reports_the_response_deltas_rmse_deviation_and_frequency", () => {
  assert.ok(...mentionsAll(show(rep("diff", diffBody())), [0.4, 1.5, 2500]));
});

test("test_a_diff_metric_row_carries_the_a_value_the_b_value_and_the_difference", () => {
  assert.ok(...mentionsAll(lineWith(show(rep("diff", diffBody())), "zzalpha"), [2.5, 7.5, 5.5]));
});

test("test_a_matched_band_row_lists_its_non_zero_deltas", () => {
  const bands = { matched: [{ f: 444, deltas: { zzalpha: 2.5 } }], only_a: [], only_b: [] };
  assert.ok(...includesAll(lineWith(show(rep("diff", diffBody({ bands }))), "444"), ["zzalpha", "2.5"]));
});

// lineWith returns "" when nothing matches, so the row has to be shown to
// exist before its lack of a delta means anything: a band that vanished
// entirely would otherwise pass this.
test("test_a_matched_band_whose_deltas_are_all_zero_lists_none_of_them", () => {
  const bands = { matched: [{ f: 444, deltas: { zzalpha: 0 } }], only_a: [], only_b: [] };
  const row = lineWith(show(rep("diff", diffBody({ bands }))), "444");
  assert.ok(row !== "" && !row.includes("zzalpha"), `expected a band row naming no delta, got: ${row}`);
});

test("test_a_diff_lists_the_bands_present_only_in_a_and_those_present_only_in_b", () => {
  const bands = { matched: [], only_a: [{ f: 333, g: 1.5 }], only_b: [{ f: 888, g: 2.5 }] };
  assert.ok(...mentionsAll(show(rep("diff", diffBody({ bands }))), [333, 888]));
});

test("test_a_diff_side_with_no_bands_of_its_own_omits_that_section", () => {
  const onlyA = [
    { f: 333, g: 1.5 },
    { f: 222, g: 3.5 },
  ];
  const sides = (/** @type {number} */ n) => ({ matched: [], only_a: onlyA.slice(0, n), only_b: [{ f: 888, g: 2.5 }] });
  const rendered = (/** @type {number} */ n) => show(rep("diff", diffBody({ bands: sides(n) })));
  assert.ok(...sectionOmitted(rendered(0), rendered(1), rendered(2)));
});

test("test_a_diff_carrying_note_deltas_prints_the_note_delta_table", () => {
  assert.ok(...includesAll(show(rep("diff", diffBody({ note_deltas: [NOTE_DELTA] }))), ["A4"]));
});

// --- a snapshot job -----------------------------------------------------------

const SAVED = { saved: { name: SNAP_NAME, path: SNAP_PATH, process: PROCESS_A } };

test("test_a_saved_snapshot_reports_the_name_and_the_path_it_went_to", () => {
  assert.ok(...includesAll(show(rep("snapshot", SAVED)), [SNAP_NAME, SNAP_PATH]));
});

test("test_a_saved_snapshot_prints_the_process_string_that_was_saved", () => {
  assert.ok(...includesAll(show(rep("snapshot", SAVED)), [PROCESS_A]));
});

const STORE_DIR = "/srv/fixtures/zzsnapshots";
const STORED = [
  { name: "zzstoredone", saved_at: SAVED_AT, band_count: 7, preamp_db: -3.5 },
  { name: "zzstoredtwo", saved_at: "2026-08-15T01:02:03Z", band_count: 9, preamp_db: -8.5 },
];

test("test_a_snapshot_listing_prints_one_row_per_stored_snapshot", () => {
  assert.equal(rowsWith(show(rep("snapshot", { dir: STORE_DIR, snapshots: STORED })), "zzstored"), 2);
});

test("test_a_stored_snapshot_row_carries_when_it_was_saved_its_band_count_and_its_preamp", () => {
  const row = lineWith(show(rep("snapshot", { dir: STORE_DIR, snapshots: STORED })), "zzstoredone");
  assert.ok(...includesAll(row, [SAVED_AT, "7", "-3.5"]));
});

test("test_an_empty_snapshot_store_names_the_directory", () => {
  assert.ok(...includesAll(show(rep("snapshot", { dir: STORE_DIR, snapshots: [] })), [STORE_DIR]));
});

// --- an export job ------------------------------------------------------------

const EXPORT_PATH = "/srv/fixtures/zzexport.txt";

/** @param {Record<string, unknown>} [over] */
const exportBody = (over = {}) => ({
  filters: 12,
  path: EXPORT_PATH,
  preamp_db: -3.5,
  preamp_source: "zzpreampsource",
  skipped: [],
  ...over,
});

test("test_an_export_reports_how_many_filters_were_written_and_where", () => {
  assert.ok(...includesAll(show(rep("export", exportBody())), ["12", EXPORT_PATH]));
});

test("test_an_export_reports_the_preamp_and_where_it_came_from", () => {
  assert.ok(...includesAll(show(rep("export", exportBody())), ["-3.5", "zzpreampsource"]));
});

test("test_an_export_lists_the_entries_it_skipped", () => {
  const skipped = ["zzskipone", "zzskiptwo"];
  assert.ok(...includesAll(show(rep("export", exportBody({ skipped }))), ["zzskipone", "zzskiptwo"]));
});

test("test_an_export_that_skipped_nothing_omits_the_skipped_section", () => {
  const one = show(rep("export", exportBody({ skipped: ["zzskipone"] })));
  const two = show(rep("export", exportBody({ skipped: ["zzskipone", "zzskiptwo"] })));
  assert.ok(...sectionOmitted(show(rep("export", exportBody())), one, two));
});

// --- a plot job ---------------------------------------------------------------

const PLOT = { path: "/srv/fixtures/zzplot.png", series: ["zzseriesone", "zzseriestwo"] };

test("test_a_plot_reports_the_path_it_was_written_to", () => {
  assert.ok(...includesAll(show(rep("plot", PLOT)), [PLOT.path]));
});

test("test_a_plot_reports_the_names_of_the_series_plotted", () => {
  assert.ok(...includesAll(show(rep("plot", PLOT)), ["zzseriesone", "zzseriestwo"]));
});
