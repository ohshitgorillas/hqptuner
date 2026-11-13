---
phase: 9
plan: 1
# Phase 9 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against findings F-029, F-030 and F-031, the Success Criteria and CONTEXT AC1-AC6.
requirements: []
files:
  - hqptuner/core/applyops.py
  - hqptuner/api/routes/apply.py
  - hqptuner/api/routes/preset.py
  - hqptuner/api/routes/config.py
  - hqptuner/api/routes/matrix/matrix.py
  - hqptuner/api/routes/pending.py
  - hqptuner/lanes/http/restore.py
  - hqptuner/presets/presetops.py
  - hqptuner/presets/store/filterpark.py
  - docs/architecture.md
  - CHANGELOG.md
  - .filepawl.toml
  - tests/support/fake_http.py
  - tests/apply/overlap/__init__.py
  - tests/apply/overlap/test_apply_queue.py
  - tests/apply/overlap/test_apply_keeps_restaged.py
  - tests/matrix/test_park_release.py
---

# Phase 9: Apply and store integrity - Plan 1: The apply lock and the selective clear

## Goal

Findings F-029, F-030 and F-031 are each fixed or carry an owner ruling. This plan closes F-029's fixable half: every lane that pushes `/restore` or reloads the engine waits its turn behind one lock instead of interleaving, and a converged apply clears from the pending buffer and the filter park only what it actually applied.

## Must be true when done

- While one apply is running, a second apply, a preset load or save, an engine apply, an uploaded restore or a speaker apply waits and then completes with its usual answer, never a 409 or a busy code, and the daemon receives the two operations' writes in sequence, never interleaved (AC1, D-01, D-02).
- LIVE writes (`/config/live`, `/volume`, live preset apply, matrix profile, auto-pilot), staging and discard never wait on that lock (D-02).
- A field staged during an apply, or re-staged with a new value, is still in `GET /api/config/pending` after that apply converges, holding its newest value; a field the apply carried and nobody touched is gone (AC2, D-08).
- A filter uploaded to the park during an apply is still parked after the apply converges; the uploads the apply carried are released (AC2, D-09).
- `scripts/gate.sh make check` prints `exit=0`.

## Context

- Locked: D-01 (queue, never refuse), D-02 (lock scope, taken once at the outermost user operation; `asyncio.Lock` is not reentrant), D-03 (the buffer stays one app-wide object; no per-client buffer appears in any task), D-08 (selective clear), D-09 (park clear), D-13 (no new module in `hqptuner/api/routes/`; race proofs force overlap with injected seams such as an `asyncio.Event` in the fake 8088 daemon, never sleeps).
- The lock lives on `ApplyOps` (`hqptuner/core/applyops.py`), the manager's write-dispatch collaborator, reached as `manager.applyops` by every route that takes it. Not on `ConnectionManager` itself: `docs/architecture.md` requires an addition to the manager to name why no collaborator could hold it, and `ApplyOps` can.
- `hqptuner/lanes/http/restore.py` sits at its filepawl allowance (410) and `hqptuner/api/routes/config.py` at its own (406): run `filepawl accept` whenever filepawl prints it (repo `CLAUDE.md`), which is why `.filepawl.toml` is leased.
- filepawl's dircount gate caps a test directory at 30 files and takes no allowance. `tests/apply` holds 30 and `tests/presets` 29, so the phase's new test files go in two new topic subdirectories, the way `tests/api/surface` and `tests/api/login` sit under `tests/api`: `tests/apply/overlap/` (Plan 1) and `tests/presets/integrity/` (Plans 2 to 4), each with an `__init__.py` as those siblings carry. Neither name is a stdlib or installed module, which a package root of that name would shadow. No existing test moves.
- Out: per-client buffers (D-03), rollback (D-04), LIVE writes behind the lock (D-02), any concurrency probe against the production daemon (scope boundary).

## Tasks

### Task 1: The staged apply holds one queueing lock

