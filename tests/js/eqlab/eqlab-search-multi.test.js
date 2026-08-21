// Behavioral suite for scripts/eqlab/search.js — multi-spec search spaces:
// append/amend as arrays of specs, back-compat single specs, and searches
// scored by target-relative metrics. Written blind from a spec block: no
// eqlab source was read. Test numbers in comments refer to the spec block's
// behavior list.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/eqlab-search-multi.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { searchJob } from "../../../scripts/eqlab/search.js";
import { resolveTarget } from "../../../scripts/eqlab/target.js";
import { FS, band, curve } from "../support/eqlab-helpers.js";

/** @typedef {import("../../../scripts/eqlab/jobs.js").JobCtx} JobCtx */
/** @typedef {import("../../../scripts/eqlab/search-space.js").ChangeSet} ChangeSet */
/** @typedef {import("../../../scripts/eqlab/search-space.js").SurvivorOut} SurvivorOut */

/**
 * A survivor of a scalar search whose space fills every change group it reads.
 *
 * @typedef {SurvivorOut & { score: number, changes: Required<ChangeSet> }} TopOut
 */

/** @typedef {{ considered: number, top: TopOut[] }} SearchResult */

const BASE = [band(1000, 0, 1), band(4000, 0, 1)];
/** @type {JobCtx} */
const CTX = { stages: BASE, fs: FS, metrics: { spot: { kind: "at", f: 1000 } } };

/**
 * @param {Record<string, unknown>} space
 * @returns {Record<string, unknown>}
 */
const jobOf = (space) => ({ space, constraints: [], objective: "maximize spot", top: 5 });

/**
 * @param {Record<string, unknown>} job
 * @param {JobCtx} [ctx]
 * @returns {SearchResult}
 */
const run = (job, ctx = CTX) => /** @type {SearchResult} */ (searchJob(job, ctx));

// 41 — append as an array of two specs, each carrying a two-value list:
// the space is the cross product, 2 × 2 = 4 candidates.
const MULTI_APPEND = run(
  jobOf({
    append: [
      { type: "peak", f: [8000, 16000], q: 1, g: 1 },
      { type: "peak", f: 2000, q: 1, g: [1, 2] },
    ],
  }),
);

test("test_two_append_specs_consider_the_product_of_their_expansions", () => {
  assert.equal(MULTI_APPEND.considered, 4);
});

// 41
test("test_a_candidate_from_two_append_specs_appends_two_bands", () => {
  assert.equal(MULTI_APPEND.top[0].changes.append.length, 2);
});

// 42 — back-compat: a single non-array append spec still works.
test("test_a_single_append_spec_yields_one_entry_append_changes", () => {
  const res = run(jobOf({ append: { type: "peak", f: 2000, q: 1, g: [1, 2] } }));
  assert.equal(res.top[0].changes.append.length, 1);
});

// 43 — amend as an array of two specs selecting two existing bands.
test("test_two_amend_specs_amend_two_bands_in_one_candidate", () => {
  const res = run(
    jobOf({
      amend: [
        { select: 1000, g: [1, 2, 1] },
        { select: 4000, g: 1 },
      ],
    }),
  );
  assert.equal(res.top[0].changes.amend.length, 2);
});

// 44 — an amend selector must be one literal frequency, never a value list.
test("test_an_amend_spec_with_a_list_selector_is_rejected", () => {
  assert.throws(() => searchJob(jobOf({ amend: [{ select: [1000, 4000], g: 1 }] }), CTX), /select/i);
});

// 45 — a target-relative objective metric scores against ctx.target.
test("test_a_target_relative_objective_produces_finite_scores", async () => {
  const target = await resolveTarget({ from: "flat", align: "none" }, curve(BASE), FS);
  /** @type {JobCtx} */
  const ctx = {
    stages: BASE,
    fs: FS,
    metrics: { dev: { kind: "maxdev", range: [100, 10000] } },
    target: target && target.curve,
  };
  const job = {
    space: { amend: { select: 1000, g: [0, 2, 1] } },
    constraints: [],
    objective: "minimize dev",
    top: 5,
  };
  assert.equal(Number.isFinite(run(job, ctx).top[0].score), true);
});
