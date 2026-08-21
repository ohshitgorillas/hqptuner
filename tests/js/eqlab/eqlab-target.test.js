// Behavioral suite for scripts/eqlab/target.js — target-curve resolution:
// sources, transforms (smooth, tilt, override), and alignment. Written blind
// from a spec block: no eqlab source was read. Test numbers in comments refer
// to the spec block's behavior list.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/eqlab-target.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveTarget } from "../../../scripts/eqlab/target.js";
import { valueAt } from "../../../scripts/eqlab/curve.js";
import { FS, near, below, band, curve } from "../support/eqlab-helpers.js";

/** @typedef {import("../../../scripts/eqlab/target.js").TargetSpec} TargetSpec */
/** @typedef {Awaited<ReturnType<typeof resolveTarget>>} Resolved */

/**
 * `resolveTarget` answers null only for a null spec, which no case here passes
 * except the one that asserts on the null directly.
 *
 * @param {Resolved} t
 * @returns {NonNullable<Resolved>}
 */
const nonNull = (t) => {
  if (t === null) throw new Error("resolveTarget answered null for a non-null spec");
  return t;
};

const FLAT = curve([]);

/**
 * @param {{ length: number, reduce(cb: (acc: number, v: number) => number, init: number): number }} xs
 * @returns {number}
 */
const mean = (xs) => xs.reduce((acc, v) => acc + v, 0) / xs.length;

// --- sources -----------------------------------------------------------------

// 1
test("test_an_undefined_spec_resolves_to_null", async () => {
  assert.equal(await resolveTarget(undefined, FLAT, FS), null);
});

// 2 — mean-aligning a curve against itself is a no-op. Probed OFF the band's
// center, where the skirt is nonzero but well short of the peak value, so a
// wrong implementation that only preserves peak gains fails.
test("test_current_source_reproduces_the_base_curve_at_a_probe_frequency", async () => {
  const base = curve([band(1000, 3, 1)]);
  const t = nonNull(await resolveTarget({ from: "current" }, base, FS));
  assert.ok(...near(valueAt(t.curve, 2000), valueAt(base, 2000), 0.05));
});

// 2
test("test_current_source_against_itself_reports_a_zero_alignment_shift", async () => {
  const base = curve([band(1000, 3, 1)]);
  const t = nonNull(await resolveTarget({ from: "current" }, base, FS));
  assert.ok(...near(/** @type {number} */ (t.meta.shift_db), 0, 1e-6));
});

// 3
test("test_flat_source_unaligned_reads_zero_db", async () => {
  const t = nonNull(await resolveTarget({ from: "flat", align: "none" }, FLAT, FS));
  assert.ok(...near(valueAt(t.curve, 500), 0, 1e-6));
});

// 4
test("test_flat_source_with_a_db_level_reads_that_level", async () => {
  const t = nonNull(await resolveTarget({ from: "flat", db: -2, align: "none" }, FLAT, FS));
  assert.ok(...near(valueAt(t.curve, 500), -2, 1e-6));
});

// 5 — 316.23 Hz is the log midpoint of 100 and 1000.
test("test_points_source_interpolates_linearly_in_log_frequency", async () => {
  /** @type {TargetSpec} */
  const spec = {
    from: "points",
    points: [
      [100, 0],
      [1000, 6],
    ],
    align: "none",
  };
  const t = nonNull(await resolveTarget(spec, FLAT, FS));
  assert.ok(...near(valueAt(t.curve, 316.23), 3, 0.05));
});

// 6
test("test_points_source_clamps_below_the_first_point", async () => {
  /** @type {TargetSpec} */
  const spec = {
    from: "points",
    points: [
      [100, 0],
      [1000, 6],
    ],
    align: "none",
  };
  const t = nonNull(await resolveTarget(spec, FLAT, FS));
  assert.ok(...near(valueAt(t.curve, 30), 0, 0.05));
});

// 6
test("test_points_source_clamps_above_the_last_point", async () => {
  /** @type {TargetSpec} */
  const spec = {
    from: "points",
    points: [
      [100, 0],
      [1000, 6],
    ],
    align: "none",
  };
  const t = nonNull(await resolveTarget(spec, FLAT, FS));
  assert.ok(...near(valueAt(t.curve, 5000), 6, 0.05));
});

// 7
test("test_points_source_with_fewer_than_two_points_is_rejected", async () => {
  /** @type {TargetSpec} */
  const spec = { from: "points", points: [[100, 0]] };
  await assert.rejects(() => resolveTarget(spec, FLAT, FS), /point/i);
});

