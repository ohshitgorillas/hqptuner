// Behavioral suite for the eqlab note tables and the report they render into:
// what a harmonic that was never measured reports, and how the report prints
// it. Written blind from a spec block: neither scripts/eqlab/notes.js nor
// scripts/eqlab/render.js was read.
//
// The hazard being pinned is arithmetic on a missing reading. JavaScript makes
// `null - 5` evaluate to -5 and `5 - null` evaluate to 5, so a delta taken from
// an unmeasured curve is a plausible-looking number rather than a NaN anybody
// would notice; and the downstream `.toFixed` on that same null is a TypeError
// that takes the whole report down. Both directions of the asymmetry are
// covered, because a guard on only one side passes the other's test.
//
// Both render tests drive a real job end to end (resolveChain -> job -> render)
// rather than hand-assembling an answer shape, so what is rendered is what the
// jobs actually emit.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqlab/eqlab-note-deltas.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { noteDeltas } from "../../../scripts/eqlab/notes.js";
import { render } from "../../../scripts/eqlab/render.js";
import { resolveChain } from "../../../scripts/eqlab/chain.js";
import { evaluateJob, probe } from "../../../scripts/eqlab/jobs.js";
import { resolveMetricSpecs } from "../../../scripts/eqlab/metrics.js";
import { FS, near } from "../support/eqlab-helpers.js";

/**
 * The note tables are null when no note spec asked for one; every case here
 * asks for one.
 *
 * @template T
 * @param {T | null} x
 * @returns {T}
 */
const nonNull = (x) => {
  if (x === null) throw new Error("expected a note table, got null");
  return x;
};

/**
 * Pick a harmonic by its own n: nothing in the spec promises the returned
 * entries keep the order of the requested `harmonics` array.
 *
 * @template {{ n?: number | null }} H
 * @param {{ harmonics: H[] }} row
 * @param {number} n
 * @returns {H}
 */
const harmonic = (row, n) => {
  const found = row.harmonics.find((h) => h.n === n);
  if (found === undefined) throw new Error(`no harmonic ${n} in the row`);
  return found;
};

/**
 * A rounded note row viewed through the two harmonic keys a plain note table
 * writes: `jobs.js` types the rounded harmonics as an open record.
 *
 * @param {import("../../../scripts/eqlab/jobs.js").RoundedNote} row
 * @returns {{ harmonics: { n?: number | null, db?: number | null }[] }}
 */
const noteRow = (row) => row;

/**
 * The cell under a named column of a fixed-width table: find the header row by
 * the column name, find the body row by its leading label, and read the same
 * whitespace-separated index out of each. Tolerates indentation, column-width
 * changes and extra trailing columns.
 *
 * @param {string} report
 * @param {string} label
 * @param {string} column
 * @returns {string}
 */
const cellUnder = (report, label, column) => {
  const lines = report.split("\n");
  const header = lines.find((line) => line.trim().split(/\s+/).includes(column)) ?? "";
  const row = lines.find((line) => new RegExp(`^\\s*${label}\\b`).test(line)) ?? "";
  return row.trim().split(/\s+/)[header.trim().split(/\s+/).indexOf(column)];
};

// --- behaviour 1: an unmeasured harmonic has no delta -------------------------
//
// A4 is 440 Hz exactly, so its 4th harmonic is 1760 Hz exactly. `before` spans
// 20 Hz .. 20000 Hz and covers it; `after` stops at 1000 Hz and does not. Both
// curves read +5 dB everywhere they exist, so a delta fabricated from the
// missing `after` reading would come out as the plausible -5, not as NaN.
const WIDE = { freqs: [20, 440, 1760, 20000], db: [5, 5, 5, 5] };
const NARROW_HIGH = { freqs: [20, 440, 1000], db: [5, 5, 5] };
const A4_SPEC = { from: "A4", to: "A4", harmonics: [1, 4] };

test("test_a_harmonic_measured_on_before_but_not_on_after_has_no_delta", () => {
  const row = nonNull(noteDeltas(WIDE, NARROW_HIGH, A4_SPEC))[0];
  assert.equal(harmonic(row, 4).delta, null);
});

test("test_a_harmonic_off_the_after_curve_reports_no_after_level", () => {
  const row = nonNull(noteDeltas(WIDE, NARROW_HIGH, A4_SPEC))[0];
  assert.equal(harmonic(row, 4).after, null);
});

// The mirror image, and it fails for a different reason: here the probed
// harmonic is BELOW the narrow curve's low end rather than above its top.
// A3 is 220 Hz exactly, so its own fundamental sits under `before`'s 500 Hz
// start while its 4th harmonic, 880 Hz, is inside both grids. A guard written
// only against a missing `after` fabricates 5 - null === 5 here.
const NARROW_LOW = { freqs: [500, 880, 20000], db: [5, 5, 5] };
const WIDE_A3 = { freqs: [20, 220, 880, 20000], db: [5, 5, 5, 5] };
const A3_SPEC = { from: "A3", to: "A3", harmonics: [1, 4] };

test("test_a_harmonic_measured_on_after_but_not_on_before_has_no_delta", () => {
  const row = nonNull(noteDeltas(NARROW_LOW, WIDE_A3, A3_SPEC))[0];
  assert.equal(harmonic(row, 1).delta, null);
});

// --- behaviour 2: a null delta renders as a dash ------------------------------
//
// A real evaluate job over a real chain, asked for A4's 48th harmonic
// (21120 Hz), which is off the top of both curves and so is unmeasured on each.
// That is the same null the renderer has to survive.
const PEAK_BANDS = [{ type: "peak", f: 1000, q: 1, g: 3 }];

/**
 * @param {import("../../../scripts/eqlab/chain.js").Band[]} bands
 * @param {import("../../../scripts/eqlab/notes.js").NoteSpec} notes
 */
async function ctxOf(bands, notes) {
  const resolved = await resolveChain({ bands });
  return {
    stages: resolved.stages,
    fs: FS,
    source: resolved.source,
    metrics: resolveMetricSpecs(undefined),
    notes,
    target: null,
  };
}

test("test_a_note_delta_that_was_never_measured_renders_as_a_dash", async () => {
  const ctx = await ctxOf(PEAK_BANDS, { from: "A4", to: "A4", harmonics: [1, 48] });
  const out = evaluateJob({ changes: { amend: [{ select: 1000, g: 1 }] } }, ctx);
  const report = render({ ...out, job: "evaluate", fs: ctx.fs, source: ctx.source, tail_consistency: null });
  assert.equal(cellUnder(report, "A4", "h48"), "-");
});

// --- the plain note table renders its levels ----------------------------------
//
// A probe answer carries a note table whose harmonics have a `db` key and no
// before/after/delta — the other renderer branch. +6 dB is parked right on A4
// (440 Hz), so the printed level is unmistakable against 0, null or a dash.
const A4_BOOST = [{ type: "peak", f: 440, q: 3, g: 6 }];

test("test_a_plain_note_table_renders_the_measured_level_of_a_harmonic", async () => {
  const ctx = await ctxOf(A4_BOOST, { from: "A4", to: "A4", harmonics: [1] });
  const out = probe({}, ctx);
  const report = render({ ...out, job: "probe", fs: ctx.fs, source: ctx.source, tail_consistency: null });
  assert.ok(
    ...near(
      Number(cellUnder(report, "A4", "h1")),
      /** @type {number} */ (harmonic(noteRow(nonNull(out.notes)[0]), 1).db),
      0.01,
    ),
  );
});
