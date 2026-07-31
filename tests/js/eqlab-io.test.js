// Behavioral suite for eqlab v2 S4 chain I/O — XML chain source, ParametricEQ
// text source, the snapshot store, the export job and the diff job. Written
// blind from a spec block: no eqlab source was read.
//
// Every file fixture is a literal string written into a per-test temp dir
// (fs.mkdtempSync); nothing here touches the daemon or the network.
//
// Known gap: metric_deltas arithmetic (B minus A per metric) is only pinned as
// the empty object here — the ctx recipe fixes metrics to the empty panel
// (resolveMetricSpecs(undefined)), so there is no metric to take a delta of.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/eqlab-io.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveChain, serialize } from "../../scripts/eqlab/chain.js";
import { readXmlRows, readParametricEq, readSnapshot, snapshotJob, exportJob } from "../../scripts/eqlab/io.js";
import { diffJob } from "../../scripts/eqlab/jobs.js";
import { resolveMetricSpecs, valueAt } from "../../scripts/eqlab/metrics.js";
import { FS, near, above, curve, XFEED, TAIL } from "./eqlab-helpers.js";

// --- fixtures ------------------------------------------------------------------

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "eqlab-io-"));

const writeTmp = (content, name) => {
  const p = path.join(tmp(), name);
  fs.writeFileSync(p, content);
  return p;
};

// Config-snapshot XML in hqplayerd.xml shape: <matrix> holds self-closing
// <pipeline channel=... process=.../> rows (hqplayerd-readme.txt §1.11); a
// <matrix_profile> holds its own rows for a saved profile (§1.12).
const pipe = (channel, process) =>
  `  <pipeline channel="${channel}" gain="0" mixdown="0" process="${process}" source="0"/>`;

const xmlDoc = (rows, extra = "") =>
  `<?xml version="1.0" encoding="utf-8"?>\n<hqplayerd>\n <matrix>\n${rows.join("\n")}\n </matrix>\n${extra}\n</hqplayerd>\n`;

const writeXml = (rows, extra = "") => writeTmp(xmlDoc(rows, extra), "cfg.xml");

// The band objects TAIL serializes from — resolveChain({bands}) is the easiest
// ctx source per the spec.
const TAIL_BANDS = [
  { type: "peak", f: 1000, q: 1, g: 3 },
  { type: "peak", f: 3000, q: 2, g: -2 },
];

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

// REW / EQ APO text (docs/eq-export.md §2).
const PEQ_ONE = "Preamp: -3.5 dB\nFilter 1: ON PK Fc 105 Hz Gain -3.2 dB Q 1.41\n";

// --- XML chain source ----------------------------------------------------------

test("test_an_xml_chain_carries_one_stage_per_stage_of_the_process_attribute", async () => {
  const resolved = await resolveChain({ from: "xml", path: writeXml([pipe(0, TAIL)]) });
  assert.equal(resolved.stages.length, 2);
});

test("test_an_xml_chains_stages_carry_the_attributes_own_parameters", async () => {
  const resolved = await resolveChain({ from: "xml", path: writeXml([pipe(0, TAIL)]) });
  assert.ok(...near(valueAt(curve(resolved.stages), 1000), 3, 0.1));
});

test("test_the_xml_row_defaults_to_zero", async () => {
  const resolved = await resolveChain({ from: "xml", path: writeXml([pipe(0, TAIL)]) });
  assert.equal(resolved.source.row, 0);
});

// Channel-1 row deliberately written FIRST in the document: selection must go
// by the channel attribute, not by document position.
const OUT_OF_ORDER = [pipe(1, "iir:type=peak;f=500;q=1;g=9"), pipe(0, TAIL)];

test("test_the_default_row_is_the_channel_zero_row_not_the_first_row_in_the_document", async () => {
  const resolved = await resolveChain({ from: "xml", path: writeXml(OUT_OF_ORDER) });
  assert.ok(...near(valueAt(curve(resolved.stages), 1000), 3, 0.1));
});

