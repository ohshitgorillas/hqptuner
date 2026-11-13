---
phase: 2
plan: 2
requirements:
  - BUG-02
files:
  - hqptuner/lanes/live/lane.py
  - tests/live/test_live_stop_report.py
  - docs/spec/openapi.json
  - docs/spec/api.md
  - hqptuner/static/store/live/state.js
  - hqptuner/static/store/ui/wirelabels.js
  - tests/js/store/live/live-stop.test.js
---

# Phase 2: Modulators fit the output rate - Plan 2: A live apply that stops playback reports a failure

## Goal

A live apply that makes playback stop reports the stop to the user as a failed apply instead of ok.

## Must be true when done

- A live write through `/api/config/live` during which the engine goes from playing (`State.state` 2) to stopped (0) or stop requested (3) shows the user a failure, the owner-approved stop line, and not ok.
- A live snapshot apply during which playback stops the same way shows the user that failure too.
- A live apply made while playback is not playing (stopped, paused, or stop requested) reports no stop, and one that leaves playback playing or paused reports no stop.
- The live lane's answer carries the stop on `LiveApplyReport` for every caller of the lane, autopilot included, and the OpenAPI snapshot shows the new field.
- `scripts/gate.sh make check` prints `exit=0`.

## Context

- CONTEXT D-02 (a stop is a failed apply, reported as a failure and not as a success with a side note), D-07 (the stop line is owner-approved copy, verbatim, no em dash), D-08 (detected once, in `_apply_batch`, from the `State` re-read `refresh_after_live` already makes; playing 2 before the batch, 0 or 3 after it; no settle window), D-09 (backend through the fake 4321 daemon of `tests/live/`, no wall-clock wait) bind this plan.
- Both client paths already turn a report into an error line through one function, `reportError` in `hqptuner/static/store/live/state.js`: `writeLive` in `hqptuner/static/store/live/write.js` and `applyLivePreset` in `hqptuner/static/store/live/presets.js`. The stop joins that path, so neither caller changes.
- History rule: these are edits to live files, not rebuilds from spec; no agent reads any file's content from another commit.
- No `CHANGELOG.md` entry: the v2 changelog is the owner's alone until handed back (repo CLAUDE.md).

## Tasks

### Task 1: The live lane's report says when playback stopped under the batch

- **Files:** hqptuner/lanes/live/lane.py, tests/live/test_live_stop_report.py, docs/spec/openapi.json, docs/spec/api.md
- **Reads:** hqptuner/lanes/live/lane.py#_apply_batch, hqptuner/lanes/live/lane.py#refresh_after_live, hqptuner/lanes/live/lane.py#apply_preset, hqptuner/lanes/live/lane.py#LiveApplyReport, hqptuner/engine/trackcontext.py#PLAYING, hqptuner/engine/view.py#EngineView, tests/support/fake_control.py#OnNextArrival, tests/support/fake_control.py#serve_shared, tests/conftest.py#live_manager, tests/live/test_live_reenumeration_report.py, tests/live/test_live_after_write_reads.py, docs/spec/protocol.md#State, docs/spec/api.md#Lane reports in a 200 body, docs/spec/testing.md
- **Decisions:** D-02, D-08, D-09
- **Pins:** tests/live/test_live_reenumeration_report.py, tests/live/test_live_after_write_reads.py, tests/live/test_live_mode_first.py, tests/live/test_live_presets.py
- **Action:** Tests first through the fake 4321 daemon over a real socket (`tests/live/`, D-09): a command hook on the setter the batch sends moves the fake's `state` entry, a table edit and not logic (`docs/spec/testing.md` rule 13), and no test waits on a clock. The units and values are the test writer's. Bite: add the new report field first as a null stub that always says no stop, and show the stop cases fail by assertion before the detection is written (rule 8). The behavior the owner wants (D-08): `_apply_batch` reads the engine's `State.state` from `mgr.readings` before it writes, and compares it with what the `State` re-read inside `refresh_after_live` put there; playing (2, `PLAYING` in `hqptuner/engine/trackcontext.py`) before and 0 or 3 after is a stop, and the batch's `LiveApplyReport` carries it. Every other pair is no stop, a pause (1) included. Use that one re-read, not the later one `_after_mode` makes, and add no second read, settle window or wait. A refused or failed re-read leaves the last good reading in place, so it reports no stop, and that is not an error. Name the field `playback_stopped`; Task 2 depends on that name. `apply_preset` merges its two batches' answers, so its report says stopped when either batch did. `/api/config/live`, the live snapshot apply route and autopilot (`hqptuner/core/autopilotops.py`) all receive the field through `LiveApplyReport`, and none of them changes. The report stays a frozen dataclass with one result per field (rule 17): the stop is its own boolean, never folded into `live` entries or `reenumerated`. Keep the import layering (`lanes` may import `engine`). Regenerate the OpenAPI snapshot with `.venv/bin/python scripts/gates/check_openapi.py --write`. Add one sentence under "Lane reports in a 200 body" in `docs/spec/api.md` saying a live report also says whether playback stopped under the batch, and that a client reports that as a failed apply. Write it with `Edit`, soft-wrapped, no em dash.
- **Verify:** `scripts/gate.sh .venv/bin/pytest --no-cov -q tests/live/test_live_stop_report.py tests/live/test_live_reenumeration_report.py tests/live/test_live_after_write_reads.py tests/live/test_live_mode_first.py tests/live/test_live_presets.py` prints `exit=0`. The new file against the null stub fails by assertion on its stop cases (quote the shortest decisive line). `scripts/gate.sh .venv/bin/python scripts/gates/check_openapi.py` prints `exit=0`. `scripts/gate.sh .venv/bin/lint-imports` prints `exit=0`. Testing scope: outcomes are playing then stopped reports a stop, playing then stop requested reports a stop, playing then still playing does not, playing then paused does not, not playing before does not, and a preset whose mode batch or rest batch stopped playback reports the stop. Existing suites cover readback verdicts, re-enumeration and the refused-read path, so those are not retested. Testing stops there; the route only serializes the dataclass, and the OpenAPI gate covers its shape.

