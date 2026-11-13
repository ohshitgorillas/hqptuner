---
phase: 1
status: complete
completed: 2026-11-10
---

# Phase 1: Snapshots stay on their stations - Summary

A snapshot save now sends a DELETE only for a rename in a station that stays ticked, so saving to another station leaves the snapshot on its own station, and the builders' `savedTo` model drops its move-out branch and `keep` option.

## What shipped

- Save sends no DELETE for a station that was not ticked - `hqptuner/static/store/faceplate/builders/shell.js` (`write`)
- `savedTo` has no move branch and no `keep` option - `hqptuner/static/model/builders/builder.js`, caller in `hqptuner/static/store/faceplate/builders/profile-save.js`
- The live-preset wire fake keeps a list per station (PUT writes the named stations, DELETE removes only `?station=`) - `tests/js/support/wire/livepresetwire.js`
- Tests for saving to another station, with and without a rename, and for unticking a station that keeps its record - `tests/js/store/faceplate-builders/shell.test.js`, `tests/js/model/builders/builder.test.js`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | 8a507170 | A snapshot save no longer deletes from stations it was not ticked for |
| 1 | 2 | 6c67c626 | `savedTo` drops the move-out rule and the `keep` option |

## Deviations

None - plans executed as written.

## Open items

None. The executor reported one item: the Task 2 commit was first made as `refactor(1-2)`. It was amended to the dispatched scope `1-1` before the report, so `6c67c626` already carries the right scope.

## Goal check

The two commits plausibly deliver the goal. In `shell.js`, `gone` is now `from.name !== NEW && from.name !== name && to.includes(from.st)` (`git diff 435ab740..HEAD`), so a station that was not ticked never gets a DELETE. The DELETE fires only for a rename in a station that stays ticked, which keeps the unchanged rename-in-place behavior. In `builder.js`, `savedTo` lost the line that removed the record from an unticked own station, and `keep` is gone from its signature and from both callers. Bite proofs are in `reports/plan-1.md`: the two shell tests failed against the old `write` ('Warm' missing from Day), and `test_unticking_its_own_station_leaves_the_record_there` failed against the old model. `make check` exited 0 after the last edit, and `/task-check` passed (rebuilt, `:8090` served 200). The owner checked at the hand-back URL: a snapshot saved on A, with A unticked and B ticked, is listed under both A and B after Save. The `risk_surface` review of `435ab740..6c67c626` raised 0 findings. Nothing in the goal looks missing.

complete locally, not CI-verified
