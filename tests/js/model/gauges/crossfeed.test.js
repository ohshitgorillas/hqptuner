// Behavioral suite: the name a crossfeed mode shows, the Bauer preset a stored value names, and the Structural preset
// a speaker angle and center character land on, exactly or within a tolerance; the corner a Bauer line installs, the
// values each folded line summarizes, what the Bauer response plot draws, which fields the drawer leaves enabled, the
// listening-geometry coordinates of the top-down view, and its readouts.
//
// Every expected number is a row the test writes. The geometry rows use the view's own frame as the contract: the head
// centred at (200, 140), the speakers on a 112 radius, ticks from 96 to 128 at ±30°, the angle arc on a 40 radius and
// its label on a 54 radius, the head radius 15 at a 6.5 cm radius or less, 25 at 10.5 cm or more, 2.5 per cm between.
// sin 30° is 0.5 and cos 30° is 0.8660254037844386. The far-path tangency rows assert relations (the tangent point on
// the head circle, its radius square to the path) rather than a coordinate.

import test from "node:test";
import assert from "node:assert/strict";

import {
  bauerCorner,
  bauerPlot,
  bauerPreset,
  bauerSummary,
  crossfeedGray,
  geometryReadouts,
  listeningGeometry,
  modeName,
  structuralPreset,
  structuralSummary,
} from "../../../../hqptuner/static/model/gauges/crossfeed.js";
import { near } from "../../support/near.js";

//: Tolerance for coordinates the float arithmetic may round in the last places.
const EPS = 1e-9;

//: Modes the test writes, each named by a number.
const MODES = [
  { v: "off", label: 10 },
  { v: "bauer", label: 20 },
  { v: "structural", label: 30 },
];

//: Bauer presets the test writes.
const BAUER = [
  { v: "default", n: 1 },
  { v: "cmoy", n: 2 },
];

//: Bauer presets the test writes, each named by a number.
const BAUER_NAMED = [
  { v: "default", label: 1 },
  { v: "cmoy", label: 2 },
];

//: The corner each Bauer preset installs, [frequency, level], as the test writes them.
/** @type {Record<string, [number, number]>} */
const CORNERS = { default: [700, 4.5], cmoy: [650, 9] };

//: Structural presets the test writes: two share an angle, two share a center character.
const STRUCTURAL = [
  { v: "a", angle: 30, lambda: 0.7 },
  { v: "b", angle: 30, lambda: 1 },
  { v: "c", angle: 45, lambda: 0.7 },
];

//: Structural presets the test writes, each named by a number.
const STRUCTURAL_NAMED = [
  { v: "a", label: 100, angle: 30, lambda: 0.7 },
  { v: "b", label: 200, angle: 30, lambda: 1 },
];

//: A tolerance the test writes, wider on the angle than on the center character.
const TOL = { angle: 0.5, lambda: 0.125 };

/**
 * Bauer fields at a preset, with Custom's own values and a compensation.
 *
 * @param {string} preset
 * @param {number} [comp]
 */
const bauer = (preset, comp = 0) => ({ preset, freq: 900, level: 3, comp });

// ── modeName ─────────────────────────────────────────────────────────────

test("test_mode_name_names_a_known_mode", () => {
  assert.equal(modeName(MODES, "bauer"), 20);
});

test("test_mode_name_names_the_off_mode", () => {
  assert.equal(modeName(MODES, "off"), 10);
});

test("test_mode_name_of_an_unknown_mode_is_undefined", () => {
  assert.equal(modeName(MODES, "binaural"), undefined);
});

// ── bauerPreset ──────────────────────────────────────────────────────────

test("test_bauer_preset_finds_the_preset_a_value_names", () => {
  assert.equal(bauerPreset(BAUER, "cmoy"), BAUER[1]);
});

test("test_bauer_preset_of_an_unknown_value_is_undefined", () => {
  assert.equal(bauerPreset(BAUER, "custom"), undefined);
});

// ── structuralPreset ─────────────────────────────────────────────────────

test("test_structural_preset_matches_angle_and_center_exactly", () => {
  assert.equal(structuralPreset(STRUCTURAL, 30, 1), STRUCTURAL[1]);
});

test("test_structural_preset_reads_stored_strings_as_numbers", () => {
  assert.equal(structuralPreset(STRUCTURAL, "45", "0.7"), STRUCTURAL[2]);
});

