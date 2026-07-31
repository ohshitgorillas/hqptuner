// Behavioral suite for eqlab's `replace` change kind — genuine band
// replacement (delete + insert, no g=0 leftovers), its edit records, the
// residual-fit measurement, search-space expansion, refinement of `with`
// bands, and guidance flags. Written blind from a spec block: no eqlab
// source was read. Numbers in comments refer to the spec's behaviour list.
//
// Run: node --test tests/js/eqlab-replace.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { applyChanges, serialize, selectBand } from "../../scripts/eqlab/chain.js";
import { candidates } from "../../scripts/eqlab/space.js";
import { evaluateJob } from "../../scripts/eqlab/jobs.js";
import { searchJob, refineJob } from "../../scripts/eqlab/search.js";
import { guidanceFlags } from "../../scripts/eqlab/guidance.js";
import { residualFit, fitOfEdits } from "../../scripts/eqlab/metrics.js";
import { near, below, band, argNum } from "./eqlab-helpers.js";

const FS = 44100;

// True when the serialized chain still carries a stage at frequency f —
// boundary-anchored so f=100 never matches inside f=1000.
const hasBand = (s, f) => new RegExp(`f=${f}(;|,|$)`).test(s);

// --- 1, 2: genuine replacement -----------------------------------------------

const BASE = [band(100, 3, 1), band(1000, -2, 2), band(4000, 4, 1)];
const REPL = applyChanges(BASE, {
  replace: [{ remove: [1000], with: [{ type: "peak", f: 1500, q: 1, g: 2 }] }],
});
const PURE = applyChanges(BASE, { replace: [{ remove: [1000], with: [] }] });

test("test_replace_yields_original_minus_removed_plus_added_stage_count", () => {
  const two = applyChanges(BASE, {
    replace: [{ remove: [1000, 4000], with: [{ type: "peak", f: 2000, q: 1, g: 1 }] }],
  });
  assert.equal(two.stages.length, 2); // 3 − 2 + 1
});

test("test_a_removed_band_leaves_no_trace_in_the_process_string", () => {
  assert.equal(hasBand(serialize(REPL.stages), 1000), false);
});

test("test_the_with_band_sits_where_the_first_removed_band_sat", () => {
  assert.equal(selectBand(REPL.stages, 1500), 1);
});

test("test_with_bands_take_the_position_of_the_first_removed_band_not_the_last", () => {
  // Remove the first (100 Hz) and third (4000 Hz) of three bands: the single
  // `with` band must sit where the FIRST removed band sat — index 0.
  const res = applyChanges(BASE, {
    replace: [{ remove: [100, 4000], with: [{ type: "peak", f: 2500, q: 1, g: 1 }] }],
  });
  assert.equal(selectBand(res.stages, 2500), 0);
});

test("test_an_empty_with_list_means_pure_removal", () => {
  assert.equal(PURE.stages.length, 2);
});

test("test_pure_removal_leaves_no_g_zero_placeholder", () => {
  assert.equal(hasBand(serialize(PURE.stages), 1000), false);
});

// --- 3, 4, 5: validation -----------------------------------------------------

test("test_an_unknown_remove_frequency_throws_naming_the_bands_present", () => {
  // The message must name the bands actually present — at least two of them,
  // in serialized chain order.
  assert.throws(() => applyChanges(BASE, { replace: [{ remove: [555], with: [] }] }), /1000[\s\S]*4000/);
});

test("test_removing_the_same_band_twice_in_one_list_throws", () => {
  assert.throws(() => applyChanges(BASE, { replace: [{ remove: [1000, 1000], with: [] }] }));
});

test("test_an_empty_remove_list_throws", () => {
  assert.throws(() => applyChanges(BASE, { replace: [{ remove: [], with: [] }] }));
});

test("test_amending_and_removing_the_same_band_throws", () => {
  assert.throws(
    () =>
      applyChanges(BASE, {
        amend: [{ select: 1000, g: 1 }],
        replace: [{ remove: [1000], with: [] }],
      }),
    /amend or replace/i,
  );
});

// --- 6: edit records ---------------------------------------------------------

const REPL_EDITS = REPL.edits.filter((e) => e.kind === "replace");

test("test_a_replace_produces_one_replace_edit_record", () => {
  assert.equal(REPL_EDITS.length, 1);
});

