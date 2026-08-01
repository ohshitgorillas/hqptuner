// Behavioral suite for scripts/eqlab/metrics.js — target-relative metric
// kinds, shape metric kinds and metric presets. Written blind from a spec
// block: no eqlab source was read. Test numbers in comments refer to the spec
// block's behaviour list.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/eqlab-shape-metrics.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { computeMetrics, resolveMetricSpecs } from "../../../scripts/eqlab/metrics.js";
import { resolveTarget } from "../../../scripts/eqlab/target.js";
import { FS, near, above, band, curve } from "../support/eqlab-helpers.js";

const FLAT = curve([]);

const flatTarget = async (db = 0) => (await resolveTarget({ from: "flat", db, align: "none" }, FLAT, FS)).curve;

// --- target-relative kinds ---------------------------------------------------

// 25
test("test_a_target_relative_kind_without_a_target_is_rejected", () => {
  assert.throws(
    () => computeMetrics(FLAT, { dev: { kind: "rmse", range: [100, 1000] } }),
    /rmse[\s\S]*target|target[\s\S]*rmse/i,
  );
});

// 26 — flat curve vs flat target at −2: constant +2 deviation.
test("test_rmse_of_a_constant_deviation_is_that_deviation", async () => {
  const m = computeMetrics(FLAT, { dev: { kind: "rmse", range: [100, 1000] } }, await flatTarget(-2));
  assert.ok(...near(m.dev.value, 2, 0.05));
});

// 27 — flat curve vs flat target at +3: deviation −3, maxdev is absolute.
test("test_maxdev_reports_the_absolute_worst_deviation", async () => {
  const m = computeMetrics(FLAT, { dev: { kind: "maxdev", range: [100, 1000] } }, await flatTarget(3));
  assert.ok(...near(m.dev.value, 3, 0.05));
});

// 27 — the deviation is localized at the band's centre, so the reported hz
// must land there, not just exist.
test("test_maxdev_reports_the_frequency_of_the_worst_deviation", async () => {
  const peaked = curve([band(1000, 3, 1)]);
  const m = computeMetrics(peaked, { dev: { kind: "maxdev", range: [100, 10000] } }, await flatTarget(0));
  assert.ok(...near(m.dev.hz, 1000, 100));
});

// 28
test("test_maxdev_signed_keeps_the_sign_of_the_worst_deviation", async () => {
  const specs = { dev: { kind: "maxdev_signed", range: [100, 1000] } };
  const m = computeMetrics(FLAT, specs, await flatTarget(3));
  assert.ok(...near(m.dev.value, -3, 0.05));
});

// 29
test("test_mean_signed_of_a_constant_deviation_is_that_deviation", async () => {
  const specs = { dev: { kind: "mean_signed", range: [100, 1000] } };
  const m = computeMetrics(FLAT, specs, await flatTarget(-2));
  assert.ok(...near(m.dev.value, 2, 0.05));
});

// 30 — deviation concentrated above 10 kHz: ERBs per octave rise with
// frequency, so ERB-rate weighting up-weights the top octaves and the
// ERB-domain mean comes out larger than the log-domain one.
test("test_erb_domain_upweights_deviation_in_the_top_octaves", async () => {
  const peaked = curve([band(16000, 6, 2)]);
  const target = await flatTarget(0);
  const erb = computeMetrics(peaked, { d: { kind: "mean_signed", range: [20, 20000], domain: "erb" } }, target);
  const log = computeMetrics(peaked, { d: { kind: "mean_signed", range: [20, 20000], domain: "log" } }, target);
  assert.ok(...above(erb.d.value, log.d.value));
});

// 31
test("test_an_unknown_domain_is_rejected", async () => {
  const specs = { d: { kind: "mean_signed", range: [20, 20000], domain: "banana" } };
  const target = await flatTarget(0);
  assert.throws(() => computeMetrics(FLAT, specs, target));
});

// --- shape kinds -------------------------------------------------------------

// 32 — a +3 peak at 500 Hz riding a +4 plateau (lshelf below 2 kHz): `max`
// reads plateau+peak, `prominence` reads only the peak's height above it.
const PLATEAU_PEAK = curve([band(2000, 4, 1, "lshelf"), band(500, 3, 8)]);