test("test_an_explicit_row_selects_by_channel_attribute_value", async () => {
  const resolved = await resolveChain({ from: "xml", path: writeXml(OUT_OF_ORDER), row: 1 });
  assert.ok(...near(valueAt(curve(resolved.stages), 500), 9, 0.1));
});

test("test_a_channel_no_pipeline_carries_is_named_in_the_error", async () => {
  const p = writeXml([pipe(0, TAIL)]);
  await assert.rejects(() => resolveChain({ from: "xml", path: p, row: 7 }), /7/);
});

test("test_eq_only_drops_a_leading_non_eq_stage_from_an_xml_row", async () => {
  const p = writeXml([pipe(0, `${XFEED},${TAIL}`)]);
  const resolved = await resolveChain({ from: "xml", path: p, eq_only: true });
  assert.equal(resolved.stages.length, 2);
});

test("test_without_eq_only_a_leading_non_eq_stage_is_kept", async () => {
  const p = writeXml([pipe(0, `${XFEED},${TAIL}`)]);
  const resolved = await resolveChain({ from: "xml", path: p });
  assert.equal(resolved.stages.length, 3);
});

const PROFILE = ` <matrix_profile name="saved">\n${pipe(7, "iir:type=peak;f=500;q=1;g=9")}\n </matrix_profile>`;

test("test_pipeline_rows_inside_a_matrix_profile_are_never_counted", async () => {
  const p = writeXml([pipe(0, TAIL)], PROFILE);
  await assert.rejects(() => resolveChain({ from: "xml", path: p, row: 7 }));
});

test("test_a_matrix_profile_row_with_a_different_tail_does_not_break_consistency", async () => {
  const p = writeXml([pipe(0, TAIL), pipe(1, TAIL)], PROFILE);
  const resolved = await resolveChain({ from: "xml", path: p });
  assert.equal(resolved.consistency.tail_consistent, true);
});

test("test_xml_attribute_entities_in_the_process_attribute_are_unescaped", async () => {
  const p = writeXml([pipe(0, "pre&amp;&lt;&gt;&quot;&apos;post")]);
  const rows = await readXmlRows(p);
  assert.equal(rows[0].process, `pre&<>"'post`);
});

test("test_readxmlrows_returns_rows_sorted_by_channel_not_document_order", async () => {
  const rows = await readXmlRows(writeXml(OUT_OF_ORDER));
  assert.equal(rows[0].index, 0);
});

test("test_a_file_with_no_matrix_element_is_rejected", async () => {
  const p = writeTmp(`<?xml version="1.0"?>\n<hqplayerd>\n <engine/>\n</hqplayerd>\n`, "cfg.xml");
  await assert.rejects(() => resolveChain({ from: "xml", path: p }));
});

test("test_a_matrix_with_zero_pipeline_rows_is_rejected", async () => {
  const p = writeTmp(`<?xml version="1.0"?>\n<hqplayerd>\n <matrix>\n </matrix>\n</hqplayerd>\n`, "cfg.xml");
  await assert.rejects(() => resolveChain({ from: "xml", path: p }));
});

test("test_an_xml_chain_reports_xml_as_its_source_kind", async () => {
  const resolved = await resolveChain({ from: "xml", path: writeXml([pipe(0, TAIL)]) });
  assert.equal(resolved.source.kind, "xml");
});

test("test_an_xml_source_reports_the_path_it_was_read_from", async () => {
  const p = writeXml([pipe(0, TAIL)]);
  const resolved = await resolveChain({ from: "xml", path: p });
  assert.equal(resolved.source.path, p);
});

test("test_an_xml_source_reports_eq_only_as_a_boolean_when_not_asked_for", async () => {
  const resolved = await resolveChain({ from: "xml", path: writeXml([pipe(0, TAIL)]) });
  assert.equal(resolved.source.eq_only, false);
});

