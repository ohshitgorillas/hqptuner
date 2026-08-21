// Characterization suite for scripts/eqlab/render.js: the header block every
// report carries, the probe job, the evaluate job and the note tables both of
// them print. The sweep jobs live in render-search.test.js and the read/write
// jobs in render-io.test.js; fixtures and readers are shared from
// tests/js/support/render-fixtures.js.
//
// Written blind from a spec block; render.js itself was not read. The prose of
// a heading, a label or an "empty" message is copy this suite does not know, so
// it never asserts a phrase. It asserts what the behavior claims and a caller
// can see: a value the report should name is in it, a table has one row per
// entry, a column is blank, a section costs lines when its data is there and
// none when it is not. Numbers go through mentionsAll(), which accepts the
// decimal and kilo renderings a formatter may pick, so a change of precision
// does not break a test that was never about precision.
//
// Two shapes recur. "Omits the section entirely" compares the line cost of the
// first entry against that of the second: a section always printed and merely
// empty makes the two equal, a section that vanishes makes the first larger.
// A behavior whose only observable is copy (a boolean that changes the
// wording, a source kind carrying no data of its own) is pinned as a difference
// between the two renderings.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqlab/render.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  DAEMON_URL,
  FIT,
  FS,
  NOTE_DB,
  NOTE_DELTA,
  PEQ_PATH,
  PROCESS_A,
  SAVED_AT,
  SNAP_NAME,
  STAGES,
  XML_PATH,
  count,
  daemonSrc,
  differ,
  evalBody,
  firstLine,
  includesAll,
  lineWith,
  lines,
  mentionsAll,
  noneSrc,
  peqSrc,
  probeBody,
  rep,
  rowLabeled,
  rowsWith,
  sectionOmitted,
  show,
  snapSrc,
  tokens,
  xmlSrc,
} from "../support/render-fixtures.js";

/** @param {Record<string, unknown>} [over] */
const probeRep = (over = {}) => show(rep("probe", probeBody(), over));

// --- the header, on every job -------------------------------------------------

test("test_the_report_opens_with_the_source_the_chain_came_from", () => {
  assert.ok(...includesAll(firstLine(probeRep({ source: daemonSrc() })), [DAEMON_URL]));
});

test("test_a_daemon_source_names_the_row_and_the_url_it_was_read_from", () => {
  assert.ok(...includesAll(firstLine(probeRep({ source: daemonSrc() })), ["13", DAEMON_URL]));
});

test("test_an_xml_source_names_the_row_and_the_file_path", () => {
  assert.ok(...includesAll(firstLine(probeRep({ source: xmlSrc() })), ["13", XML_PATH]));
});

test("test_a_parametric_eq_source_names_the_file_path", () => {
  assert.ok(...includesAll(firstLine(probeRep({ source: peqSrc() })), [PEQ_PATH]));
});

test("test_a_snapshot_source_names_the_snapshot_and_when_it_was_saved", () => {
  assert.ok(...includesAll(firstLine(probeRep({ source: snapSrc() })), [SNAP_NAME, SAVED_AT]));
});

test("test_a_store_operation_with_no_chain_reads_differently_from_a_chain_off_the_job", () => {
  const store = firstLine(probeRep({ source: noneSrc() }));
  assert.ok(...differ(store, firstLine(probeRep({ source: { kind: "zzunknown", stage_count: STAGES } }))));
});

test("test_a_daemon_source_read_for_its_eq_tail_only_says_so_on_the_source_line", () => {
  const tail = firstLine(probeRep({ source: daemonSrc({ eq_only: true }) }));
  const whole = firstLine(probeRep({ source: daemonSrc({ eq_only: false }) }));
  assert.ok(tail.length > whole.length, `eq_only source line said nothing extra: ${tail}`);
});

test("test_an_xml_source_read_for_its_eq_tail_only_says_so_on_the_source_line", () => {
  const tail = firstLine(probeRep({ source: xmlSrc({ eq_only: true }) }));
  const whole = firstLine(probeRep({ source: xmlSrc({ eq_only: false }) }));
  assert.ok(tail.length > whole.length, `eq_only source line said nothing extra: ${tail}`);
});

test("test_a_parametric_eq_source_says_how_many_input_lines_it_skipped", () => {
  const skipped = ["zzskipone", "zzskiptwo", "zzskipthree"];
  assert.ok(...includesAll(firstLine(probeRep({ source: peqSrc({ skipped }) })), ["3"]));
});

test("test_a_parametric_eq_source_that_skipped_nothing_does_not_mention_skipping", () => {
  const quiet = firstLine(probeRep({ source: peqSrc({ skipped: [] }) }));
  const noisy = firstLine(probeRep({ source: peqSrc({ skipped: ["zzskipone"] }) }));
  assert.ok(quiet.length < noisy.length, `an empty skip list still said something: ${quiet}`);
});

test("test_the_header_states_how_many_stages_the_chain_has", () => {
  assert.ok(...mentionsAll(probeRep(), [STAGES]));
});