test("test_max_over_a_raised_plateau_reads_plateau_plus_peak", () => {
  const m = computeMetrics(PLATEAU_PEAK, { mx: { kind: "max", range: [250, 1000] } });
  assert.ok(...near(m.mx.value, 7, 0.5));
});

// 32
test("test_prominence_reads_the_peaks_height_above_its_plateau", () => {
  const m = computeMetrics(PLATEAU_PEAK, { p: { kind: "prominence", range: [250, 1000] } });
  assert.ok(...near(m.p.value, 3, 0.5));
});

// 32
test("test_prominence_reports_the_peaks_frequency", () => {
  const m = computeMetrics(PLATEAU_PEAK, { p: { kind: "prominence", range: [250, 1000] } });
  assert.ok(...near(m.p.hz, 500, 50));
});

// 33
test("test_ripple_of_a_flat_chain_is_zero", () => {
  const m = computeMetrics(FLAT, { r: { kind: "ripple", range: [100, 2000] } });
  assert.ok(...near(m.r.value, 0, 0.001));
});

// 33
test("test_ripple_with_a_peak_inside_the_range_is_positive", () => {
  const m = computeMetrics(curve([band(500, 3, 2)]), { r: { kind: "ripple", range: [100, 2000] } });
  assert.ok(...above(m.r.value, 0.5));
});

// 34
test("test_slope_of_a_flat_chain_is_zero", () => {
  const m = computeMetrics(FLAT, { s: { kind: "slope", range: [200, 5000] } });
  assert.ok(...near(m.s.value, 0, 0.01));
});

// 34
test("test_slope_of_a_rising_chain_is_positive", () => {
  const rising = curve([band(1000, 6, 1, "hshelf")]);
  const m = computeMetrics(rising, { s: { kind: "slope", range: [200, 5000] } });
  assert.ok(...above(m.s.value, 0));
});

// 35
test("test_note_spread_of_a_flat_chain_is_zero", () => {
  const m = computeMetrics(FLAT, { n: { kind: "note_spread", from: "A2", to: "G4" } });
  assert.ok(...near(m.n.value, 0, 1e-6));
});

// 35 — 220 Hz is A3, inside A2–G4.
test("test_note_spread_with_a_peak_inside_the_note_range_is_positive", () => {
  const m = computeMetrics(curve([band(220, 4, 4)]), { n: { kind: "note_spread", from: "A2", to: "G4" } });
  assert.ok(...above(m.n.value, 0));
});

// --- presets -----------------------------------------------------------------

const STANDARD_KEYS = [
  "bass_50_150",
  "oomph_80_160",
  "mud_200_400",
  "mid_400_1500",
  "treble_4k_10k",
  "v_db",
  "ripple_150_1000",
  "spread_A2_G4",
];

// 36
test("test_the_standard_preset_carries_exactly_its_documented_keys", () => {
  assert.deepEqual(Object.keys(resolveMetricSpecs("standard")).sort(), [...STANDARD_KEYS].sort());
});

// 37
test("test_a_preset_with_extras_carries_the_preset_keys_plus_the_extras", () => {
  const specs = resolveMetricSpecs({ preset: "standard", extra: { kind: "max", range: [100, 200] } });
  assert.deepEqual(Object.keys(specs).sort(), [...STANDARD_KEYS, "extra"].sort());
});

// 37 — the extra spec passes through verbatim, not just as a key.
test("test_a_presets_extra_spec_passes_through_verbatim", () => {
  const specs = resolveMetricSpecs({ preset: "standard", extra: { kind: "max", range: [100, 200] } });
  assert.deepEqual(specs.extra, { kind: "max", range: [100, 200] });
});

// 38
test("test_an_unknown_preset_is_rejected_by_name", () => {
  assert.throws(() => resolveMetricSpecs("nope"), /nope/);
});

// 39
test("test_a_plain_specs_object_passes_through_unchanged", () => {
  const plain = { plain: { kind: "mean", range: [100, 200] } };
  assert.deepEqual(resolveMetricSpecs(plain), { plain: { kind: "mean", range: [100, 200] } });
});

// 40
test("test_the_standard_panel_computes_without_a_target", () => {
  const m = computeMetrics(curve([band(1000, 3, 1)]), resolveMetricSpecs("standard"));
  assert.equal(typeof m.bass_50_150.value, "number");
});