test("test_an_xml_source_reports_its_stage_count", async () => {
  const resolved = await resolveChain({ from: "xml", path: writeXml([pipe(0, TAIL)]) });
  assert.equal(resolved.source.stage_count, 2);
});

test("test_an_xml_source_reports_the_rows_serialized_process_string", async () => {
  const resolved = await resolveChain({ from: "xml", path: writeXml([pipe(0, TAIL)]) });
  assert.equal(resolved.source.process, TAIL);
});

test("test_identical_eq_tails_on_every_matrix_row_are_consistent", async () => {
  const p = writeXml([pipe(0, TAIL), pipe(1, `${XFEED},${TAIL}`)]);
  const resolved = await resolveChain({ from: "xml", path: p });
  assert.equal(resolved.consistency.tail_consistent, true);
});

test("test_a_matrix_row_whose_tail_differs_from_row_zero_is_an_offender", async () => {
  const p = writeXml([pipe(0, TAIL), pipe(1, "iir:type=peak;f=1000;q=1;g=5")]);
  const resolved = await resolveChain({ from: "xml", path: p });
  assert.deepEqual(resolved.consistency.offending_rows, [1]);
});

// --- ParametricEQ text chain source ----------------------------------------------

test("test_a_pk_filter_line_becomes_a_peak_band", async () => {
  const resolved = await resolveChain({ from: "parametric_eq", path: writeTmp(PEQ_ONE, "eq.txt") });
  assert.equal(resolved.stages[0].args.type, "peak");
});

test("test_an_lsc_filter_line_becomes_a_low_shelf_band", async () => {
  const p = writeTmp("Filter 1: ON LSC Fc 100 Hz Gain 2 dB Q 0.7\n", "eq.txt");
  const resolved = await resolveChain({ from: "parametric_eq", path: p });
  assert.equal(resolved.stages[0].args.type, "lshelf");
});

test("test_an_hsc_filter_line_becomes_a_high_shelf_band", async () => {
  const p = writeTmp("Filter 1: ON HSC Fc 8000 Hz Gain -1.5 dB Q 0.7\n", "eq.txt");
  const resolved = await resolveChain({ from: "parametric_eq", path: p });
  assert.equal(resolved.stages[0].args.type, "hshelf");
});

test("test_a_parsed_filters_frequency_and_gain_are_carried_through", async () => {
  const resolved = await resolveChain({ from: "parametric_eq", path: writeTmp(PEQ_ONE, "eq.txt") });
  assert.ok(...near(valueAt(curve(resolved.stages), 105), -3.2, 0.1));
});

test("test_a_parsed_filters_q_is_carried_through", async () => {
  const resolved = await resolveChain({ from: "parametric_eq", path: writeTmp(PEQ_ONE, "eq.txt") });
  assert.ok(...near(Number(resolved.stages[0].args.q), 1.41, 0.001));
});

test("test_a_file_with_no_parseable_filter_lines_is_rejected_naming_the_path", async () => {
  const p = writeTmp("nothing to see here\n", "empty-eq.txt");
  await assert.rejects(() => resolveChain({ from: "parametric_eq", path: p }), /empty-eq\.txt/);
});

test("test_a_preamp_line_is_recorded_on_the_source", async () => {
  const resolved = await resolveChain({ from: "parametric_eq", path: writeTmp(PEQ_ONE, "eq.txt") });
  assert.equal(resolved.source.file_preamp_db, -3.5);
});

test("test_a_file_without_a_preamp_line_records_null", async () => {
  const p = writeTmp("Filter 1: ON PK Fc 105 Hz Gain -3.2 dB Q 1.41\n", "eq.txt");
  const resolved = await resolveChain({ from: "parametric_eq", path: p });
  assert.equal(resolved.source.file_preamp_db, null);
});

test("test_a_preamp_line_is_never_turned_into_a_stage", async () => {
  const resolved = await resolveChain({ from: "parametric_eq", path: writeTmp(PEQ_ONE, "eq.txt") });
  assert.equal(resolved.stages.length, 1);
});