test("test_structural_preset_without_a_tolerance_misses_a_near_angle", () => {
  assert.equal(structuralPreset(STRUCTURAL, 30.25, 0.7), undefined);
});

test("test_structural_preset_needs_both_values_to_match", () => {
  assert.equal(structuralPreset(STRUCTURAL, 45, 1), undefined);
});

test("test_structural_preset_within_the_tolerance_matches_a_near_angle", () => {
  assert.equal(structuralPreset(STRUCTURAL, 30.25, 0.7, TOL), STRUCTURAL[0]);
});

test("test_structural_preset_within_the_tolerance_matches_a_near_center", () => {
  assert.equal(structuralPreset(STRUCTURAL, 45, 0.75, TOL), STRUCTURAL[2]);
});

test("test_structural_preset_misses_an_angle_at_the_tolerance", () => {
  assert.equal(structuralPreset(STRUCTURAL, 30.5, 0.7, TOL), undefined);
});

test("test_structural_preset_misses_a_center_past_the_tolerance", () => {
  assert.equal(structuralPreset(STRUCTURAL, 45, 0.9, TOL), undefined);
});

// ── bauerCorner ──────────────────────────────────────────────────────────

test("test_bauer_corner_of_custom_is_its_own_frequency_and_level", () => {
  assert.deepEqual(bauerCorner(bauer("custom"), CORNERS), [900, 3]);
});

test("test_bauer_corner_of_a_preset_is_that_presets_row", () => {
  assert.deepEqual(bauerCorner(bauer("cmoy"), CORNERS), [650, 9]);
});

// ── bauerSummary ─────────────────────────────────────────────────────────

test("test_bauer_summary_names_the_picked_preset", () => {
  assert.equal(bauerSummary(bauer("cmoy"), BAUER_NAMED, CORNERS).label, 2);
});

test("test_bauer_summary_of_custom_names_no_preset", () => {
  assert.equal(bauerSummary(bauer("custom"), BAUER_NAMED, CORNERS).label, undefined);
});

test("test_bauer_summary_carries_the_installed_frequency", () => {
  assert.equal(bauerSummary(bauer("default"), BAUER_NAMED, CORNERS).fc, 700);
});

test("test_bauer_summary_carries_the_installed_level", () => {
  assert.equal(bauerSummary(bauer("custom"), BAUER_NAMED, CORNERS).feed, 3);
});

test("test_bauer_summary_rounds_the_compensation_up", () => {
  assert.equal(bauerSummary(bauer("default", 42.6), BAUER_NAMED, CORNERS).comp, 43);
});

test("test_bauer_summary_rounds_the_compensation_down", () => {
  assert.equal(bauerSummary(bauer("default", 42.4), BAUER_NAMED, CORNERS).comp, 42);
});

// ── structuralSummary ────────────────────────────────────────────────────

test("test_structural_summary_names_the_preset_within_the_tolerance", () => {
  const st = { angle: 30.25, circ: 57, lambda: 1 };
  assert.equal(structuralSummary(st, STRUCTURAL_NAMED, TOL).label, 200);
});

test("test_structural_summary_off_every_preset_names_none", () => {
  const st = { angle: 45, circ: 57, lambda: 1 };
  assert.equal(structuralSummary(st, STRUCTURAL_NAMED, TOL).label, undefined);
});

test("test_structural_summary_shows_the_center_character_as_a_whole_percent", () => {
  const st = { angle: 30, circ: 57, lambda: 0.704 };
  assert.equal(structuralSummary(st, STRUCTURAL_NAMED, TOL).lambda, 70);
});

test("test_structural_summary_rounds_the_center_character_percent_up", () => {
  const st = { angle: 30, circ: 57, lambda: 1.006 };
  assert.equal(structuralSummary(st, STRUCTURAL_NAMED, TOL).lambda, 101);
});

test("test_structural_summary_carries_the_speaker_angle", () => {
  const st = { angle: 22.5, circ: 57, lambda: 1 };
  assert.equal(structuralSummary(st, STRUCTURAL_NAMED, TOL).angle, 22.5);
});

test("test_structural_summary_carries_the_head_circumference", () => {
  const st = { angle: 30, circ: 58.25, lambda: 1 };
  assert.equal(structuralSummary(st, STRUCTURAL_NAMED, TOL).circ, 58.25);
});

