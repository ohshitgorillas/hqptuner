// Behavioral suite for eqlab v2 S4 chain I/O, jobs half — the snapshot store,
// the export job and the diff job. Written blind from a spec block: no eqlab
// source was read. The XML and ParametricEQ chain sources live in
// eqlab-io.test.js (file-length gate split).
//
// Every file fixture is a literal string written into a per-test temp dir
// (fs.mkdtempSync); nothing here touches the daemon or the network.
//
// Known gap: metric_deltas arithmetic (B minus A per metric) is only pinned as
// the empty object here — the ctx recipe fixes metrics to the empty panel
// (resolveMetricSpecs(undefined)), so there is no metric to take a delta of.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/eqlab-io-jobs.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveChain, serialize } from "../../../scripts/eqlab/chain.js";
import { readSnapshot, snapshotJob, exportJob } from "../../../scripts/eqlab/io.js";
import { diffJob } from "../../../scripts/eqlab/jobs.js";
import { resolveMetricSpecs } from "../../../scripts/eqlab/metrics.js";
import { FS, near, above } from "../support/eqlab-helpers.js";

// --- fixtures ------------------------------------------------------------------

/** @typedef {import("../../../scripts/eqlab/io.js").Snapshot} Snapshot */
/** @typedef {{ saved: Snapshot }} SaveResult */

/**
 * @typedef {{
 *   dir: string,
 *   snapshots: Pick<Snapshot, "name" | "saved_at" | "fs" | "band_count" | "preamp_db">[],
 * }} ListResult
 */

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "eqlab-io-"));

/**
 * @param {string} content
 * @param {string} name
 * @returns {string}
 */
const writeTmp = (content, name) => {
  const p = path.join(tmp(), name);
  fs.writeFileSync(p, content);
  return p;
};

// The band objects the shared TAIL process serializes from — resolveChain({bands})
// is the easiest ctx source per the spec.
const TAIL_BANDS = [
  { type: "peak", f: 1000, q: 1, g: 3 },
  { type: "peak", f: 3000, q: 2, g: -2 },
];

/**
 * @param {import("../../../scripts/eqlab/chain.js").Band[]} bands
 */
async function ctxOf(bands) {
  const resolved = await resolveChain({ bands });
  return {
    stages: resolved.stages,
    fs: FS,
    source: resolved.source,
    metrics: resolveMetricSpecs(undefined),
    notes: undefined,
    target: null,
  };
}

// --- snapshot store --------------------------------------------------------------

test("test_saving_a_snapshot_writes_name_dot_json_under_the_given_dir", async () => {
  const dir = path.join(tmp(), "nested", "store");
  await snapshotJob({ save: "tuned", dir }, await ctxOf(TAIL_BANDS));
  assert.ok(fs.existsSync(path.join(dir, "tuned.json")), "expected <dir>/tuned.json to exist");
});

test("test_the_save_result_reports_the_snapshot_name", async () => {
  const result = /** @type {SaveResult} */ (await snapshotJob({ save: "tuned", dir: tmp() }, await ctxOf(TAIL_BANDS)));
  assert.equal(result.saved.name, "tuned");
});

test("test_the_save_result_reports_the_chains_band_count", async () => {
  const result = /** @type {SaveResult} */ (await snapshotJob({ save: "tuned", dir: tmp() }, await ctxOf(TAIL_BANDS)));
  assert.equal(result.saved.band_count, 2);
});

test("test_the_save_result_reports_the_file_it_wrote", async () => {
  const dir = tmp();
  const result = /** @type {SaveResult} */ (await snapshotJob({ save: "tuned", dir }, await ctxOf(TAIL_BANDS)));
  assert.equal(result.saved.path, path.join(dir, "tuned.json"));
});

test("test_the_save_result_reports_the_chains_sample_rate", async () => {
  const result = /** @type {SaveResult} */ (await snapshotJob({ save: "tuned", dir: tmp() }, await ctxOf(TAIL_BANDS)));
  assert.equal(result.saved.fs, FS);
});

