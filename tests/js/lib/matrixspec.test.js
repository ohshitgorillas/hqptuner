// Behavioral suite for lib/matrixspec.js — the pipeline `process` chain
// parser/serializer. Written BEFORE the complexity refactor of validateStage
// and stageLabel; not one case may change when those functions are split.
//
// Policy (docs/testing.md): public API only, one assertion per test, no case
// targets a private helper. The refactor's whole purpose is to create private
// per-kind validators/labellers — they are covered exclusively through the two
// public functions, which is what makes these tests survive it.
//
// Assertion style, chosen deliberately:
//   validateStage returns user-facing strings. Clean cases assert the issue
//   COUNT; invalid cases assert an issue MENTIONS the offending token. Both
//   survive rewording. stageLabel is asserted exactly — the label is the whole
//   return value, so a changed separator IS a changed label.
//
// Run: make test-js  (node rejects a bare directory argument to --test, and the
// runner needs tests/js/vendor-resolve.js preloaded for the importmap specifiers)

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseProcess,
  serializeProcess,
  withoutEq,
  validateStage,
  newStage,
  editedStage,
  stageLabel,
} from "../../../hqptuner/static/lib/matrixspec.js";

// Build a stage the way a caller does — through the parser — rather than
// hand-constructing the object, so these never pin the internal shape.
const stage = (s) => parseProcess(s)[0];
const issues = (s) => validateStage(stage(s));
// Returns [ok, message] for spreading into ONE assert.ok at the call site. A
// helper that performs the assertion itself hides it from the reader and from
// the one-assertion gate, so the assert stays where it fires.
const mentions = (list, token) => [
  list.some((i) => i.includes(token)),
  `expected an issue mentioning "${token}", got ${JSON.stringify(list)}`,
];

// --- round-trip: the documented contract (matrix-spec §4) --------------------
// Real strings the app itself produces (xfeed.js / binaural.js compilers), the
// daemon fixtures in tests/test_matrix_read.py, and the stage-editor placeholder.

const ROUND_TRIP = [
  "iir:type=peak;f=1000;q=1;g=-3,impulse.wav",
  'iir:type=peak;f=1000;q=1;g=-3,"a & b".wav',
  "iir:type=hshelf;f=1200.0;q=0.707;g=-1.80,iir:type=hshelf;f=6000.0;q=0.707;g=1.20",
  "iir:type=lp1;f=1234.5",
  "iir:type=biquad;b0=1;b1=0;b2=0;a0=1;a1=0;a2=0",
  "delay:t=0.000271000",
  "riaa",
  "impulse.wav",
  "iir:type=lp1;f=100,delay:t=0.0003,riaa,filter.wav",
  " iir:type=peak;f=1000;q=1;g=-3 ",
];

for (const s of ROUND_TRIP) {
  test(`test_chain_round_trips_byte_identical: ${s}`, () => {
    assert.equal(serializeProcess(parseProcess(s)), s);
  });
}

test("test_empty_string_parses_to_no_stages", () => {
  assert.equal(parseProcess("").length, 0);
});

test("test_whitespace_only_string_parses_to_no_stages", () => {
  assert.equal(parseProcess("   ").length, 0);
});

test("test_two_stage_chain_yields_two_stages", () => {
  assert.equal(parseProcess("iir:type=lp1;f=100,impulse.wav").length, 2);
});

// --- classification ---------------------------------------------------------

test("test_bare_plugin_name_with_no_args_is_a_plugin_stage", () => {
  assert.equal(stage("riaa").kind, "riaa");
});

test("test_space_padded_plugin_name_is_a_plugin_stage", () => {
  assert.equal(stage(" riaa ").kind, "riaa");
});

test("test_filename_stage_is_classified_as_convolution", () => {
  assert.equal(stage("impulse.wav").kind, "conv");
});

test("test_unrecognized_plugin_name_is_classified_as_convolution", () => {
  assert.equal(stage("reverb:mix=0.3").kind, "conv");
});

test("test_plugin_classification_is_case_sensitive", () => {
  assert.equal(stage("IIR:type=peak;f=100").kind, "conv");
});

// --- argument parsing -------------------------------------------------------

test("test_argument_without_a_value_parses_to_empty_string", () => {
  assert.equal(stage("riaa:subsonic").args.subsonic, "");
});

test("test_argument_value_containing_an_equals_sign_keeps_the_remainder", () => {
  assert.equal(stage("iir:type=peak;note=a=b").args.note, "a=b");
});

// --- validateStage: convolution ---------------------------------------------

test("test_convolution_stage_with_a_filename_is_clean", () => {
  assert.equal(issues("impulse.wav").length, 0);
});

test("test_convolution_stage_with_no_file_reports_an_issue", () => {
  assert.equal(validateStage(newStage("conv")).length, 1);
});

test("test_convolution_stage_with_a_whitespace_only_file_reports_an_issue", () => {
  assert.equal(validateStage(editedStage(newStage("conv"), { file: "   " })).length, 1);
});