test("test_the_header_states_the_sample_rate", () => {
  assert.ok(...mentionsAll(probeRep(), [FS]));
});

test("test_a_consistent_tail_reports_how_many_rows_were_checked", () => {
  const tail = { tail_consistent: true, offending_rows: [], rows_checked: 24 };
  assert.ok(...mentionsAll(probeRep({ tail_consistency: tail }), [24]));
});

test("test_an_inconsistent_tail_lists_the_rows_that_offended", () => {
  const tail = { tail_consistent: false, offending_rows: [11, 19], rows_checked: 24 };
  assert.ok(...includesAll(probeRep({ tail_consistency: tail }), ["11", "19"]));
});

test("test_a_report_with_no_tail_check_reads_differently_from_one_with_a_consistent_tail", () => {
  const tail = { tail_consistent: true, offending_rows: [], rows_checked: 24 };
  assert.ok(...differ(probeRep({ tail_consistency: null }), probeRep({ tail_consistency: tail })));
});

// The two renderings carry the same rows_checked and differ only in the verdict
// and in the offending-row list, so dropping every line that mentions an
// offending row leaves the verdict as the only thing left to differ on. 11 and
// 19 are spelled by nothing else this report prints: not 17, 48000, -3.5, 2.5,
// 2500 or 24.
test("test_a_consistent_tail_states_a_different_verdict_from_an_inconsistent_one", () => {
  const rows = (/** @type {string} */ text) =>
    lines(text)
      .filter((l) => !l.includes("11") && !l.includes("19"))
      .join("\n");
  const yes = rows(probeRep({ tail_consistency: { tail_consistent: true, offending_rows: [], rows_checked: 24 } }));
  const no = rows(
    probeRep({ tail_consistency: { tail_consistent: false, offending_rows: [11, 19], rows_checked: 24 } }),
  );
  assert.ok(...differ(yes, no));
});

test("test_a_report_carrying_a_target_states_its_summary", () => {
  assert.ok(...includesAll(probeRep({ target: { summary: "zztarget summary" } }), ["zztarget summary"]));
});

test("test_a_report_with_no_target_omits_the_target_line", () => {
  const withTarget = probeRep({ target: { summary: "zztarget summary" } });
  assert.equal(count(probeRep()), count(withTarget) - 1);
});

// 31 as the low corner, not 25: the default probe metric prints hz 2500, which
// spells 25. 31 is spelled by nothing this report prints — not 512, 19000,
// 48000, 17, 2500, 2.5, -3.5, 440 or the process string's 777/1/6.
test("test_a_report_carrying_limits_states_the_grid_point_count_and_its_frequency_span", () => {
  const limits = { grid: { points: 512, f_lo_hz: 31, f_hi_hz: 19000 }, not_modelled: [] };
  assert.ok(...mentionsAll(probeRep({ limits }), [512, 31, 19000]));
});

test("test_a_report_carrying_limits_states_how_many_responses_were_not_modeled", () => {
  const not_modelled = Array.from({ length: 11 }, (_, i) => `zzunmodelled-${i}`);
  const limits = { grid: { points: 512, f_lo_hz: 25, f_hi_hz: 19000 }, not_modelled };
  assert.ok(...mentionsAll(probeRep({ limits }), [11]));
});

test("test_a_report_with_no_limits_omits_the_limits_line", () => {
  const grid = { points: 512, f_lo_hz: 25, f_hi_hz: 19000 };
  const one = probeRep({ limits: { grid, not_modelled: ["zzunmodelled-a"] } });
  const two = probeRep({ limits: { grid, not_modelled: ["zzunmodelled-a", "zzunmodelled-b"] } });
  assert.ok(...sectionOmitted(probeRep(), one, two));
});

// --- a probe job --------------------------------------------------------------

test("test_a_probe_reports_the_preamp_in_db", () => {
  assert.ok(...mentionsAll(probeRep(), [-3.5]));
});

test("test_a_probe_prints_one_extrema_row_per_extremum", () => {
  const extrema = [
    { kind: "zenith", hz: 2500, db: 6.5 },
    { kind: "zenith", hz: 6300, db: 4.5 },
    { kind: "zenith", hz: 400, db: 9.5 },
  ];
  assert.equal(rowsWith(show(rep("probe", probeBody({ extrema }))), "zenith"), 3);
});

test("test_an_extrema_row_carries_its_kind_frequency_and_level", () => {
  const extrema = [{ kind: "zenith", hz: 6300, db: 9.5 }];
  assert.ok(...mentionsAll(lineWith(show(rep("probe", probeBody({ extrema }))), "zenith"), [6300, 9.5]));
});

test("test_a_probe_prints_one_metric_row_per_metric", () => {
  const metrics = { zzalpha: { value: 2.5 }, zzbeta: { value: 4.5 }, zzgamma: { value: 6.5 } };
  assert.equal(rowsWith(show(rep("probe", probeBody({ metrics }))), "zz"), 3);
});