test("test_the_save_result_reports_a_numeric_preamp", async () => {
  const result = /** @type {SaveResult} */ (await snapshotJob({ save: "tuned", dir: tmp() }, await ctxOf(TAIL_BANDS)));
  assert.equal(typeof result.saved.preamp_db, "number");
});

test("test_the_save_result_reports_the_serialized_process_string", async () => {
  const ctx = await ctxOf(TAIL_BANDS);
  const result = /** @type {SaveResult} */ (await snapshotJob({ save: "tuned", dir: tmp() }, ctx));
  assert.equal(result.saved.process, serialize(ctx.stages));
});

test("test_saving_over_an_existing_name_without_overwrite_is_rejected", async () => {
  const dir = tmp();
  const ctx = await ctxOf(TAIL_BANDS);
  await snapshotJob({ save: "tuned", dir }, ctx);
  await assert.rejects(() => snapshotJob({ save: "tuned", dir }, ctx));
});

test("test_saving_with_overwrite_replaces_the_stored_chain", async () => {
  const dir = tmp();
  await snapshotJob({ save: "tuned", dir }, await ctxOf(TAIL_BANDS));
  await snapshotJob({ save: "tuned", dir, overwrite: true }, await ctxOf([TAIL_BANDS[0]]));
  const reloaded = await resolveChain({ from: "snapshot", name: "tuned", dir });
  assert.equal(reloaded.stages.length, 1);
});

test("test_a_snapshot_name_with_a_path_separator_is_rejected", async () => {
  const ctx = await ctxOf(TAIL_BANDS);
  await assert.rejects(() => snapshotJob({ save: "../x", dir: tmp() }, ctx));
});

test("test_a_snapshot_name_with_a_leading_dot_is_rejected", async () => {
  const ctx = await ctxOf(TAIL_BANDS);
  await assert.rejects(() => snapshotJob({ save: ".hidden", dir: tmp() }, ctx));
});

test("test_a_simple_name_with_spaces_dots_and_hyphens_is_accepted", async () => {
  const result = /** @type {SaveResult} */ (
    await snapshotJob({ save: "My snap_1.v2-final", dir: tmp() }, await ctxOf(TAIL_BANDS))
  );
  assert.equal(result.saved.name, "My snap_1.v2-final");
});

test("test_a_loaded_snapshot_carries_the_saved_chains_bands", async () => {
  const dir = tmp();
  const ctx = await ctxOf(TAIL_BANDS);
  await snapshotJob({ save: "tuned", dir }, ctx);
  const loaded = await resolveChain({ from: "snapshot", name: "tuned", dir });
  assert.equal(serialize(loaded.stages), serialize(ctx.stages));
});

test("test_a_loaded_snapshot_reports_snapshot_as_its_source_kind", async () => {
  const dir = tmp();
  await snapshotJob({ save: "tuned", dir }, await ctxOf(TAIL_BANDS));
  const loaded = await resolveChain({ from: "snapshot", name: "tuned", dir });
  assert.equal(loaded.source.kind, "snapshot");
});

test("test_a_loaded_snapshot_reports_its_name", async () => {
  const dir = tmp();
  await snapshotJob({ save: "tuned", dir }, await ctxOf(TAIL_BANDS));
  const loaded = await resolveChain({ from: "snapshot", name: "tuned", dir });
  assert.equal(loaded.source.name, "tuned");
});

test("test_a_loaded_snapshot_reports_the_file_it_came_from", async () => {
  const dir = tmp();
  await snapshotJob({ save: "tuned", dir }, await ctxOf(TAIL_BANDS));
  const loaded = await resolveChain({ from: "snapshot", name: "tuned", dir });
  assert.equal(loaded.source.path, path.join(dir, "tuned.json"));
});

test("test_a_loaded_snapshot_reports_when_it_was_saved", async () => {
  const dir = tmp();
  await snapshotJob({ save: "tuned", dir }, await ctxOf(TAIL_BANDS));
  const loaded = await resolveChain({ from: "snapshot", name: "tuned", dir });
  assert.ok(loaded.source.saved_at, "expected source.saved_at to be set");
});

