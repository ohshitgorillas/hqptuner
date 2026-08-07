// Behavioral suite for scripts/eqlab/search.js — validation of the search
// space itself. Written blind from a spec block: no eqlab source was read.
//
// Contract under test: a search job with a missing or malformed `space` fails
// immediately with an error naming `search: job.space`; sweep keys placed
// directly under the job (instead of under `job.space`) are named in that
// error; a `space` that declares no changes fails rather than sweeping
// nothing; and a valid non-empty space keeps working exactly as before.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/eqlab/eqlab-search-space-guard.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { searchJob } from "../../../scripts/eqlab/search.js";
import { FS, band } from "../support/eqlab-helpers.js";

// One band at 1 kHz and one metric reading the curve right there — the same
// minimal panel the main search suite uses.
const CTX = { stages: [band(1000, 0, 1)], fs: FS, metrics: { spot: { kind: "at", f: 1000 } } };
const SPACE = { amend: { select: 1000, g: [1, 3, 1], q: 1 } };
const jobOf = (over) => ({ space: SPACE, constraints: [], objective: "maximize spot", top: 5, ...over });

// --- missing / wrong-type space ---------------------------------------------

test("test_a_search_job_without_a_space_is_rejected_naming_job_space", () => {
  assert.throws(() => searchJob(jobOf({ space: undefined }), CTX), /search: job\.space/);
});

test("test_a_search_job_with_no_space_key_at_all_is_rejected_naming_job_space", () => {
  const job = { constraints: [], objective: "maximize spot", top: 5 };
  assert.throws(() => searchJob(job, CTX), /search: job\.space/);
});

test("test_a_search_job_whose_space_is_null_is_rejected_naming_job_space", () => {
  assert.throws(() => searchJob(jobOf({ space: null }), CTX), /search: job\.space/);
});

test("test_a_search_job_whose_space_is_an_array_is_rejected_naming_job_space", () => {
  assert.throws(() => searchJob(jobOf({ space: [SPACE] }), CTX), /search: job\.space/);
});

test("test_a_search_job_whose_space_is_a_string_is_rejected_naming_job_space", () => {
  assert.throws(() => searchJob(jobOf({ space: "amend" }), CTX), /search: job\.space/);
});

// --- sweep keys misplaced directly under the job ----------------------------

test("test_a_misplaced_amend_under_the_job_is_named_and_pointed_at_job_space", () => {
  assert.throws(
    () => searchJob(jobOf({ space: undefined, amend: SPACE.amend }), CTX),
    /^(?=[\s\S]*amend)(?=[\s\S]*job\.space)/,
  );
});

test("test_misplaced_replace_and_append_under_the_job_are_both_named", () => {
  assert.throws(
    () =>
      searchJob(
        jobOf({
          space: undefined,
          replace: { select: 1000, type: "peak", f: 1000, q: 1, g: 2 },
          append: { type: "peak", f: 4000, q: 1, g: 1 },
        }),
        CTX,
      ),
    /^(?=[\s\S]*replace)(?=[\s\S]*append)(?=[\s\S]*job\.space)/,
  );
});

// --- space present but declaring no changes ---------------------------------

// The spec fixes only that the message is clear, not its exact wording; the
// regex pins the search-error family plus the load-bearing word "space".
test("test_an_empty_space_object_is_rejected_rather_than_sweeping_nothing", () => {
  assert.throws(() => searchJob(jobOf({ space: {} }), CTX), /search:[\s\S]*space/);
});

test("test_a_space_of_only_empty_arrays_is_rejected_rather_than_sweeping_nothing", () => {
  assert.throws(() => searchJob(jobOf({ space: { amend: [], append: [] } }), CTX), /search:[\s\S]*space/);
});

// --- valid jobs unaffected ---------------------------------------------------

test("test_a_valid_search_job_with_a_non_empty_space_still_returns_survivors", () => {
  assert.equal(searchJob(jobOf(), CTX).survived, 3);
});