test("test_a_metric_row_carries_its_value", () => {
  const metrics = { zzalpha: { value: 9.5 } };
  assert.ok(...mentionsAll(lineWith(show(rep("probe", probeBody({ metrics }))), "zzalpha"), [9.5]));
});

test("test_a_metric_with_no_frequency_leaves_the_frequency_column_empty", () => {
  const metrics = { zzalpha: { value: 2.5, hz: 6300 }, zzbeta: { value: 4.5 } };
  const out = show(rep("probe", probeBody({ metrics })));
  assert.equal(tokens(lineWith(out, "zzalpha")).length, tokens(lineWith(out, "zzbeta")).length + 1);
});

/**
 * A probe over one note, asked for the given harmonics — read back through the
 * note row's own label, so no column heading has to be known.
 *
 * @param {Record<string, unknown>[]} harmonics
 * @returns {string}
 */
const noteRow = (harmonics) => rowLabeled(show(rep("probe", probeBody({ notes: [{ ...NOTE_DB, harmonics }] }))), "A4");

test("test_a_note_table_carries_one_column_per_harmonic", () => {
  const one = noteRow([{ n: 1, hz: 440, db: 6.5 }]);
  const two = noteRow([
    { n: 1, hz: 440, db: 6.5 },
    { n: 4, hz: 1760, db: 4.5 },
  ]);
  assert.equal(tokens(two).length, tokens(one).length + 1);
});

test("test_a_probe_whose_notes_are_null_omits_the_note_table", () => {
  const c4 = { midi: 60, name: "C4", hz: 261.6, harmonics: [{ n: 1, hz: 261.6, db: 4.5 }] };
  const one = show(rep("probe", probeBody({ notes: [NOTE_DB] })));
  const two = show(rep("probe", probeBody({ notes: [NOTE_DB, c4] })));
  assert.ok(...sectionOmitted(show(rep("probe", probeBody({ notes: null }))), one, two));
});

test("test_a_delta_note_table_is_labeled_differently_from_a_plain_db_note_table", () => {
  const scaffold = (/** @type {string} */ text) =>
    lines(text)
      .filter((l) => !l.includes("A4"))
      .join("\n");
  const plain = scaffold(show(rep("probe", probeBody({ notes: [NOTE_DB] }))));
  assert.ok(...differ(plain, scaffold(show(rep("probe", probeBody({ notes: [NOTE_DELTA] }))))));
});

test("test_a_harmonic_that_was_never_measured_prints_as_a_dash", () => {
  const measured = tokens(noteRow([{ n: 1, hz: 440, db: 6.5 }]));
  const unmeasured = tokens(noteRow([{ n: 1, hz: 440, db: null }]));
  assert.deepEqual(
    unmeasured.filter((t, i) => t !== measured[i]),
    ["-"],
  );
});

// --- an evaluate job ----------------------------------------------------------

test("test_an_evaluate_reports_the_preamp_before_and_after", () => {
  assert.ok(...mentionsAll(show(rep("evaluate", evalBody())), [-3.5, -8.5]));
});

test("test_an_evaluate_metric_row_carries_the_before_value_the_after_value_and_the_delta", () => {
  assert.ok(...mentionsAll(lineWith(show(rep("evaluate", evalBody())), "zzalpha"), [2.5, 7.5, 5.5]));
});

test("test_an_evaluate_lists_each_fit_residual_with_its_rmse_deviation_and_range", () => {
  const out = show(rep("evaluate", evalBody({ fit: [FIT] })));
  assert.ok(...mentionsAll(out, [0.4, 1.5, 2500, 19000]));
});

test("test_an_evaluate_whose_fit_is_null_reads_the_same_as_one_whose_fit_is_empty", () => {
  assert.equal(show(rep("evaluate", evalBody({ fit: null }))), show(rep("evaluate", evalBody({ fit: [] }))));
});

test("test_an_evaluate_lists_each_flag_with_its_severity_rule_and_detail", () => {
  const flags = [{ severity: "zzwarn", rule: "zzrule", detail: "zzdetail here" }];
  assert.ok(...includesAll(show(rep("evaluate", evalBody({ flags }))), ["zzwarn", "zzrule", "zzdetail here"]));
});

test("test_an_evaluate_with_no_flags_omits_the_flag_section", () => {
  const one = [{ severity: "zzwarn", rule: "zzrule", detail: "zzdetail one" }];
  const two = [...one, { severity: "zzwarn", rule: "zzrule2", detail: "zzdetail two" }];
  assert.ok(
    ...sectionOmitted(
      show(rep("evaluate", evalBody({ flags: [] }))),
      show(rep("evaluate", evalBody({ flags: one }))),
      show(rep("evaluate", evalBody({ flags: two }))),
    ),
  );
});

test("test_an_evaluate_prints_the_resulting_process_string", () => {
  assert.ok(...includesAll(show(rep("evaluate", evalBody())), [PROCESS_A]));
});