// --- validateStage: riaa ----------------------------------------------------

for (const v of ["0", "1"]) {
  test(`test_riaa_with_subsonic_${v}_is_clean`, () => {
    assert.equal(issues(`riaa:subsonic=${v}`).length, 0);
  });
}

test("test_riaa_with_no_arguments_is_clean", () => {
  assert.equal(issues("riaa").length, 0);
});

test("test_riaa_with_an_out_of_domain_subsonic_reports_subsonic", () => {
  assert.ok(...mentions(issues("riaa:subsonic=2"), "subsonic"));
});

test("test_riaa_with_an_unknown_argument_names_that_argument", () => {
  assert.ok(...mentions(issues("riaa:tilt=1"), "tilt"));
});

// --- validateStage: delay ---------------------------------------------------

for (const k of ["s", "t", "d"]) {
  test(`test_delay_with_${k}_is_clean`, () => {
    assert.equal(issues(`delay:${k}=0.5`).length, 0);
  });
}

test("test_delay_with_only_v_still_needs_a_delay_quantity", () => {
  // v is a KNOWN delay argument that does not satisfy the s/t/d requirement —
  // guards a refactor that collapses "known arg" into "satisfies requirement".
  assert.equal(issues("delay:v=343.956").length, 1);
});

test("test_delay_with_no_arguments_reports_an_issue", () => {
  assert.equal(issues("delay").length, 1);
});

test("test_delay_with_an_unknown_argument_names_that_argument", () => {
  assert.ok(...mentions(issues("delay:t=0.5;wow=1"), "wow"));
});

test("test_delay_with_a_non_numeric_value_names_that_argument", () => {
  assert.ok(...mentions(issues("delay:t=abc"), "t"));
});

// --- validateStage: iir -----------------------------------------------------

test("test_iir_peak_with_frequency_gain_and_q_is_clean", () => {
  assert.equal(issues("iir:type=peak;f=1000;q=1;g=-3").length, 0);
});

test("test_iir_with_no_type_reports_an_issue", () => {
  assert.equal(issues("iir:f=1000").length, 1);
});

test("test_iir_with_an_unknown_type_names_that_type", () => {
  assert.ok(...mentions(issues("iir:type=bandstop;f=1000"), "bandstop"));
});

for (const k of ["q", "s"]) {
  test(`test_iir_lowpass_accepts_${k}_from_its_one_of_group`, () => {
    assert.equal(issues(`iir:type=lp;f=1000;${k}=1`).length, 0);
  });
}

test("test_iir_lowpass_without_any_one_of_argument_reports_an_issue", () => {
  assert.equal(issues("iir:type=lp;f=1000").length, 1);
});

test("test_iir_lowpass_with_two_one_of_arguments_reports_an_issue", () => {
  assert.equal(issues("iir:type=lp;f=1000;q=1;s=1").length, 1);
});

test("test_iir_lowpass_rejects_bandwidth_which_belongs_to_other_types", () => {
  // bw is legal for peak/bp/ap/notch but not lp — pins the PER-TYPE one-of
  // group against a refactor that hoists one shared known-argument set.
  assert.ok(...mentions(issues("iir:type=lp;f=1000;bw=2"), "bw"));
});

test("test_iir_peak_accepts_bandwidth_from_its_one_of_group", () => {
  assert.equal(issues("iir:type=peak;f=1000;bw=2;g=-3").length, 0);
});

test("test_iir_peak_missing_its_required_gain_names_gain", () => {
  assert.ok(...mentions(issues("iir:type=peak;f=1000;q=1"), "g"));
});

test("test_iir_with_a_non_numeric_frequency_names_frequency", () => {
  assert.ok(...mentions(issues("iir:type=peak;f=abc;q=1;g=0"), "f"));
});

test("test_iir_biquad_with_all_six_coefficients_is_clean", () => {
  assert.equal(issues("iir:type=biquad;b0=1;b1=0;b2=0;a0=1;a1=0;a2=0").length, 0);
});

test("test_iir_biquad_missing_a_coefficient_names_it", () => {
  assert.ok(...mentions(issues("iir:type=biquad;b0=1;b1=0;b2=0;a0=1;a1=0"), "a2"));
});

test("test_iir_biquad_needs_no_one_of_argument", () => {
  // biquad declares no one-of group; guards a refactor that applies it blindly.
  assert.equal(issues("iir:type=biquad;b0=1;b1=0;b2=0;a0=1;a1=0;a2=0").length, 0);
});

// --- validateStage: numeric format ------------------------------------------

for (const v of ["-3.5", "1e3", "1E-3", "42"]) {
  test(`test_numeric_argument_accepts_${v}`, () => {
    assert.equal(issues(`iir:type=lp1;f=${v}`).length, 0);
  });
}

for (const v of ["abc", ".5", "1.", "1e"]) {
  test(`test_numeric_argument_rejects_${v}`, () => {
    assert.ok(...mentions(issues(`iir:type=lp1;f=${v}`), "f"));
  });
}