- **Files:** hqptuner/core/applyops.py, hqptuner/api/routes/apply.py, tests/support/fake_http.py, tests/apply/overlap/__init__.py, tests/apply/overlap/test_apply_queue.py, CHANGELOG.md
- **Reads:** hqptuner/core/applyops.py#ApplyOps, hqptuner/api/routes/apply.py#apply, hqptuner/api/routes/apply.py#_persist_after_apply, tests/support/fake_http.py
- **Decisions:** D-01, D-02, D-13
- **Pins:** tests/api/test_api_write.py::test_successful_http_apply_clears_staging_that_was_present_before_it
- **Action:** `ApplyOps` gains one `asyncio.Lock`, created in its constructor, so there is one per manager and so one per process. The `apply` route in `hqptuner/api/routes/apply.py` takes it and holds it for the whole user operation: from reading the staged set, through the preset switch, both lanes, the audit record, the clear, and `_persist_after_apply` (the named save's `_mirror` restore and the auto-save fold) returning. Nothing beneath the route takes it (`ApplyOps.apply`, `presetops.save_preset`, `presetlane.*`, `deps.with_autosave`), because `asyncio.Lock` is not reentrant and the save fold runs inside the hold. A request that arrives while the lock is held waits and then runs: no 409, no busy code, no timeout and no new refusal (D-01). The existing `NothingStagedError` check stays where it is, before the wait, so a queued apply never meets a refusal it did not meet on arrival; once the lock is held, the staged set is read as it stands at that moment, so an apply queued behind one that already landed its fields applies what is staged then rather than re-applying the first one's fields. `config_live`, stage and discard never take the lock (D-02). In the same commit, land the owner-approved `### Security` bullet under `[Unreleased]` in `CHANGELOG.md` verbatim (Notes); if the approved wording is not in hand when this task runs, stop and ask, never draft it into the file. `tests/support/fake_http.py` may gain a way to hold one `/restore` answer on an awaited event, if its existing `_on_restore` hook (a plain callable) cannot hold it; that is suite support, not a mock of HQPTuner code (`docs/testing.md` rule 4).
- **Verify:** Testing scope: the outcome is AC1 for two staged applies; nothing in the suite covers concurrent applies today. Add the smallest REST-lane checks over the in-process fake 8088 daemon, whose `/restore` answer for the first apply is held on an injected `asyncio.Event` while the second apply is sent: (a) the daemon's record of `/restore` pushes shows every push of the first apply before the first push of the second, (b) the second apply answers its usual success status, not 409. Both must go red against the pre-change code (bite run, `docs/testing.md` rule 8). No sleep and no wall-clock wait (D-13, rule 7). Stop there; the LIVE exclusion is held by the Action, since a test of it is green before and after. `scripts/gate.sh make check` prints `exit=0`, including the suite-time gate; `scripts/gate.sh .venv/bin/python scripts/gates/check_changelog.py` prints `exit=0`, and the bullet in `CHANGELOG.md` matches the approved text character for character.

### Task 2: The preset load and save, engine apply, uploaded restore and speaker apply queue behind the same lock

- **Files:** hqptuner/api/routes/preset.py, hqptuner/api/routes/config.py, hqptuner/api/routes/matrix/matrix.py, tests/apply/overlap/test_apply_queue.py, .filepawl.toml
- **Reads:** hqptuner/api/routes/preset.py#profile, hqptuner/api/routes/config.py#engine_apply, hqptuner/api/routes/config.py#restore, hqptuner/api/routes/matrix/matrix.py#speakers_apply, hqptuner/lanes/settle.py#restore
- **Decisions:** D-01, D-02, D-13
- **Pins:** tests/presets/test_backup_persist.py::test_a_failed_backup_aborts_a_load_before_any_restore
- **Action:** Each remaining lane of D-02 takes the lock Task 1 added, once, at its route handler, and holds it to the end of the daemon work. `profile` holds it for `load` and for `save` (the save's `_mirror` restore); `delete` does not take it, since `profile/delete` neither restores nor reloads. `engine_apply` holds it around `applyops.apply_engine` and `deps.with_autosave`. `restore` holds it from `settle.mark_connect` through `settle.await_ready`; the upload read, the audit record, the archive checks and the carried-descriptions merge stay before the hold, because they touch no daemon and a refused upload is refused at once. `speakers_apply` holds it around `speakerprocessing.apply` and `deps.with_autosave`, since that lane reloads the engine. Each waits and then runs, with no new refusal (D-01). Nothing below a route takes the lock (D-02). Every other route stays outside it: live preset apply, matrix profile, `/volume`, the auto-pilot routes, preset delete (D-02).
- **Verify:** Testing scope: AC1 for every lane D-02 names other than the staged apply; uncovered today. Extend `tests/apply/overlap/test_apply_queue.py` with one check per lane, parametrized over preset load, preset save, engine apply, uploaded restore and speaker apply: with a staged apply's `/restore` held on an injected `asyncio.Event`, the lane's first daemon write (`/restore`, or the `/speakers` form POST) reaches the fake daemon only after the held apply's last push, and the lane then answers its usual success status. Each case goes red against the pre-change code. No sleep. Stop there. `scripts/gate.sh make check` prints `exit=0`; `filepawl accept` was run if filepawl printed it.

### Task 3: An apply clears from the pending buffer only what it applied

- **Files:** hqptuner/api/routes/pending.py, hqptuner/api/routes/apply.py, tests/apply/overlap/test_apply_keeps_restaged.py
- **Reads:** hqptuner/api/routes/pending.py#PendingStore, hqptuner/api/routes/apply.py#apply, hqptuner/api/routes/apply.py#_apply_staged, hqptuner/static/store/actions.js
- **Decisions:** D-03, D-08, D-13
- **Pins:** tests/api/test_api_write.py::test_successful_http_apply_clears_staging_that_was_present_before_it, tests/api/test_api_write.py::test_a_discard_or_a_later_drop_empties_the_pending_buffer_a_stage_filled
- **Action:** The apply runs on its own copy of the staged set, not on `store.http` and `store.live`: today `_apply_staged` is handed the buffer's own dicts, so a stage during the apply mutates what the apply is running on. Copy the `http` dict and each live argument bucket. After an apply that `apply_succeeded` judges converged, remove from the `PendingStore` only the entries of that copy whose buffered value still equals the value applied: an `http` field by its value, a live key by its whole argument bucket (`PendingStore.stage` replaces a live bucket whole, so the bucket is the unit). A field staged during the apply, or re-staged with a new value, stays staged. The decision of which entries go is one function whose return value is that decision (`docs/testing.md` rule 17), and `PendingStore` executes it, inside `hqptuner/api/routes/pending.py` (no new module in `api/routes/`, D-13). A soft failure keeps the whole buffer, as today. `PendingStore.clear` stays for discard. The audit record keeps reading the copy. The buffer stays one app-wide object (D-03). The SPA re-reads pending after every apply (`static/store/actions.js`), so no client change and no new text.
- **Verify:** Testing scope: AC2's buffer half. Covered already: a field applied and untouched is cleared (the pinned test), and a soft failure keeps the buffer. Add REST-lane checks in the new file, each with a staged apply's `/restore` held on an injected `asyncio.Event` while a second stage request is sent: (a) a new field staged during the apply is in `GET /api/config/pending` after it converges, (b) a field re-staged with a new value during the apply holds that new value afterwards, (c) a live key staged during the apply is still staged afterwards. Each goes red against the pre-change code. Stop there. The pinned tests stay green; `scripts/gate.sh make check` prints `exit=0`.

### Task 4: The filter park releases only the uploads an apply carried

- **Files:** hqptuner/presets/store/filterpark.py, hqptuner/presets/presetops.py, hqptuner/lanes/http/restore.py, hqptuner/core/applyops.py, tests/matrix/test_park_release.py, .filepawl.toml
- **Reads:** hqptuner/presets/presetops.py#after_restore, hqptuner/presets/presetops.py#PresetOps.parked_filter_members, hqptuner/presets/store/filterpark.py#FilterPark, hqptuner/lanes/http/restore.py#_restore_once, hqptuner/lanes/http/restore.py#apply, hqptuner/core/applyops.py#ApplyOps.apply
- **Decisions:** D-09, D-13
- **Pins:** tests/matrix/test_filter_upload.py::test_an_apply_clears_the_parking_area_only_when_it_succeeds, tests/matrix/test_filter_upload.py::test_parked_filter_rides_the_restore_archive
- **Action:** An apply reads the park once, before its first restore pass, and every pass carries that same set; today `_restore_once` reads `parked_filter_members()` afresh each pass, so an upload landing between passes rides pass 2. After a converged apply, `after_restore` releases exactly the files that set held, each only where the parked file still holds the bytes carried, so a discard during the apply followed by a new upload under the same name keeps the new upload. An upload parked during the apply stays parked for the next one. A carried file the release finds already gone (a discard ran meanwhile) is not an error. The carried set travels from `ApplyOps.apply` to the restore lane and to `after_restore` as call arguments, never as a field of `RestoreResult` or `ApplyReport`, whose fields are wire keys (`docs/openapi.json` stays unchanged). Discard keeps releasing the whole park through `clear_parked_filters` (unchanged). Existing direct callers of `restore.apply` in the suite keep working. Run `filepawl accept` when filepawl prints it.
- **Verify:** Testing scope: AC2's park half. Covered already: the carried upload is released on success and kept on a refusal (the pinned test). Add one REST-lane check: with an apply's first `/restore` held on an injected `asyncio.Event`, a filter uploaded through `POST /api/matrix/filter` is still parked after the apply converges. It goes red against the pre-change code, which empties the park. Stop there. `scripts/gate.sh make check` prints `exit=0`; `filepawl accept` was run if filepawl printed it.

### Task 5: The architecture records the write-lane lock and the selective clear

- **Files:** docs/architecture.md
- **Reads:** docs/architecture.md
- **Decisions:** D-01, D-02, D-08, D-09
- **Action:** `docs/architecture.md` carries the new normative rules beside the restore-lane paragraph: one lock serializes every lane that pushes `/restore` or reloads the engine (the D-02 list), taken once at the route, queueing and never refusing; LIVE writes, stage and discard stay outside it; a converged apply clears only the buffer entries and parked uploads it applied. State rules, not history (the `triviajudge` plugin judges every added line). Soft-wrapped, written with `Edit`.
- **Verify:** `.venv/bin/python .claude/hooks/md-softwrap.py --check docs/architecture.md` exits 0; the `triviajudge` Stop hook raises no flag on the added lines; the added text names the six D-02 lanes and the LIVE exclusion. A `docs/` edit runs its own gate only.

## Notes

- **Owner approvals needed before execution, gathered in one request before Plan 1 starts.** (1) The `CHANGELOG.md` `[Unreleased]` `### Security` bullet for the whole phase, verbatim, landed by Task 1. Planner's proposal, for the owner to replace: `- **Settings staged while an apply runs are kept**, overlapping applies take turns, the last five pre-apply backups are kept, and HQPTuner's saved files survive a crash mid-save.` (2) Plan 2's rulings Q1 and Q2 (Plan 2 Notes). (3) A quotable ruling for F-031's "the API can't repair the store and it takes a disk edit" clause, which D-11 keeps unchanged with no owner quote on record; Plan 5 quotes it in the disposition. No other user-facing text is planned: D-01 adds no refusal, D-10 reuses the existing downstream refusals, and Tasks 3 and 4 change nothing the SPA renders.
- **Changelog timing, for the owner's ruling with (1).** A phase-wide bullet landed in Task 1 claims retention and crash safety that Plans 2 to 4 deliver later, so it is ahead of the code at that commit. The owner picks one: the single bullet lands here as planned; or one approved bullet per plan, each landed in that plan's first behavior task (repo `CLAUDE.md`: entry in the same commit as the change). The task that lands each bullet is recorded here before execution, and Plan 5's check reads it.
- **Run order.** The five plans run 1, 2, 3, 4, 5. They share files (`hqptuner/presets/presetops.py`, `hqptuner/lanes/http/restore.py`, `hqptuner/core/applyops.py`, `docs/architecture.md`, `.filepawl.toml`), so each names the earlier ones in `depends_on` and `/cad-execute` runs them in sequence.
- **Plan graph deviation.** The plan-graph guidance puts test-pin and size-budget edits in one last plan. Here each superseded test is replaced in the task whose behavior supersedes it (Plan 2), and `filepawl accept` runs in the task that grows the file, because a gate may never be red at a commit (`~/dev/CLAUDE.md` 11.4).
- **Recalled memory.** D-01 and D-06/D-07 recalled from phases/9/CONTEXT.md (phase 9) are the decisions this plan and Plans 3 and 4 implement. The branch-coverage margin (phases/1/UAT.md, phase 1) applies to every new test file here.