test("test_readsnapshot_returns_the_stored_records_sample_rate", async () => {
  const dir = tmp();
  await snapshotJob({ save: "tuned", dir }, await ctxOf(TAIL_BANDS));
  const record = await readSnapshot({ dir, name: "tuned" });
  assert.equal(record.fs, FS);
});

test("test_loading_a_snapshot_that_was_never_saved_is_rejected", async () => {
  await assert.rejects(() => resolveChain({ from: "snapshot", name: "ghost", dir: tmp() }));
});

test("test_listing_snapshots_sorts_them_by_name", async () => {
  const dir = tmp();
  const ctx = await ctxOf(TAIL_BANDS);
  await snapshotJob({ save: "beta", dir }, ctx);
  await snapshotJob({ save: "alpha", dir }, ctx);
  const listed = /** @type {ListResult} */ (await snapshotJob({ list: true, dir }, ctx));
  assert.deepEqual(
    listed.snapshots.map((s) => s.name),
    ["alpha", "beta"],
  );
});

test("test_a_listed_snapshot_carries_its_sample_rate", async () => {
  const dir = tmp();
  const ctx = await ctxOf(TAIL_BANDS);
  await snapshotJob({ save: "tuned", dir }, ctx);
  const listed = /** @type {ListResult} */ (await snapshotJob({ list: true, dir }, ctx));
  assert.equal(listed.snapshots[0].fs, FS);
});

test("test_a_listed_snapshot_carries_a_numeric_preamp", async () => {
  const dir = tmp();
  const ctx = await ctxOf(TAIL_BANDS);
  await snapshotJob({ save: "tuned", dir }, ctx);
  const listed = /** @type {ListResult} */ (await snapshotJob({ list: true, dir }, ctx));
  assert.equal(typeof listed.snapshots[0].preamp_db, "number");
});

test("test_the_list_result_reports_the_directory_it_listed", async () => {
  const dir = tmp();
  const listed = /** @type {ListResult} */ (await snapshotJob({ list: true, dir }, await ctxOf(TAIL_BANDS)));
  assert.equal(listed.dir, dir);
});

test("test_listing_a_directory_that_does_not_exist_yields_an_empty_list", async () => {
  const listed = /** @type {ListResult} */ (
    await snapshotJob({ list: true, dir: path.join(tmp(), "nope") }, await ctxOf(TAIL_BANDS))
  );
  assert.deepEqual(listed.snapshots, []);
});

test("test_a_snapshot_job_with_neither_save_nor_list_is_rejected", async () => {
  const ctx = await ctxOf(TAIL_BANDS);
  // async wrapper: a synchronous throw and a rejected promise both count as
  // "rejects with an error" — the spec does not pin which one.
  await assert.rejects(async () => snapshotJob({ dir: tmp() }, ctx));
});

// --- export job -------------------------------------------------------------------

/**
 * @param {import("../../../scripts/eqlab/chain.js").Band[]} bands
 * @param {Record<string, unknown>} [spec]
 */
const exportTo = async (bands, spec = {}) => {
  const p = path.join(tmp(), "out.txt");
  const result = await exportJob({ path: p, ...spec }, await ctxOf(bands));
  return { p, result };
};

test("test_an_exported_file_opens_with_a_preamp_line", async () => {
  const { p } = await exportTo(TAIL_BANDS);
  assert.match(fs.readFileSync(p, "utf8").split("\n")[0], /^Preamp: -?\d+(\.\d+)? dB$/);
});

test("test_an_exported_file_carries_one_filter_line_per_band", async () => {
  const { p } = await exportTo(TAIL_BANDS);
  const filterLines = fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((line) => /^Filter \d+: ON /.test(line));
  assert.equal(filterLines.length, 2);
});

test("test_a_lone_plus_three_db_peak_exports_a_preamp_close_to_minus_three", async () => {
  const { result } = await exportTo([{ type: "peak", f: 1000, q: 1, g: 3 }]);
  assert.ok(...near(result.preamp_db, -3, 0.5));
});

