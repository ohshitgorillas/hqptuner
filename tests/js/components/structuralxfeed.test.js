// Behavioral suite for components/xfeed/Structural.js — the RESPONSE-card lens
// traces and the Pipelines-card badge for the structural crossfeed block.
//
// Both surfaces are exported and derive everything from the pipeline rows, so
// the whole contract is reachable: `structuralLensTraces` is a pure function of
// (rows, bounds), and `StructuralBadge` reads the exported `effectivePipelines`
// computed, driven here through the config baseline exactly as the store fills
// it. Blocks are built with the real compiler (lib/binaural/compile.js) — a sixteen-row
// block is the daemon's serialization, not a fixture.

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { structuralLensTraces, StructuralBadge } from "../../../hqptuner/static/components/xfeed/Structural.js";
import { lensOn } from "../../../hqptuner/static/components/xfeed/Comp.js";
import { compileRows } from "../../../hqptuner/static/lib/binaural/compile.js";
import { HEAD_RADIUS } from "../../../hqptuner/static/lib/binaural/geometry.js";
import { config, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { staticWire } from "../support/wire.js";

/** @typedef {import("../../../hqptuner/static/lib/matrixspec.js").PipelineRow} PipelineRow */

const EQ = "iir:type=peak;f=1000;q=1;g=-6";
const EQ2 = "iir:type=peak;f=2000;q=1;g=-3";

const block = (over = {}) =>
  compileRows({ lambda: 1, angle: 30, headRadius: HEAD_RADIUS, srcA: 0, srcB: 1, preampDb: 0, eqProcess: "", ...over });

// A plain stereo EQ pair — rows the recognizer must decline.
/**
 * @param {string} source
 * @param {string} mixdown
 * @returns {PipelineRow}
 */
const row = (source, mixdown) => ({ gain: "-3", gainunit: "dB", mixdown, process: EQ, source });
const pair = () => [row("0", "0"), row("1", "1")];

const bounds = () => ({ min: 0, max: 0 });

// [ok, message] for spreading into ONE assert.ok — see xfeed.test.js.
/**
 * @param {number} actual
 * @param {number} expected
 * @param {number} tol
 * @returns {[boolean, string]}
 */
const near = (actual, expected, tol) => [
  Math.abs(actual - expected) <= tol,
  `expected ${expected} ± ${tol}, got ${actual}`,
];

// --- the lens traces ------------------------------------------------------------
//
// The builder's contract gained a second gate by product decision: the shared
// "what you hear" toggle (`lensOn`, components/xfeed/Comp.js), off by default.
// The cases below were right about the old behavior and say the same thing
// about the new one — they just turn the lens on first, including the one that
// asserts NO traces, which pins the block RECOGNIZER and would otherwise pass
// for the wrong reason. The toggle's own contract lives in xfeedlens.test.js.

test("test_plain_rows_produce_no_lens_traces", () => {
  lensOn.value = true;
  assert.equal(structuralLensTraces(pair(), bounds()).length, 0);
});

test("test_a_symmetric_block_draws_one_center_and_one_sides_trace", () => {
  lensOn.value = true;
  assert.equal(structuralLensTraces(block({ eqProcess: EQ }), bounds()).length, 2);
});

test("test_a_per_ear_block_draws_a_pair_of_traces_per_ear", () => {
  lensOn.value = true;
  assert.equal(structuralLensTraces(block({ eqProcess: { left: EQ, right: EQ2 } }), bounds()).length, 4);
});

// A trace's legend label is owner-owned wording; the center character it
// reports is a number. Only the number is asserted (docs/testing.md rule 9).
test("test_the_center_trace_reports_the_center_character", () => {
  lensOn.value = true;
  assert.ok(structuralLensTraces(block({ lambda: 0.7 }), bounds())[0].label.includes("70%"));
});

// Three cases stood here pinning legend wording alone: that the sides trace is
// worded "sides" (its `kind` is pinned below) and that the per-ear traces name
// their ear. The ear a per-ear trace belongs to has no machine identity on the
// trace, so nothing survived removing the words.

test("test_the_center_trace_carries_the_center_plot_kind", () => {
  lensOn.value = true;
  assert.equal(structuralLensTraces(block(), bounds())[0].kind, "xfm");
});

test("test_the_sides_trace_carries_the_sides_plot_kind", () => {
  lensOn.value = true;
  assert.equal(structuralLensTraces(block(), bounds())[1].kind, "xfs");
});

test("test_a_lens_trace_spans_the_plot_band", () => {
  lensOn.value = true;
  assert.equal(structuralLensTraces(block(), bounds())[0].points.length, 160);
});

test("test_the_ear_eq_folds_into_the_lens_curve", () => {
  // the -6 dB peak at 1 kHz must show in the center trace, EQ included
  lensOn.value = true;
  /**
   * @param {PlotTrace[]} traces
   * @returns {number}
   */
  const at1k = (traces) => {
    let best = traces[0].points[0];
    for (const p of traces[0].points) if (Math.abs(p[0] - 1000) < Math.abs(best[0] - 1000)) best = p;
    return best[1];
  };
  const diff =
    at1k(structuralLensTraces(block({ eqProcess: EQ }), bounds())) - at1k(structuralLensTraces(block(), bounds()));
  assert.ok(...near(diff, -6, 0.3));
});

test("test_the_lens_updates_the_shared_plot_bounds", () => {
  lensOn.value = true;
  const b = bounds();
  structuralLensTraces(block({ eqProcess: EQ }), b);
  assert.ok(b.min < -4, `expected the -6 dB peak to pull bounds.min below -4, got ${b.min}`);
});

// --- the pipelines badge ----------------------------------------------------------

// Full reset every time — the staged buffer outlives a test.
/**
 * @param {PipelineRow[]} rows
 * @returns {Promise<void>}
 */
async function reset(rows) {
  staticWire();
  matrixConfig.value = { fields: [] };
  config.value = { fields: [], file: { matrix_pipelines: JSON.stringify(rows) } };
  await discardAll();
}

const badge = () => render(html`<${StructuralBadge} />`);

test("test_plain_rows_render_no_badge", async () => {
  await reset(pair());
  assert.equal(badge(), "");
});

// What the badge REPORTS is numbers; the sentence carrying them is the owner's.

test("test_an_installed_block_badges_its_sixteen_rows", async () => {
  // Read against the block's OWN row list rather than against "some digits in
  // the sentence" — the badge also carries an angle, a head size and a center
  // character, all numbers. Two plain rows sit beside the block here, so a badge
  // counting the whole pipeline set would name 18 and fail both halves.
  const rows = block();
  await reset([...rows, ...pair()]);
  const numbers = [...badge().matchAll(/\d+/g)].map((m) => m[0]);
  const seen = {
    block: numbers.includes(String(rows.length)),
    whole: numbers.includes(String(rows.length + pair().length)),
  };
  assert.deepEqual(seen, { block: true, whole: false });
});

test("test_the_badge_reports_the_speaker_angle", async () => {
  await reset(block({ angle: 45 }));
  assert.ok(badge().includes("±45°"));
});

test("test_the_badge_reports_the_head_size", async () => {
  await reset(block());
  assert.ok(badge().includes("8.8 cm"));
});

test("test_the_badge_reports_the_center_character", async () => {
  await reset(block({ lambda: 0.7 }));
  assert.ok(badge().includes("70%"));
});

// The pair of cases pinning the per-ear marker is gone: the marker is a phrase
// the owner may reword and the badge carries no identity for it, so removing
// the wording left nothing to assert (rule 9).