test("test_the_edit_records_the_removed_bands_original_index", () => {
  assert.equal(REPL_EDITS[0].removed[0].index, 1);
});

test("test_the_edit_records_the_removed_bands_args", () => {
  assert.equal(Number(REPL_EDITS[0].removed[0].before.f), 1000);
});

test("test_the_edit_records_the_removed_bands_gain", () => {
  assert.equal(Number(REPL_EDITS[0].removed[0].before.g), -2);
});

test("test_the_edit_records_the_added_bands_index", () => {
  assert.equal(REPL_EDITS[0].added[0].index, 1);
});

test("test_the_edit_records_the_added_bands_args", () => {
  assert.equal(Number(REPL_EDITS[0].added[0].after.f), 1500);
});

test("test_the_edit_records_the_added_bands_gain", () => {
  assert.equal(Number(REPL_EDITS[0].added[0].after.g), 2);
});

const CTX = { stages: BASE, fs: FS, metrics: { spot: { kind: "at", f: 1000 } } };
const EV = evaluateJob(
  { changes: { replace: [{ remove: [1000], with: [{ type: "peak", f: 1500, q: 1, g: 2 }] }] } },
  CTX,
);

test("test_an_evaluate_job_echoes_the_replace_edits", () => {
  assert.equal(EV.edits.filter((e) => e.kind === "replace").length, 1);
});

// --- 7: fit array presence ---------------------------------------------------

test("test_an_evaluate_result_with_replace_carries_a_fit_array", () => {
  assert.ok(Array.isArray(EV.fit), `expected a fit array, got ${JSON.stringify(EV.fit)}`);
});

test("test_fit_carries_one_entry_per_replace_spec", () => {
  const two = evaluateJob(
    {
      changes: {
        replace: [
          { remove: [100], with: [] },
          { remove: [4000], with: [] },
        ],
      },
    },
    CTX,
  );
  assert.equal(two.fit.length, 2);
});

test("test_a_fit_entry_carries_rmse_maxdev_hz_and_range", () => {
  const missing = ["rmse", "maxdev", "hz", "range"].filter((k) => !(k in EV.fit[0]));
  assert.deepEqual(missing, []);
});

test("test_an_evaluate_result_without_replace_has_no_fit_key", () => {
  const res = evaluateJob({ changes: { amend: [{ select: 1000, g: 1 }] } }, CTX);
  assert.ok(!("fit" in res), `expected no fit key, got ${Object.keys(res)}`);
});

test("test_fit_of_edits_is_empty_without_replace_edits", () => {
  const amended = applyChanges(BASE, { amend: [{ select: 1000, g: 1 }] });
  assert.deepEqual(fitOfEdits(amended.edits, FS), []);
});

// --- 8: residual arithmetic --------------------------------------------------

const IDENTICAL = residualFit([band(1000, -2, 2)], [band(1000, -2, 2)], FS);
const REMOVED = residualFit([band(1000, -2, 2)], [], FS);

test("test_replacing_a_band_with_an_identical_band_gives_near_zero_rmse", () => {
  assert.ok(...near(IDENTICAL.rmse, 0, 0.01));
});

test("test_replacing_a_band_with_an_identical_band_gives_near_zero_maxdev", () => {
  assert.ok(...near(IDENTICAL.maxdev, 0, 0.01));
});

test("test_pure_removal_maxdev_is_the_removed_bands_peak_gain", () => {
  assert.ok(...near(REMOVED.maxdev, 2, 0.1));
});

test("test_pure_removal_peak_deviation_sits_at_the_bands_frequency", () => {
  assert.ok(...near(REMOVED.hz, 1000, 50));
});

// --- 9: fit range ------------------------------------------------------------

test("test_fit_range_defaults_to_the_full_audio_band", () => {
  assert.deepEqual(REMOVED.range, [20, 20000]);
});

test("test_a_narrowed_fit_range_confines_the_residual_measurement", () => {
  // A q=4 peak at 100 Hz leaves almost nothing above 1 kHz.
  assert.ok(...below(residualFit([band(100, 3, 4)], [], FS, [1000, 20000]).maxdev, 0.3));
});

test("test_fit_range_on_a_replace_spec_is_echoed_back_as_range", () => {
  const res = evaluateJob({ changes: { replace: [{ remove: [1000], with: [], fit_range: [500, 2000] }] } }, CTX);
  assert.deepEqual(res.fit[0].range, [500, 2000]);
});