test("test_a_cut_only_chain_exports_a_preamp_close_to_zero", async () => {
  const { result } = await exportTo([{ type: "peak", f: 1000, q: 1, g: -3 }]);
  assert.ok(...near(result.preamp_db, 0, 0.5));
});

test("test_the_export_result_names_the_preamp_source_as_the_computed_response", async () => {
  const { result } = await exportTo(TAIL_BANDS);
  assert.equal(result.preamp_source, "computed_response");
});

test("test_the_export_result_reports_the_path_it_wrote", async () => {
  const { p, result } = await exportTo(TAIL_BANDS);
  assert.equal(result.path, p);
});

test("test_the_export_result_reports_how_many_filters_it_wrote", async () => {
  const { result } = await exportTo(TAIL_BANDS);
  assert.equal(result.filters, 2);
});

test("test_exporting_onto_an_existing_file_without_overwrite_is_rejected", async () => {
  const p = writeTmp("precious", "out.txt");
  const ctx = await ctxOf(TAIL_BANDS);
  await assert.rejects(() => exportJob({ path: p }, ctx));
});

test("test_exporting_with_overwrite_replaces_the_existing_file", async () => {
  const p = writeTmp("precious", "out.txt");
  await exportJob({ path: p, overwrite: true }, await ctxOf(TAIL_BANDS));
  assert.match(fs.readFileSync(p, "utf8"), /^Preamp: /);
});

test("test_an_unknown_export_format_is_rejected", async () => {
  const ctx = await ctxOf(TAIL_BANDS);
  await assert.rejects(() => exportJob({ path: path.join(tmp(), "out.csv"), format: "csv" }, ctx));
});

test("test_a_chain_with_no_exportable_filters_is_rejected", async () => {
  const ctx = await ctxOf([]);
  await assert.rejects(() => exportJob({ path: path.join(tmp(), "out.txt") }, ctx));
});

test("test_a_rejected_export_writes_nothing", async () => {
  const p = path.join(tmp(), "out.txt");
  await exportJob({ path: p }, await ctxOf([])).catch(() => {});
  assert.equal(fs.existsSync(p), false);
});

test("test_an_export_job_without_a_path_is_rejected", async () => {
  const ctx = await ctxOf(TAIL_BANDS);
  await assert.rejects(() => exportJob({}, ctx));
});

test("test_an_exported_chain_round_trips_through_the_parametric_eq_reader", async () => {
  const { p } = await exportTo(TAIL_BANDS);
  const reread = await resolveChain({ from: "parametric_eq", path: p });
  assert.equal(reread.stages.length, 2);
});

// --- diff job ---------------------------------------------------------------------

const PEAK_3 = { type: "peak", f: 1000, q: 1, g: 3 };

test("test_a_diff_reports_the_ctx_chains_band_count_on_panel_a", async () => {
  const report = await diffJob({ against: { bands: [PEAK_3] } }, await ctxOf(TAIL_BANDS));
  assert.equal(report.a.band_count, 2);
});

test("test_a_diff_reports_the_against_chains_band_count_on_panel_b", async () => {
  const report = await diffJob({ against: { bands: [PEAK_3] } }, await ctxOf(TAIL_BANDS));
  assert.equal(report.b.band_count, 1);
});

test("test_a_diff_panel_carries_the_chains_process_string", async () => {
  const report = await diffJob({ against: { bands: [PEAK_3] } }, await ctxOf(TAIL_BANDS));
  assert.equal(typeof report.a.process, "string");
});

test("test_a_diff_panel_carries_a_numeric_preamp", async () => {
  const report = await diffJob({ against: { bands: [PEAK_3] } }, await ctxOf(TAIL_BANDS));
  assert.equal(typeof report.a.preamp_db, "number");
});

test("test_metric_deltas_is_empty_under_the_empty_metrics_panel", async () => {
  const report = await diffJob({ against: { bands: [PEAK_3] } }, await ctxOf(TAIL_BANDS));
  assert.deepEqual(report.metric_deltas, {});
});

