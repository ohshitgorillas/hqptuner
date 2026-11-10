---
phase: 2
plan: 2
requirements: [INTG-01]
files:
  - .claude/worktrees/integrate/tests/js/store/faceplate/drawers-crossfeed.test.js
  - .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-crossfeed.test.js
  - .claude/worktrees/integrate/tests/js/model/store/reading.test.js
---

# Phase 2: Baseline recovery - Plan 2: Audit of WIP commit 6343d922

## Goal

The JS baseline in `.claude/worktrees/integrate` passes, through repaired test machinery and fixed production defects, with every valid claim unchanged (design step 12a). This plan settles the two things WIP commit `6343d922` left open: the asserts it renamed, and the untested engine-name behavior it added.

## Must be true when done

- Every assert `6343d922` renamed from `crossfeed_*` to `post_bauer_*` reads as it did before that commit, or its commit records the contract-mismatch route with before-and-after document quotations.
- A test fails when the `nameOf` change of `6343d922` is reversed in `hqptuner/static/model/store/reading.js`, and passes with it in place. The phase record shows both runs.
- Both crossfeed suites and `tests/js/model/store/reading.test.js` pass.

## Context

- Locked: D-11 (audit `6343d922`: renamed asserts take the contract-mismatch route or are reverted; `nameOf` gets a test with a red bite proof), D-03 (contract-mismatch uses `moved` only with actual before-and-after quotations), D-13, D-14. Source: `.planning/phases/2/CONTEXT.md`.
- Paths, file run, assert check, lint and BASE as in Plan 1's Context. Plan 1 Task 1 must be done before this plan starts.
- The renames: `tests/js/store/faceplate/drawers-crossfeed.test.js` changed `effective("crossfeed_enabled")` to `effective("post_bauer_enabled")` once. `tests/js/components/faceplate-drawers/drawers-crossfeed.test.js` did the same for `crossfeed_enabled` once and `crossfeed_preset` once (`git show 6343d922 -- <file>`). D-11 names the store file and describes both renames. The `_preset` rename is in the component file, so both files are audited.
- Evidence found at planning: `hqptuner/static/store/schema/postprocess.js` keeps the catalog key `crossfeed_enabled` with `field: "post_bauer_enabled"`. Production reads `crossfeed_*` throughout (`store/faceplate/drawers/crossfeed.js`, `store/xfeed/mode.js`). `store/core/readings.js` `field` resolves either name to one view. No document found renames the key.
- Repo rule: a plan names the behavior, not the test; unit, lane, assertion and values belong to the test writer (`docs/spec/testing.md` rules 8, 15, 17).

## Tasks

### Task 1: Restore the asserts 6343d922 renamed

- **Files:** .claude/worktrees/integrate/tests/js/store/faceplate/drawers-crossfeed.test.js, .claude/worktrees/integrate/tests/js/components/faceplate-drawers/drawers-crossfeed.test.js
- **Action:** Look for a before-and-after pair of document quotations that establishes `post_bauer_*` as the name `effective` is asked for. Search `docs/spec/api.md`, `docs/spec/faceplate.md` and the design. If none exists, which the planning evidence above indicates, revert the three renamed assert lines to their exact pre-`6343d922` text. Leave the seed migration `6343d922` made in both files (`fromFile`, `seedReadings`, metadata-only `matrixConfig.value`) as it stands. If such a pair does exist, keep the renames and put both quotations in the commit message under `Contract mismatch:`. Either way, the commit message states which route was taken and why.
- **Verify:** `git show 6343d922 -- <both files> | grep -E '^-.*assert'` lists three lines, and each appears verbatim in the file now, unless the commit message carries the `Contract mismatch:` quotations. A file run over both files prints `exit=0`. If a reverted assert then fails, it goes to `builder` with the test unchanged (D-03): stop and report the failing line rather than editing the test. Lint passes. Testing scope: the existing tests are the check; no new test.

### Task 2: Cover the engine-name behavior with a red-first test

- **Files:** .claude/worktrees/integrate/tests/js/model/store/reading.test.js
- **Action:** The behavior, in the owner's terms: a field's view names the engine's own name for the value it shows only while that value is the engine's current reading, meaning the reading shows the engine store, no drag is held, nothing is staged, and the engine store is stamped at or after the generation. Otherwise it names nothing. This is `nameOf` / `fieldOf` `name` in `hqptuner/static/model/store/reading.js`. The test writer adds the test to this pure suite and chooses the cases and values, splitting first if the behavior holds more than one result (rule 17). For the bite proof, reverse only `6343d922`'s change to `reading.js` with `git diff 6343d922^ 6343d922 -- hqptuner/static/model/store/reading.js | git apply -R`. Run the new test and keep the red output. Restore with `git checkout -- hqptuner/static/model/store/reading.js`, then confirm `git diff --quiet -- hqptuner/static/` before committing. No production file is committed.
- **Verify:** The commit message quotes the red run's decisive failing line and its log path from the reversed state, and the green run's `exit=0` from the restored state. After the commit, `git diff <BASE> -- hqptuner/` is empty. A file run over `tests/js/model/store/reading.test.js` prints `exit=0`. Lint passes. Testing scope: the outcomes are the name shown, and nothing named under each override (drag, staged, file shown, stale engine stamp). Nothing covers them today. The smallest set is what the test writer's split yields. The evidence is the red/green pair, and testing stops there.