// --- 10: search-space expansion ----------------------------------------------
//
// One removable band at 1 kHz, spot metric right there: a candidate whose
// `with` band sets g scores spot ≈ g, so constraint arithmetic is readable.

const SBASE = [band(1000, 0, 1), band(4000, 0, 1)];
const SCTX = { stages: SBASE, fs: FS, metrics: { spot: { kind: "at", f: 1000 } } };

test("test_replace_with_parameters_cross_with_amend_in_the_candidate_count", () => {
  const res = searchJob(
    {
      space: {
        // with: f literal pair (2) × g range (-3, -2, -1 → 3); amend: 2 → 12.
        replace: [{ remove: [1000], with: [{ type: "peak", f: [800, 1200], q: 1, g: [-3, -1, 1] }] }],
        amend: [{ select: 4000, g: [1, 2] }],
      },
      constraints: [],
      objective: "maximize spot",
      top: 5,
    },
    SCTX,
  );
  assert.equal(res.considered, 12);
});

test("test_a_with_band_triple_expands_as_a_from_to_step_range", () => {
  const cands = candidates({
    replace: [{ remove: [1000], with: [{ type: "peak", f: 1000, q: 1, g: [1, 2, 1] }] }],
  });
  assert.equal(cands.length, 2);
});

test("test_a_remove_list_is_literal_not_a_value_sweep", () => {
  assert.equal(candidates({ replace: [{ remove: [1000, 4000], with: [] }] }).length, 1);
});

// --- 11: fit on survivors ----------------------------------------------------

const RSPACE = {
  replace: [{ remove: [1000], with: [{ type: "peak", f: 1000, q: 1, g: [0, 4, 2] }] }],
};
const SRES = searchJob({ space: RSPACE, constraints: [], objective: "maximize spot", top: 5 }, SCTX);

test("test_scalar_survivors_with_replace_carry_the_fit_array", () => {
  // g: [0, 4, 2] expands to three candidates; every top entry carries fit.
  assert.deepEqual(
    SRES.top.map((e) => Array.isArray(e.fit)),
    [true, true, true],
  );
});

test("test_pareto_front_entries_with_replace_carry_the_fit_array", () => {
  // Each candidate cuts one well-separated frequency, so both trade off.
  const pres = searchJob(
    {
      space: { replace: [{ remove: [1000], with: [{ type: "peak", f: [500, 4000], q: 1, g: -2 }] }] },
      constraints: [],
      pareto: ["minimize a", "minimize b"],
      top: 5,
    },
    { stages: [band(1000, 0, 1)], fs: FS, metrics: { a: { kind: "at", f: 500 }, b: { kind: "at", f: 4000 } } },
  );
  assert.deepEqual(
    pres.front.map((e) => Array.isArray(e.fit)),
    [true, true],
  );
});

test("test_rejected_top_entries_carry_no_fit", () => {
  // spot max 1 rejects the g=2 and g=4 candidates.
  const rej = searchJob(
    { space: RSPACE, constraints: [{ metric: "spot", max: 1 }], objective: "maximize spot", top: 5 },
    SCTX,
  );
  assert.deepEqual(
    rej.rejected_top.map((e) => "fit" in e),
    [false, false],
  );
});

// --- 12: refining the with bands ---------------------------------------------
//
// The `with` band's g sweeps [-1, 1, 0.4]; minimize spot² has its continuous
// optimum at g = 0, between the grid points ±0.2 — refinement must leave the
// grid, but never the declared [-1, 1] box.

const QBASE = [band(1000, 0, 1)];
const QCTX = {
  stages: QBASE,
  fs: FS,
  metrics: { spot: { kind: "at", f: 1000 }, sq: { kind: "expr", expr: "spot * spot" } },
};
const GRID = [-1, -0.6, -0.2, 0.2, 0.6, 1];
const QSPACE = {
  replace: [{ remove: [1000], with: [{ type: "peak", f: 1000, q: 1, g: [-1, 1, 0.4] }] }],
};
const RRES = searchJob({ space: QSPACE, constraints: [], objective: "minimize sq", top: 5, refine: true }, QCTX);
const WINNER = RRES.top[0];
// After the replace the with band is the only stage: read its g back through
// applyChanges rather than trusting the changes object's own shape.
const gOf = (changes) => argNum(applyChanges(QBASE, changes).stages[0], "g");