### Task 2: The client shows a stopped playback as a failed apply

- **Files:** hqptuner/static/store/live/state.js, hqptuner/static/store/ui/wirelabels.js, tests/js/store/live/live-stop.test.js
- **Reads:** hqptuner/static/store/live/state.js#reportError, hqptuner/static/store/live/state.js#LiveReport, hqptuner/static/store/ui/wirelabels.js#liveFailureText, hqptuner/static/store/live/write.js#writeLive, hqptuner/static/store/live/presets.js#applyLivePreset, hqptuner/static/store/core/ops.js#op, tests/js/store/live/live.test.js#liveWire, tests/js/support/wire/livepresetwire.js, tests/js/store/live/livepresets.test.js, .claude/skills/copy-rules/SKILL.md, docs/spec/testing.md
- **Decisions:** D-02, D-07, D-09
- **Pins:** tests/js/store/live/live.test.js, tests/js/store/live/live-reenum.test.js, tests/js/store/live/livepresets.test.js
- **Action:** Load the `copy-rules` skill first. Put the stop-line candidates in this plan's Notes before the owner, and get the owner's approval of one wording in their own words before it is written anywhere; that string ships character for character, no em dash (D-07). Then tests first, red against the current code, through the existing seams: `liveWire` in `tests/js/store/live/live.test.js` (its `report` seam) for `writeLive`, and `tests/js/support/wire/livepresetwire.js` (its `report` config) for `applyLivePreset`; the units and assertions are the test writer's. The behavior the owner wants (D-02): a report carrying Task 1's `playback_stopped` field set true makes `reportError` return a failure line, so `writeLive` fails its `liveOp` and `applyLivePreset` sets its error, exactly as an unverified setter does today. The stop is a failure, not a side note on a success. A report with no stop, or with the field false, behaves as today. Where a report carries both failed setters and a stop, the user sees both. Put the approved line beside the other live failure lines, in `wirelabels.js` or `state.js`, the executor's choice, and add the field to the `LiveReport` typedef. Do not change `writeLive`, `remirrorLive` or `applyLivePreset`: they already raise whatever `reportError` returns.
- **Verify:** `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live/live-stop.test.js tests/js/store/live/live.test.js tests/js/store/live/live-reenum.test.js tests/js/store/live/livepresets.test.js` prints `exit=0`, and the new file alone at the parent commit fails by assertion (quote it). Human-verify: the owner approved the stop line verbatim in their own words before it was written. Testing scope: outcomes are a stop on a live write fails the write, a stop on a snapshot apply fails the apply, and a report without a stop leaves both ok. Assert the failure state (the op's error, the preset error being set), never the line's text (rule 9). Existing suites cover unverified setters and re-mirroring. Testing stops there.

### Task 3: The gate is green and the owner has the hand-back

- **Reads:** .claude/task-check.sh, .claude/skills/hand-back/SKILL.md
- **Action:** Run the offline gate over the whole plan, then `/task-check`, because `hqptuner/` changed. Load the `hand-back` skill first and give the owner the hand-back URL. Do not reproduce a stop against the production daemon: an above-floor modulator written mid-play stops the owner's playback and Roon drops its queue (CONTEXT flagged assumptions), which is damage under the prime directive. The tests through the fake daemon are this plan's evidence; the owner may check it on their own playback if they choose. A red gate goes back to the task that owns the failing path, never to an exemption.
- **Verify:** `scripts/gate.sh make check` prints `exit=0`. `bash .claude/task-check.sh` prints a healthy `:8090` check and the hand-back URL, passed to the owner.

## Notes

- Stop-line candidates for Task 2 (owner picks or rewrites; none ships unapproved): "Playback stopped after this change."; "HQPlayer stopped playing after this change."; "This change stopped playback.". None of them names a cause, because the report does not know why playback stopped.
- CONTEXT's fourth flagged assumption: the plan holds D-08 as locked, with one post-write `State` read and no settle window. If the stop shows up later than that read, AC3 needs an injectable-clock settle window and the plan goes back to the owner. No task adds one.
- Risk, by D-08 as written: a mid-play mode switch pauses audio briefly (`docs/spec/protocol.md`, mode switching). If `State.state` reads 0 or 3 in that pause, a snapshot apply that switches mode reports a stop. Nothing in the repo has measured this, and no probe is planned, because it needs live playback on Opal. The plan accepts this risk under D-08 and puts it to the owner at plan time, not after execution.
- The "before" reading is the heartbeat's: the loader re-reads `State` on every pass (`hqptuner/core/loader.py:265`, every `status_interval`), so it is at most one interval old. A playback that stopped by itself inside that interval and then took a live apply reports a stop it did not cause; one that started inside that interval and was then stopped by the apply reports none. Both fall under D-08's single read, and no task adds a second one.
- Plan-checker fold (gate task kept): Task 3 stays a task of its own because the repo requires `/task-check` and a hand-back after any `hqptuner/` edit, and this is where they run.
- Execution order: `/cad-execute` should get the owner's approval of this plan's stop line (Task 2) and Plan 1's reason (Task 1) up front, so neither plan stalls midway.