// A comma is the STAGE separator, so a decimal comma is unrepresentable: it
// splits the chain rather than yielding an invalid argument.
test("test_a_comma_in_an_argument_value_splits_the_chain_into_two_stages", () => {
  assert.equal(parseProcess("iir:type=lp1;f=1,5").length, 2);
});

// --- newStage ---------------------------------------------------------------

for (const kind of ["iir", "delay", "riaa"]) {
  test(`test_a_fresh_${kind}_stage_validates_clean`, () => {
    assert.equal(validateStage(newStage(kind)).length, 0);
  });
}

// A fresh convolution stage is deliberately a DRAFT with no file yet, so unlike
// the other kinds it reports rather than validating clean.
test("test_a_fresh_convolution_stage_reports_its_missing_file", () => {
  assert.ok(...mentions(validateStage(newStage("conv")), "file"));
});

// --- editedStage ------------------------------------------------------------

test("test_editing_an_argument_is_reflected_in_the_serialized_chain", () => {
  const edited = editedStage(stage("iir:type=peak;f=1000;q=1;g=-3"), { f: "2000" });
  assert.equal(serializeProcess([edited]), "iir:type=peak;f=2000;q=1;g=-3");
});

test("test_clearing_an_argument_removes_it_from_the_serialized_chain", () => {
  const edited = editedStage(stage("iir:type=peak;f=1000;q=1;g=-3"), { g: "" });
  assert.equal(serializeProcess([edited]), "iir:type=peak;f=1000;q=1");
});

test("test_edited_iir_arguments_serialize_in_canonical_order", () => {
  const edited = editedStage(stage("iir:type=peak;g=-3;q=1;f=1000"), {});
  assert.equal(serializeProcess([edited]), "iir:type=peak;f=1000;q=1;g=-3");
});

test("test_editing_a_convolution_file_is_reflected_in_the_serialized_chain", () => {
  const edited = editedStage(stage("old.wav"), { file: "new.wav" });
  assert.equal(serializeProcess([edited]), "new.wav");
});

// --- withoutEq --------------------------------------------------------------

test("test_withoutEq_keeps_non_eq_stages_in_order", () => {
  assert.equal(withoutEq("iir:type=lp1;f=100,delay:t=0.0003,riaa,filter.wav"), "delay:t=0.0003,riaa,filter.wav");
});

test("test_withoutEq_on_an_all_eq_chain_yields_an_empty_chain", () => {
  assert.equal(withoutEq("iir:type=lp1;f=100,iir:type=peak;f=1000;q=1;g=-3"), "");
});

// --- stageLabel -------------------------------------------------------------

test("test_convolution_label_is_the_basename_of_a_path", () => {
  assert.equal(stageLabel(stage("data/impulses/room.wav")), "room.wav");
});

test("test_convolution_label_of_a_bare_filename_is_that_filename", () => {
  assert.equal(stageLabel(stage("impulse.wav")), "impulse.wav");
});

test("test_convolution_label_falls_back_to_the_whole_path_when_it_has_no_basename", () => {
  assert.equal(stageLabel(stage("impulses/")), "impulses/");
});

test("test_iir_label_carries_type_frequency_and_gain", () => {
  assert.equal(stageLabel(stage("iir:type=peak;f=1000;q=1;g=-3")), "peak · 1000 Hz · -3 dB");
});

test("test_iir_label_omits_gain_when_the_stage_has_none", () => {
  assert.equal(stageLabel(stage("iir:type=lp1;f=100")), "lp1 · 100 Hz");
});

test("test_iir_label_without_a_type_reads_as_iir", () => {
  assert.equal(stageLabel(stage("iir:f=100")), "iir · 100 Hz");
});

test("test_iir_label_of_a_biquad_is_the_type_alone", () => {
  assert.equal(stageLabel(stage("iir:type=biquad;b0=1;b1=0;b2=0;a0=1;a1=0;a2=0")), "biquad");
});

test("test_delay_label_in_seconds", () => {
  assert.equal(stageLabel(stage("delay:t=0.0003")), "delay · 0.0003 s");
});

test("test_delay_label_in_samples", () => {
  assert.equal(stageLabel(stage("delay:s=16")), "delay · 16 smp");
});

test("test_delay_label_in_metres", () => {
  assert.equal(stageLabel(stage("delay:d=0.15")), "delay · 0.15 m");
});

test("test_delay_label_prefers_seconds_over_samples", () => {
  assert.equal(stageLabel(stage("delay:s=16;t=0.0003")), "delay · 0.0003 s");
});

test("test_delay_label_with_only_a_speed_argument_is_bare", () => {
  // v sets the speed of sound for d= conversion; it is not itself a quantity.
  assert.equal(stageLabel(stage("delay:v=343.956")), "delay");
});

test("test_riaa_label_is_the_kind", () => {
  assert.equal(stageLabel(stage("riaa")), "riaa");
});