test("test_response_delta_maxdev_is_b_minus_a", async () => {
  const report = await diffJob({ against: { bands: [PEAK_3] } }, await ctxOf([]));
  assert.ok(...near(report.response_delta.maxdev, 3, 0.3));
});

test("test_response_delta_locates_the_max_deviation_near_the_peaks_centre", async () => {
  const report = await diffJob({ against: { bands: [PEAK_3] } }, await ctxOf([]));
  assert.ok(...near(report.response_delta.hz, 1000, 100));
});

test("test_a_differing_pair_of_chains_has_nonzero_response_rmse", async () => {
  const report = await diffJob({ against: { bands: [PEAK_3] } }, await ctxOf([]));
  assert.ok(...above(report.response_delta.rmse, 0));
});

const A_CUT = [{ type: "peak", f: 1000, q: 1, g: -3 }];
const B_HALF_CUT = { bands: [{ type: "peak", f: 1000, q: 1, g: -1.5 }] };

test("test_bands_at_the_same_frequency_on_both_sides_are_matched", async () => {
  const report = await diffJob({ against: B_HALF_CUT }, await ctxOf(A_CUT));
  assert.equal(report.bands.matched.length, 1);
});

test("test_a_matched_bands_gain_delta_is_b_minus_a", async () => {
  const report = await diffJob({ against: B_HALF_CUT }, await ctxOf(A_CUT));
  assert.ok(...near(report.bands.matched[0].deltas.g, 1.5, 0.001));
});

test("test_a_matched_bands_q_delta_is_b_minus_a", async () => {
  const report = await diffJob({ against: { bands: [{ type: "peak", f: 1000, q: 2, g: -3 }] } }, await ctxOf(A_CUT));
  assert.ok(...near(report.bands.matched[0].deltas.q, 1, 0.001));
});

test("test_a_frequency_only_a_carries_lands_in_only_a", async () => {
  const report = await diffJob({ against: B_HALF_CUT }, await ctxOf([...A_CUT, { type: "peak", f: 2000, q: 2, g: 1 }]));
  assert.equal(Number(report.bands.only_a[0].f), 2000);
});

test("test_a_frequency_only_b_carries_lands_in_only_b", async () => {
  const report = await diffJob(
    { against: { bands: [...B_HALF_CUT.bands, { type: "peak", f: 500, q: 2, g: 2 }] } },
    await ctxOf(A_CUT),
  );
  assert.equal(Number(report.bands.only_b[0].f), 500);
});

test("test_a_frequency_carried_twice_on_one_side_is_never_matched", async () => {
  const report = await diffJob({ against: B_HALF_CUT }, await ctxOf([...A_CUT, ...A_CUT]));
  assert.equal(report.bands.matched.length, 0);
});

test("test_both_duplicate_bands_land_in_their_sides_only_list", async () => {
  const report = await diffJob({ against: B_HALF_CUT }, await ctxOf([...A_CUT, ...A_CUT]));
  assert.equal(report.bands.only_a.length, 2);
});

test("test_a_diff_job_with_no_against_is_rejected", async () => {
  const ctx = await ctxOf(A_CUT);
  await assert.rejects(() => diffJob({}, ctx));
});

test("test_against_source_echoes_the_b_chains_provenance", async () => {
  const report = await diffJob({ against: B_HALF_CUT }, await ctxOf(A_CUT));
  assert.equal(report.against_source.kind, "bands");
});

test("test_a_snapshot_against_reports_snapshot_provenance", async () => {
  const dir = tmp();
  const ctx = await ctxOf(A_CUT);
  await snapshotJob({ save: "other", dir }, ctx);
  const report = await diffJob({ against: { from: "snapshot", name: "other", dir } }, ctx);
  assert.equal(report.against_source.kind, "snapshot");
});

test("test_against_tail_consistency_is_null_for_a_single_chain_source", async () => {
  const report = await diffJob({ against: B_HALF_CUT }, await ctxOf(A_CUT));
  assert.equal(report.against_tail_consistency, null);
});