// Corrected spec item 13: filter-shaped lines that cannot be imported (an OFF
// filter, an unsupported type token, no Fc) land in skipped — an array of
// human-readable reason strings; non-filter lines (headers, notes) are ignored
// silently.
const VALID_PK = "Filter 2: ON PK Fc 105 Hz Gain -3.2 dB Q 1.41";
const OFF_THEN_VALID = `Filter 1: OFF PK Fc 50 Hz Gain 1 dB Q 1\n${VALID_PK}`;
const NO_FC_THEN_VALID = `Filter 1: ON PK Gain 3 dB Q 1\n${VALID_PK}`;

test("test_an_off_filter_line_is_counted_in_skipped", async () => {
  const p = writeTmp(OFF_THEN_VALID, "eq.txt");
  const resolved = await resolveChain({ from: "parametric_eq", path: p });
  assert.equal(resolved.source.skipped.length, 1);
});

test("test_a_skipped_entrys_reason_names_the_cause", async () => {
  const p = writeTmp(OFF_THEN_VALID, "eq.txt");
  const resolved = await resolveChain({ from: "parametric_eq", path: p });
  assert.match(resolved.source.skipped[0], /OFF/);
});

test("test_a_filter_line_with_an_unsupported_type_is_counted_in_skipped", async () => {
  const p = writeTmp(`Filter 1: ON BP Fc 60 Hz Gain 0 dB Q 1.41\n${VALID_PK}`, "eq.txt");
  const resolved = await resolveChain({ from: "parametric_eq", path: p });
  assert.equal(resolved.source.skipped.length, 1);
});

test("test_a_filter_line_with_no_fc_is_counted_in_skipped", async () => {
  const p = writeTmp(NO_FC_THEN_VALID, "eq.txt");
  const resolved = await resolveChain({ from: "parametric_eq", path: p });
  assert.equal(resolved.source.skipped.length, 1);
});

test("test_a_filter_line_with_no_fc_never_becomes_a_stage", async () => {
  const p = writeTmp(NO_FC_THEN_VALID, "eq.txt");
  const resolved = await resolveChain({ from: "parametric_eq", path: p });
  assert.equal(resolved.stages.length, 1);
});

test("test_a_skipped_filter_line_never_becomes_a_stage", async () => {
  const p = writeTmp(OFF_THEN_VALID, "eq.txt");
  const resolved = await resolveChain({ from: "parametric_eq", path: p });
  assert.equal(resolved.stages.length, 1);
});

test("test_a_header_line_is_ignored_silently_not_skipped", async () => {
  const p = writeTmp(`Room EQ V5.20.13\n${VALID_PK}`, "eq.txt");
  const resolved = await resolveChain({ from: "parametric_eq", path: p });
  assert.deepEqual(resolved.source.skipped, []);
});

test("test_a_header_line_does_not_stop_the_valid_filter_from_parsing", async () => {
  const p = writeTmp(`Room EQ V5.20.13\n${VALID_PK}`, "eq.txt");
  const resolved = await resolveChain({ from: "parametric_eq", path: p });
  assert.equal(resolved.stages.length, 1);
});

test("test_a_parametric_eq_chain_reports_parametric_eq_as_its_source_kind", async () => {
  const resolved = await resolveChain({ from: "parametric_eq", path: writeTmp(PEQ_ONE, "eq.txt") });
  assert.equal(resolved.source.kind, "parametric_eq");
});

test("test_a_parametric_eq_chain_has_no_consistency_verdict", async () => {
  const resolved = await resolveChain({ from: "parametric_eq", path: writeTmp(PEQ_ONE, "eq.txt") });
  assert.equal(resolved.consistency, null);
});

test("test_readparametriceq_reports_the_files_preamp", async () => {
  const parsed = await readParametricEq(writeTmp(PEQ_ONE, "eq.txt"));
  assert.equal(Number(parsed.preamp), -3.5);
});