// 8 — probed OFF the band's center (2 kHz for a band at 1 kHz), where the
// response depends on q, not just g; a center-only probe would pass an
// implementation that ignores q.
test("test_chain_source_matches_curveof_of_the_same_bands", async () => {
  const bands = [{ type: "peak", f: 1000, q: 1, g: 3 }];
  const t = nonNull(await resolveTarget({ from: "chain", bands, align: "none" }, FLAT, FS));
  assert.ok(...near(valueAt(t.curve, 2000), valueAt(curve([band(1000, 3, 1)]), 2000), 0.05));
});

// 9 — the Preamp line must NOT shift the curve.
test("test_parametric_eq_source_reads_the_filter_lines_and_ignores_preamp", async () => {
  const path = join(tmpdir(), `eqlab-target-${process.pid}-peq.txt`);
  writeFileSync(path, "Preamp: -6.0 dB\nFilter 1: ON PK Fc 1000 Hz Gain 3.0 dB Q 1.41\n");
  const t = nonNull(await resolveTarget({ from: "parametric_eq", path, align: "none" }, FLAT, FS));
  assert.ok(...near(valueAt(t.curve, 1000), 3, 0.1));
});

// 10
test("test_parametric_eq_file_with_no_filter_lines_is_rejected_naming_the_path", async () => {
  const path = join(tmpdir(), `eqlab-target-${process.pid}-empty.txt`);
  writeFileSync(path, "just some prose, no filters here\n");
  await assert.rejects(
    () => resolveTarget({ from: "parametric_eq", path, align: "none" }, FLAT, FS),
    (e) => /** @type {Error} */ (e).message.includes(path),
  );
});

// 11
test("test_an_unknown_source_is_rejected_naming_the_valid_sources", async () => {
  await assert.rejects(() => resolveTarget({ from: "vibes" }, FLAT, FS), /flat|current|points|chain|parametric/i);
});

// --- transforms --------------------------------------------------------------

const PEAKY = () => curve([band(500, 6, 8)]);

// 12 — inside the span the target is the straight line in log f joining the
// edge values. The peak rides a shelf so the two edges differ clearly: at the
// span's log-midpoint the line reads the arithmetic mean of the edge values,
// which a constant fill (zero or either edge) cannot reproduce.
test("test_interpolate_edges_override_flattens_the_span_to_its_edge_line", async () => {
  const base = curve([band(1000, 6, 1, "hshelf"), band(500, 6, 8)]);
  /** @type {TargetSpec} */
  const spec = {
    from: "current",
    override: { range: [250, 1000], method: "interpolate_edges" },
    align: "none",
  };
  const t = nonNull(await resolveTarget(spec, base, FS));
  const edgeMean = (valueAt(t.curve, 250) + valueAt(t.curve, 1000)) / 2;
  assert.ok(...near(valueAt(t.curve, 500), edgeMean, 0.1));
});

// 12
test("test_interpolate_edges_override_leaves_the_curve_untouched_outside_the_span", async () => {
  const base = PEAKY();
  /** @type {TargetSpec} */
  const spec = {
    from: "current",
    override: { range: [250, 1000], method: "interpolate_edges" },
    align: "none",
  };
  const t = nonNull(await resolveTarget(spec, base, FS));
  assert.ok(...near(valueAt(t.curve, 2000), valueAt(base, 2000), 0.05));
});

// 13
test("test_an_array_of_two_overrides_replaces_both_spans", async () => {
  const base = curve([band(500, 6, 8), band(4000, 6, 8)]);
  /** @type {TargetSpec} */
  const spec = {
    from: "current",
    override: [
      { range: [250, 1000], method: "interpolate_edges" },
      { range: [2000, 8000], method: "interpolate_edges" },
    ],
    align: "none",
  };
  const t = nonNull(await resolveTarget(spec, base, FS));
  const worst = Math.max(Math.abs(valueAt(t.curve, 500)), Math.abs(valueAt(t.curve, 4000)));
  assert.ok(...below(worst, 0.5));
});

// 14
test("test_an_override_without_a_valid_range_is_rejected", async () => {
  // An override missing its range is outside TargetSpec by design, so the
  // literal reaches resolveTarget through `unknown`.
  const spec = /** @type {TargetSpec} */ (
    /** @type {unknown} */ ({ from: "current", override: { method: "interpolate_edges" }, align: "none" })
  );
  await assert.rejects(() => resolveTarget(spec, PEAKY(), FS));
});

// 14
test("test_an_override_with_an_unknown_method_is_rejected_naming_the_method", async () => {
  /** @type {TargetSpec} */
  const spec = { from: "current", override: { range: [250, 1000], method: "vibes" }, align: "none" };
  await assert.rejects(() => resolveTarget(spec, PEAKY(), FS), /vibes/);
});