// ── bauerPlot ────────────────────────────────────────────────────────────

test("test_bauer_plot_draws_the_installed_corner", () => {
  assert.equal(bauerPlot(bauer("cmoy"), CORNERS).fc, 650);
});

test("test_bauer_plot_correction_is_the_compensation_as_a_fraction", () => {
  assert.equal(bauerPlot(bauer("default", 50), CORNERS).k, 0.5);
});

test("test_bauer_plot_correction_past_full_scale_overcorrects", () => {
  assert.equal(bauerPlot(bauer("default", 150), CORNERS).k, 1.5);
});

test("test_bauer_plot_with_compensation_draws_the_uncorrected_ghost", () => {
  assert.equal(bauerPlot(bauer("default", 1), CORNERS).ghost, true);
});

test("test_bauer_plot_without_compensation_draws_no_ghost", () => {
  assert.equal(bauerPlot(bauer("default", 0), CORNERS).ghost, false);
});

test("test_bauer_plot_names_the_compensation_as_a_whole_percent", () => {
  assert.equal(bauerPlot(bauer("default", 49.5), CORNERS).pct, 50);
});

// ── crossfeedGray ────────────────────────────────────────────────────────

/**
 * @typedef {{ name: string, gate: string, preset: string, impl?: string, mxWhy?: string, iir2fir?: string,
 *   field: keyof ReturnType<typeof crossfeedGray>, want: boolean }} GrayRow
 */

/** @type {GrayRow[]} */
const GRAY = [
  { name: "engaged_custom_enables_the_custom_fields", gate: "1", preset: "custom", field: "custom", want: true },
  { name: "engaged_preset_disables_the_custom_fields", gate: "1", preset: "cmoy", field: "custom", want: false },
  { name: "engaged_preset_grays_the_custom_fields", gate: "1", preset: "cmoy", field: "customGrayed", want: true },
  { name: "custom_leaves_the_custom_fields_ungrayed", gate: "1", preset: "custom", field: "customGrayed", want: false },
  { name: "engaged_enables_the_controls", gate: "1", preset: "cmoy", field: "controls", want: true },
  { name: "engaged_leaves_the_lines_ungrayed", gate: "1", preset: "cmoy", field: "linesGrayed", want: false },
  { name: "engaged_is_not_off", gate: "1", preset: "cmoy", field: "off", want: false },
  { name: "bypassed_is_off", gate: "0", preset: "cmoy", field: "off", want: true },
  { name: "bypassed_disables_the_controls", gate: "0", preset: "cmoy", field: "controls", want: false },
  { name: "bypassed_disables_the_custom_fields", gate: "0", preset: "custom", field: "custom", want: false },
  { name: "bypassed_grays_the_lines", gate: "0", preset: "cmoy", field: "linesGrayed", want: true },
  { name: "bypassed_leaves_the_gate_and_pick_live", gate: "0", preset: "cmoy", field: "gate", want: true },
  {
    name: "matrix_bypassed_disables_the_gate_and_pick",
    gate: "1",
    preset: "cmoy",
    mxWhy: "m",
    field: "gate",
    want: false,
  },
  {
    name: "matrix_bypassed_disables_the_controls",
    gate: "1",
    preset: "cmoy",
    mxWhy: "m",
    field: "controls",
    want: false,
  },
  { name: "matrix_bypassed_disables_custom", gate: "1", preset: "custom", mxWhy: "m", field: "custom", want: false },
  { name: "matrix_bypassed_grays_the_whole_block", gate: "1", preset: "cmoy", mxWhy: "m", field: "matrix", want: true },
  { name: "matrix_live_leaves_the_block_ungrayed", gate: "1", preset: "cmoy", field: "matrix", want: false },
  {
    name: "matrix_bypassed_leaves_the_lines_to_the_block",
    gate: "0",
    preset: "cmoy",
    mxWhy: "m",
    field: "linesGrayed",
    want: false,
  },
  {
    name: "structural_under_linear_iir2fir_conflicts",
    gate: "1",
    preset: "cmoy",
    impl: "structural",
    iir2fir: "2",
    field: "conflict",
    want: true,
  },
  {
    name: "bauer_under_linear_iir2fir_does_not_conflict",
    gate: "1",
    preset: "cmoy",
    impl: "bauer",
    iir2fir: "2",
    field: "conflict",
    want: false,
  },
  {
    name: "structural_under_other_iir2fir_does_not_conflict",
    gate: "1",
    preset: "cmoy",
    impl: "structural",
    iir2fir: "0",
    field: "conflict",
    want: false,
  },
];