// --- snapshot store --------------------------------------------------------------

test("test_saving_a_snapshot_writes_name_dot_json_under_the_given_dir", async () => {
  const dir = path.join(tmp(), "nested", "store");
  await snapshotJob({ save: "tuned", dir }, await ctxOf(TAIL_BANDS));
  assert.ok(fs.existsSync(path.join(dir, "tuned.json")), "expected <dir>/tuned.json to exist");
});

test("test_the_save_result_reports_the_snapshot_name", async () => {
  const result = await snapshotJob({ save: "tuned", dir: tmp() }, await ctxOf(TAIL_BANDS));
  assert.equal(result.saved.name, "tuned");
});

test("test_the_save_result_reports_the_chains_band_count", async () => {
  const result = await snapshotJob({ save: "tuned", dir: tmp() }, await ctxOf(TAIL_BANDS));
  assert.equal(result.saved.band_count, 2);
});

test("test_the_save_result_reports_the_file_it_wrote", async () => {
  const dir = tmp();
  const result = await snapshotJob({ save: "tuned", dir }, await ctxOf(TAIL_BANDS));
  assert.equal(result.saved.path, path.join(dir, "tuned.json"));
});

test("test_the_save_result_reports_the_chains_sample_rate", async () => {
  const result = await snapshotJob({ save: "tuned", dir: tmp() }, await ctxOf(TAIL_BANDS));
  assert.equal(result.saved.fs, FS);
});

test("test_the_save_result_reports_a_numeric_preamp", async () => {
  const result = await snapshotJob({ save: "tuned", dir: tmp() }, await ctxOf(TAIL_BANDS));
  assert.equal(typeof result.saved.preamp_db, "number");
});

test("test_the_save_result_reports_the_serialized_process_string", async () => {
  const ctx = await ctxOf(TAIL_BANDS);
  const result = await snapshotJob({ save: "tuned", dir: tmp() }, ctx);
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
  const result = await snapshotJob({ save: "My snap_1.v2-final", dir: tmp() }, await ctxOf(TAIL_BANDS));
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
  const listed = await snapshotJob({ list: true, dir }, ctx);
  assert.deepEqual(
    listed.snapshots.map((s) => s.name),
    ["alpha", "beta"],
  );
});

test("test_a_listed_snapshot_carries_its_sample_rate", async () => {
  const dir = tmp();
  const ctx = await ctxOf(TAIL_BANDS);
  await snapshotJob({ save: "tuned", dir }, ctx);
  const listed = await snapshotJob({ list: true, dir }, ctx);
  assert.equal(listed.snapshots[0].fs, FS);
});

test("test_a_listed_snapshot_carries_a_numeric_preamp", async () => {
  const dir = tmp();
  const ctx = await ctxOf(TAIL_BANDS);
  await snapshotJob({ save: "tuned", dir }, ctx);
  const listed = await snapshotJob({ list: true, dir }, ctx);
  assert.equal(typeof listed.snapshots[0].preamp_db, "number");
});

test("test_the_list_result_reports_the_directory_it_listed", async () => {
  const dir = tmp();
  const listed = await snapshotJob({ list: true, dir }, await ctxOf(TAIL_BANDS));
  assert.equal(listed.dir, dir);
});

test("test_listing_a_directory_that_does_not_exist_yields_an_empty_list", async () => {
  const listed = await snapshotJob({ list: true, dir: path.join(tmp(), "nope") }, await ctxOf(TAIL_BANDS));
  assert.deepEqual(listed.snapshots, []);
});

test("test_a_snapshot_job_with_neither_save_nor_list_is_rejected", async () => {
  const ctx = await ctxOf(TAIL_BANDS);
  // async wrapper: a synchronous throw and a rejected promise both count as
  // "rejects with an error" — the spec does not pin which one.
  await assert.rejects(async () => snapshotJob({ dir: tmp() }, ctx));
});

// --- export job -------------------------------------------------------------------

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