// 15 — the range covers the whole 20 Hz..20 kHz grid, so no flanking grid
// points exist at all on either side.
test("test_fit_trend_without_flanking_context_is_rejected_suggesting_alternatives", async () => {
  /** @type {TargetSpec} */
  const spec = {
    from: "current",
    override: { range: [20, 20000], method: "fit_trend" },
    align: "none",
  };
  await assert.rejects(() => resolveTarget(spec, PEAKY(), FS), /flank_octaves|interpolate_edges/);
});

// 16
test("test_smooth_override_pulls_a_narrow_peak_well_below_its_own_height", async () => {
  /** @type {TargetSpec} */
  const spec = { from: "current", override: { range: [250, 1000], method: "smooth" }, align: "none" };
  const t = nonNull(await resolveTarget(spec, PEAKY(), FS));
  assert.ok(...below(valueAt(t.curve, 500), 3));
});

// 17
test("test_tilt_raises_one_octave_above_the_pivot_by_the_per_octave_rate", async () => {
  /** @type {TargetSpec} */
  const spec = { from: "flat", tilt: { db_per_octave: 6, pivot: 1000 }, align: "none" };
  const t = nonNull(await resolveTarget(spec, FLAT, FS));
  assert.ok(...near(valueAt(t.curve, 2000), 6, 0.1));
});

// 17
test("test_tilt_lowers_two_octaves_below_the_pivot_by_twice_the_rate", async () => {
  /** @type {TargetSpec} */
  const spec = { from: "flat", tilt: { db_per_octave: 6, pivot: 1000 }, align: "none" };
  const t = nonNull(await resolveTarget(spec, FLAT, FS));
  assert.ok(...near(valueAt(t.curve, 250), -12, 0.1));
});

// 18
test("test_tilt_without_a_numeric_rate_is_rejected", async () => {
  // A tilt missing its rate is outside TargetSpec by design, so the literal
  // reaches resolveTarget through `unknown`.
  const spec = /** @type {TargetSpec} */ (
    /** @type {unknown} */ ({ from: "flat", tilt: { pivot: 1000 }, align: "none" })
  );
  await assert.rejects(() => resolveTarget(spec, FLAT, FS));
});

// 19
test("test_smooth_with_a_non_positive_window_is_rejected", async () => {
  /** @type {TargetSpec} */
  const spec = { from: "flat", smooth: { octaves: 0 }, align: "none" };
  await assert.rejects(() => resolveTarget(spec, FLAT, FS));
});

// 20
test("test_smoothing_a_flat_curve_leaves_it_flat", async () => {
  /** @type {TargetSpec} */
  const spec = { from: "flat", smooth: { octaves: 1 }, align: "none" };
  const t = nonNull(await resolveTarget(spec, FLAT, FS));
  assert.ok(...near(valueAt(t.curve, 1000), 0, 0.05));
});

// --- align -------------------------------------------------------------------

// 21
test("test_default_mean_alignment_matches_the_targets_mean_to_the_bases", async () => {
  const base = curve([band(1000, 4, 1)]);
  const t = nonNull(await resolveTarget({ from: "flat" }, base, FS));
  assert.ok(...near(mean(t.curve.db), mean(base.db), 1e-6));
});

// 22
test("test_align_at_a_frequency_pins_the_target_to_the_base_there", async () => {
  const base = curve([band(1000, 4, 1)]);
  const t = nonNull(await resolveTarget({ from: "flat", align: { at: 1000 } }, base, FS));
  assert.ok(...near(valueAt(t.curve, 1000), valueAt(base, 1000), 0.05));
});

// 23
test("test_an_invalid_align_value_is_rejected", async () => {
  // "loud" is outside the align union by design, so the literal reaches
  // resolveTarget through `unknown`.
  const spec = /** @type {TargetSpec} */ (/** @type {unknown} */ ({ from: "flat", align: "loud" }));
  await assert.rejects(() => resolveTarget(spec, FLAT, FS));
});

// 24
test("test_meta_preview_starts_at_20_hz", async () => {
  const t = nonNull(await resolveTarget({ from: "flat", align: "none" }, FLAT, FS));
  assert.ok(...near(/** @type {number} */ (t.meta.preview[0][0]), 20, 0.01));
});

// 24 — the pairs are [hz, db]: an unaligned flat target previews at 0 dB.
test("test_meta_preview_entries_carry_the_target_db", async () => {
  const t = nonNull(await resolveTarget({ from: "flat", align: "none" }, FLAT, FS));
  assert.ok(...near(/** @type {number} */ (t.meta.preview[0][1]), 0, 1e-6));
});

// 24
test("test_meta_preview_ends_at_20_khz", async () => {
  const t = nonNull(await resolveTarget({ from: "flat", align: "none" }, FLAT, FS));
  assert.ok(...near(/** @type {number} */ (t.meta.preview[t.meta.preview.length - 1][0]), 20000, 1));
});