for (const row of GRAY) {
  test(`test_crossfeed_gray_${row.name}`, () => {
    const st = { gate: row.gate, preset: row.preset, impl: row.impl ?? "bauer" };
    assert.equal(crossfeedGray(st, row.mxWhy ?? "", row.iir2fir ?? "0")[row.field], row.want);
  });
}

// ── listeningGeometry ────────────────────────────────────────────────────

//: A circumference past the 10.5 cm radius ceiling, so the head radius is 25 and the ears sit at 175 and 225.
const BIG_HEAD = 66;

test("test_geometry_cm_radius_is_the_circumference_over_two_pi", () => {
  assert.ok(...near(listeningGeometry(30, 2 * Math.PI * 8).a, 8, EPS));
});

test("test_geometry_head_radius_floors_at_a_small_head", () => {
  assert.equal(listeningGeometry(30, 20).r, 15);
});

test("test_geometry_head_radius_caps_at_a_large_head", () => {
  assert.equal(listeningGeometry(30, BIG_HEAD).r, 25);
});

test("test_geometry_head_radius_grows_two_and_a_half_per_cm_between", () => {
  assert.ok(...near(listeningGeometry(30, 2 * Math.PI * 8.5).r, 20, EPS));
});

test("test_geometry_left_ear_sits_on_the_head_left_edge", () => {
  assert.deepEqual(listeningGeometry(30, BIG_HEAD).earL, [175, 140]);
});

test("test_geometry_right_ear_sits_on_the_head_right_edge", () => {
  assert.deepEqual(listeningGeometry(30, BIG_HEAD).earR, [225, 140]);
});

test("test_geometry_speakers_at_zero_degrees_sit_straight_ahead", () => {
  assert.deepEqual(listeningGeometry(0, BIG_HEAD).speakers[1].p, [200, 28]);
});

test("test_geometry_right_speaker_at_ninety_degrees_sits_beside_the_head", () => {
  assert.ok(...near(listeningGeometry(90, BIG_HEAD).speakers[1].p[0], 312, EPS));
});

test("test_geometry_left_speaker_at_ninety_degrees_sits_beside_the_head", () => {
  assert.ok(...near(listeningGeometry(90, BIG_HEAD).speakers[0].p[0], 88, EPS));
});

test("test_geometry_speaker_at_ninety_degrees_sits_level_with_the_head", () => {
  assert.ok(...near(listeningGeometry(90, BIG_HEAD).speakers[1].p[1], 140, EPS));
});

test("test_geometry_left_speaker_is_toed_in_at_minus_the_angle", () => {
  assert.equal(listeningGeometry(30, BIG_HEAD).speakers[0].d, -30);
});

test("test_geometry_right_speaker_is_toed_in_at_the_angle", () => {
  assert.equal(listeningGeometry(30, BIG_HEAD).speakers[1].d, 30);
});

test("test_geometry_axis_runs_from_the_head_front", () => {
  assert.equal(listeningGeometry(30, BIG_HEAD).axis.y1, 115);
});

test("test_geometry_axis_runs_past_the_speaker_circle", () => {
  assert.equal(listeningGeometry(30, BIG_HEAD).axis.y2, 14);
});

/** @typedef {{ name: string, tick: number, key: "x1" | "y1" | "x2" | "y2", want: number }} TickRow */

/** @type {TickRow[]} */
const TICKS = [
  { name: "left_inner_x", tick: 0, key: "x1", want: 152 },
  { name: "left_inner_y", tick: 0, key: "y1", want: 56.86156123669389 },
  { name: "right_inner_x", tick: 1, key: "x1", want: 248 },
  { name: "right_outer_x", tick: 1, key: "x2", want: 264 },
  { name: "right_outer_y", tick: 1, key: "y2", want: 29.14874831559186 },
];

for (const row of TICKS) {
  test(`test_geometry_reference_tick_${row.name}`, () => {
    assert.ok(...near(listeningGeometry(45, BIG_HEAD).ref[row.tick][row.key], row.want, EPS));
  });
}

