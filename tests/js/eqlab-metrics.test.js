// Behavioral suite for scripts/eqlab/metrics.js — summed response, preamp,
// metric panels, extrema, curve sums and rounding. Written blind from a spec
// block: no eqlab source was read.
//
// Chains are built with bandToStage (via the shared `band` helper), never by
// hand-assembling stage internals.
//
// Nothing here asserts a -3 dB bandwidth or anything else that depends on
// HQPlayer's unverified peaking-Q convention (FILTER-MATH §7). Centre-frequency
// gain does not depend on it, so that is what the response assertions use.
//
// Split out of the former eqlab.test.js; every test here is unchanged.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/eqlab-metrics.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  sumCurves,
  round,
  preampDb,
  valueAt,
  computeMetrics,
  metricValues,
  extrema,
} from "../../scripts/eqlab/metrics.js";
import { near, below, above, meanOfRange, band, curve } from "./eqlab-helpers.js";

// --- response and preamp -----------------------------------------------------

const FLAT = curve([]);
const PEAK_5 = curve([band(1000, 5, 3)]);

test("test_an_empty_chain_is_flat_at_zero_decibels", () => {
  assert.ok(...near(valueAt(FLAT, 1000), 0, 1e-12));
});

test("test_a_single_peaking_band_puts_its_gain_at_its_centre_frequency", () => {
  assert.ok(...near(valueAt(curve([band(1000, 4, 3)]), 1000), 4));
});

test("test_two_bands_at_the_same_centre_frequency_sum_in_decibels", () => {
  assert.ok(...near(valueAt(curve([band(1000, 3, 2), band(1000, 3, 2)]), 1000), 6));
});

// Two OVERLAPPING boosts, where the three candidate rules separate: the summed
// maximum is ~7 dB, the sum of positive gains is 8 dB, the largest single band
// is 4 dB. Well-separated bands would make all three agree and pin nothing.
const OVERLAP = curve([band(1000, 4, 2), band(1100, 4, 2)]);

test("test_preamp_is_the_negative_of_the_maximum_of_the_summed_curve", () => {
  assert.ok(...near(preampDb(OVERLAP), -Math.max(...OVERLAP.db), 1e-9));
});

test("test_preamp_is_not_the_negative_sum_of_the_positive_gains", () => {
  assert.ok(...above(preampDb(OVERLAP), -8));
});

test("test_preamp_is_not_the_negative_of_the_largest_single_band", () => {
  assert.ok(...below(preampDb(OVERLAP), -4));
});

test("test_partially_cancelling_bands_give_a_preamp_smaller_than_the_largest_band_gain", () => {
  const cancelling = curve([band(1000, 6, 0.7), band(1100, -3, 0.7)]);
  assert.ok(...below(Math.abs(preampDb(cancelling)), 6));
});

// --- metric panels -----------------------------------------------------------

const PANEL_MAX = computeMetrics(PEAK_5, { peak: { kind: "max", range: [500, 2000] } });

test("test_a_max_metric_reports_the_largest_value_inside_its_range", () => {
  assert.ok(...near(PANEL_MAX.peak.value, 5));
});

test("test_a_max_metric_reports_the_frequency_where_the_maximum_occurs", () => {
  assert.ok(...near(PANEL_MAX.peak.hz, 1000, 5));
});

test("test_a_min_metric_reports_the_smallest_value_inside_its_range", () => {
  const panel = computeMetrics(curve([band(1000, -4, 3)]), { dip: { kind: "min", range: [500, 2000] } });
  assert.ok(...near(panel.dip.value, -4));
});

// A broad boost, so the arithmetic mean over the range is several dB and is
// nowhere near the range's min, median, midpoint or zero.
const WIDE = curve([band(1000, 6, 0.7)]);

test("test_a_mean_metric_is_the_arithmetic_mean_of_the_grid_points_inside_its_range", () => {
  const panel = computeMetrics(WIDE, { m: { kind: "mean", range: [500, 2000] } });
  assert.ok(...near(panel.m.value, meanOfRange(WIDE, 500, 2000), 0.02));
});

test("test_an_at_metric_reports_the_response_at_a_single_frequency", () => {
  // Reading taken: the single frequency is carried as `f`, as everywhere else
  // in the pipeline grammar. The spec names the kind but not the field.
  const panel = computeMetrics(PEAK_5, { spot: { kind: "at", f: 1000 } });
  assert.ok(...near(panel.spot.value, valueAt(PEAK_5, 1000), 1e-9));
});

test("test_an_expr_metric_can_read_the_curve_at_a_frequency", () => {
  const panel = computeMetrics(PEAK_5, { e: { kind: "expr", expr: "at(1000)" } });
  assert.ok(...near(panel.e.value, valueAt(PEAK_5, 1000), 1e-9));
});

