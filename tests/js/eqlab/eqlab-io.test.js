// Behavioral suite for eqlab v2 S4 chain I/O, file sources half — the XML
// config-snapshot source and the ParametricEQ text source. Written blind from
// a spec block: no eqlab source was read. The snapshot store, export job and
// diff job live in eqlab-io-jobs.test.js (file-length gate split).
//
// Every file fixture is a literal string written into a per-test temp dir
// (fs.mkdtempSync); nothing here touches the daemon or the network.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/eqlab-io.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveChain } from "../../../scripts/eqlab/chain.js";
import { readXmlRows, readParametricEq } from "../../../scripts/eqlab/io.js";
import { valueAt } from "../../../scripts/eqlab/metrics.js";
import { near, curve, XFEED, TAIL } from "../support/eqlab-helpers.js";

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