test("test_geometry_reference_ticks_stay_put_as_the_angle_moves", () => {
  assert.deepEqual(listeningGeometry(10, BIG_HEAD).ref, listeningGeometry(50, 41).ref);
});

test("test_geometry_angle_arc_starts_straight_ahead", () => {
  assert.deepEqual(listeningGeometry(30, BIG_HEAD).arc.from, [200, 100]);
});

test("test_geometry_angle_arc_ends_at_the_angle", () => {
  assert.ok(...near(listeningGeometry(90, BIG_HEAD).arc.to[0], 240, EPS));
});

test("test_geometry_angle_label_at_zero_sits_straight_ahead", () => {
  assert.deepEqual(listeningGeometry(0, BIG_HEAD).label, [200, 86]);
});

test("test_geometry_angle_label_sits_at_half_the_angle", () => {
  assert.ok(...near(listeningGeometry(60, BIG_HEAD).label[0], 227, EPS));
});

test("test_geometry_left_far_path_leaves_the_left_speaker", () => {
  const g = listeningGeometry(30, BIG_HEAD);
  assert.deepEqual(g.far[0].from, g.speakers[0].p);
});

test("test_geometry_left_far_path_reaches_the_right_ear", () => {
  assert.deepEqual(listeningGeometry(30, BIG_HEAD).far[0].to, [225, 140]);
});

test("test_geometry_right_far_path_reaches_the_left_ear", () => {
  assert.deepEqual(listeningGeometry(30, BIG_HEAD).far[1].to, [175, 140]);
});

test("test_geometry_left_far_path_sweeps_clockwise", () => {
  assert.equal(listeningGeometry(30, BIG_HEAD).far[0].sweep, 1);
});

test("test_geometry_right_far_path_sweeps_counterclockwise", () => {
  assert.equal(listeningGeometry(30, BIG_HEAD).far[1].sweep, 0);
});

test("test_geometry_far_path_meets_the_head_on_its_circle", () => {
  const [x, y] = listeningGeometry(30, BIG_HEAD).far[0].via;
  assert.ok(...near(Math.hypot(x - 200, y - 140), 25, EPS));
});

test("test_geometry_far_path_meets_the_head_at_a_tangent", () => {
  const { from, via } = listeningGeometry(30, BIG_HEAD).far[1];
  assert.ok(...near((via[0] - 200) * (from[0] - via[0]) + (via[1] - 140) * (from[1] - via[1]), 0, EPS));
});

test("test_geometry_far_path_wraps_over_the_front_of_the_head", () => {
  assert.ok(listeningGeometry(30, BIG_HEAD).far[0].via[1] < 140);
});

// ── geometryReadouts ─────────────────────────────────────────────────────

//: Path parameters the test writes: a 500 µs ray delay, 150 µs more group delay on the far path than the near one,
//: the far ear at a tenth (−20 dB), and the two ears averaging 10.
const PATH = { an: 19.9, af: 0.1, itd: 0.0005, gdN: 0.0001, gdF: 0.00025 };

//: As PATH, but the ears averaging 19 and a 123 µs ray delay.
const PATH_19 = { an: 37.9, af: 0.1, itd: 0.000123, gdN: 0, gdF: 0 };

test("test_readouts_ray_delay_in_whole_microseconds", () => {
  assert.equal(geometryReadouts(PATH, 1).itd, 500);
});

test("test_readouts_ray_delay_follows_the_path", () => {
  assert.equal(geometryReadouts(PATH_19, 1).itd, 123);
});

test("test_readouts_low_frequency_delay_adds_the_group_delay_excess", () => {
  assert.equal(geometryReadouts(PATH, 1).itdLow, 650);
});

test("test_readouts_far_ear_treble_in_db", () => {
  assert.ok(...near(geometryReadouts(PATH, 1).far, -20, EPS));
});

test("test_readouts_center_shift_at_zero_character_is_flat", () => {
  assert.equal(geometryReadouts(PATH, 0).center, 0);
});

test("test_readouts_center_shift_at_full_character_is_the_ear_average", () => {
  assert.ok(...near(geometryReadouts(PATH, 1).center, 20, EPS));
});

test("test_readouts_center_shift_at_half_character_blends_toward_neutral", () => {
  assert.ok(...near(geometryReadouts(PATH_19, 0.5).center, 20, EPS));
});