test("test_an_expr_metric_can_take_the_maximum_over_a_range", () => {
  const panel = computeMetrics(PEAK_5, { e: { kind: "expr", expr: "max(500, 2000)" } });
  assert.ok(...near(panel.e.value, 5));
});

test("test_an_expr_metric_can_take_the_minimum_over_a_range", () => {
  const panel = computeMetrics(WIDE, {
    floor: { kind: "min", range: [500, 2000] },
    e: { kind: "expr", expr: "min(500, 2000)" },
  });
  assert.ok(...near(panel.e.value, panel.floor.value, 1e-9));
});

test("test_an_expr_metric_can_take_the_mean_over_a_range", () => {
  const panel = computeMetrics(WIDE, { e: { kind: "expr", expr: "mean(500, 2000)" } });
  assert.ok(...near(panel.e.value, meanOfRange(WIDE, 500, 2000), 0.02));
});

test("test_an_expr_metric_may_reference_a_metric_declared_before_it", () => {
  const panel = computeMetrics(PEAK_5, {
    peak: { kind: "max", range: [500, 2000] },
    headroom: { kind: "expr", expr: "peak - 1" },
  });
  assert.ok(...near(panel.headroom.value, 4));
});

test("test_an_expr_metric_referencing_a_metric_declared_after_it_is_rejected", () => {
  assert.throws(() =>
    computeMetrics(PEAK_5, {
      headroom: { kind: "expr", expr: "peak - 1" },
      peak: { kind: "max", range: [500, 2000] },
    }),
  );
});

test("test_an_unknown_metric_kind_names_the_metric_in_the_error", () => {
  assert.throws(() => computeMetrics(PEAK_5, { tilt: { kind: "wibble", range: [500, 2000] } }), /tilt/);
});

test("test_a_range_containing_no_grid_point_is_rejected", () => {
  assert.throws(() => computeMetrics(PEAK_5, { hair: { kind: "max", range: [1000.0001, 1000.0002] } }));
});

test("test_a_panel_flattens_to_plain_metric_values", () => {
  const panel = computeMetrics(PEAK_5, {
    peak: { kind: "max", range: [500, 2000] },
    floor: { kind: "min", range: [500, 2000] },
  });
  assert.deepEqual(metricValues(panel), { peak: panel.peak.value, floor: panel.floor.value });
});

// --- extrema, sums, rounding -------------------------------------------------

test("test_a_peaking_bands_local_maximum_appears_at_its_centre_frequency", () => {
  const top = extrema(PEAK_5).find((e) => e.kind === "max");
  assert.ok(...near(top.hz, 1000, 5));
});

test("test_a_local_maximum_carries_the_decibel_value_of_the_summed_curve", () => {
  const top = extrema(PEAK_5).find((e) => e.kind === "max");
  assert.ok(...near(top.db, 5));
});

test("test_a_cut_bands_local_minimum_appears_at_its_centre_frequency", () => {
  const dip = extrema(curve([band(1000, -5, 3)])).find((e) => e.kind === "min");
  assert.ok(...near(dip.hz, 1000, 5));
});

test("test_a_local_minimum_carries_the_decibel_value_of_the_summed_curve", () => {
  const dip = extrema(curve([band(1000, -5, 3)])).find((e) => e.kind === "min");
  assert.ok(...near(dip.db, -5));
});

test("test_extrema_always_include_exactly_two_edge_entries", () => {
  assert.equal(
    extrema(curve([band(1000, 5, 3), band(100, 4, 0.7, "lshelf")])).filter((e) => e.kind === "edge").length,
    2,
  );
});

test("test_the_lower_edge_entry_sits_at_twenty_hertz", () => {
  const edges = extrema(PEAK_5)
    .filter((e) => e.kind === "edge")
    .map((e) => e.hz)
    .sort((a, b) => a - b);
  assert.ok(...near(edges[0], 20, 1e-6));
});

test("test_the_upper_edge_entry_sits_at_twenty_kilohertz", () => {
  const edges = extrema(PEAK_5)
    .filter((e) => e.kind === "edge")
    .map((e) => e.hz)
    .sort((a, b) => a - b);
  assert.ok(...near(edges[1], 20000, 1e-6));
});

test("test_summing_a_curve_with_itself_doubles_its_decibels_everywhere", () => {
  const doubled = sumCurves(PEAK_5, PEAK_5);
  const worst = doubled.db.reduce((acc, v, i) => Math.max(acc, Math.abs(v - 2 * PEAK_5.db[i])), 0);
  assert.ok(...below(worst, 1e-9));
});

test("test_round_trims_to_the_requested_decimal_places", () => {
  assert.equal(round(1.23456, 2), 1.23);
});

test("test_round_of_null_is_null", () => {
  assert.equal(round(null), null);
});