test("test_a_refined_replace_winner_carries_the_refined_block", () => {
  assert.ok("refined" in WINNER, `expected a refined key, got ${Object.keys(WINNER)}`);
});

test("test_refining_a_with_band_beats_a_grid_that_straddles_the_optimum", () => {
  assert.ok(...below(WINNER.refined.score, WINNER.refined.from_score));
});

test("test_a_refined_with_band_may_land_between_grid_values", () => {
  const g = gOf(WINNER.changes);
  assert.ok(
    GRID.every((v) => Math.abs(g - v) > 1e-6),
    `expected an off-grid g, got ${g}`,
  );
});

test("test_a_refined_with_band_never_leaves_the_declared_box", () => {
  // maximize spot rewards g without bound, so the continuous optimum sits
  // ABOVE the declared [0.5, 1.0] box — an unclamped refiner sails past 1.0.
  const res = searchJob(
    {
      space: { replace: [{ remove: [1000], with: [{ type: "peak", f: 1000, q: 1, g: [0.5, 1.0] }] }] },
      constraints: [],
      objective: "maximize spot",
      top: 1,
      refine: true,
    },
    QCTX,
  );
  const g = gOf(res.top[0].changes);
  assert.ok(g <= 1 + 1e-6, `expected g clamped to the declared max 1.0, got ${g}`);
});

test("test_refining_a_multi_valued_with_band_frequency_stays_within_its_declared_box", () => {
  // f declared as the literal pair [925, 1075]; maximize spot at 1000 Hz has
  // its optimum at f = 1000 — inside the box, off the grid — so the refiner
  // must move f, and must report it inside [925, 1075].
  const res = searchJob(
    {
      space: { replace: [{ remove: [1000], with: [{ type: "peak", f: [925, 1075], q: 1, g: 2 }] }] },
      constraints: [],
      objective: "maximize spot",
      top: 1,
      refine: true,
    },
    QCTX,
  );
  const w = res.top[0];
  const f = argNum(applyChanges(QBASE, w.changes).stages[0], "f");
  assert.ok(
    "refined" in w && f >= 925 - 1e-6 && f <= 1075 + 1e-6,
    `expected a refined winner with f in [925, 1075], got f=${f}, keys=${Object.keys(w)}`,
  );
});

// --- 13: standalone refine job -----------------------------------------------

test("test_refine_job_accepts_a_seed_containing_replace", () => {
  const rj = refineJob(
    {
      seed: { replace: [{ remove: [1000], with: [{ type: "peak", f: 1000, q: 1, g: 0.6 }] }] },
      space: QSPACE,
      constraints: [],
      objective: "minimize sq",
    },
    QCTX,
  );
  assert.ok(rj.best.score <= rj.seed.score, `expected ${rj.best.score} <= ${rj.seed.score}`);
});

test("test_refine_job_names_a_multi_valued_with_parameter_the_seed_lacks", () => {
  const bare = {
    seed: { replace: [{ remove: [1000], with: [{ type: "peak", f: 1000, q: 1 }] }] },
    space: QSPACE,
    constraints: [],
    objective: "minimize sq",
  };
  assert.throws(() => refineJob(bare, QCTX), /(^|[^a-z])g([^a-z]|$)/i);
});

// --- 14: guidance flags ------------------------------------------------------

const policyFlags = (result) => guidanceFlags(result.edits, result.stages).filter((f) => f.severity === "policy");

test("test_removing_a_band_louder_than_six_decibels_raises_a_policy_flag", () => {
  const loud = applyChanges([band(1000, 7, 1)], { replace: [{ remove: [1000], with: [] }] });
  assert.equal(policyFlags(loud).length, 1);
});

test("test_a_with_band_beyond_six_decibels_flags_like_an_appended_band", () => {
  const loud = applyChanges([band(1000, 1, 1)], {
    replace: [{ remove: [1000], with: [{ type: "peak", f: 2000, q: 1, g: 7 }] }],
  });
  assert.equal(policyFlags(loud).length, 1);
});

test("test_gains_at_six_decibels_raise_no_policy_flag", () => {
  const edge = applyChanges([band(1000, 6, 1)], {
    replace: [{ remove: [1000], with: [{ type: "peak", f: 2000, q: 1, g: -6 }] }],
  });
  assert.equal(policyFlags(edge).length, 0);
});
