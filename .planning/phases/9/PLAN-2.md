---
phase: 9
plan: 2
depends_on: [1]
# Phase 9 maps no requirement ID (ROADMAP: "Requirements: None"); this plan closes F-030's fixable half (CONTEXT AC3).
requirements: []
files:
  - hqptuner/presets/presetops.py
  - hqptuner/lanes/http/restore.py
  - hqptuner/core/applyops.py
  - docs/architecture.md
  - .filepawl.toml
  - tests/presets/integrity/__init__.py
  - tests/presets/integrity/test_safety_copies.py
  - tests/presets/test_backup_persist.py
  - tests/apply/test_http_apply.py
  - tests/audit/test_audit_wiring.py
  - CHANGELOG.md
---

# Phase 9: Apply and store integrity - Plan 2: The safety copies

## Goal

Findings F-029, F-030 and F-031 are each fixed or carry an owner ruling. This plan closes F-030's fixable half: each user operation writes one safety copy holding the daemon's state before its first restore, copies are dated and the five most recent are kept, and bytes that are not a readable settings archive never replace a stored copy.

## Must be true when done

- One apply that takes two restore passes leaves exactly one new safety copy in `backup_dir`, and it holds the pre-apply state, not pass 1's result (AC3, D-05).
- An apply whose preset switch loaded a preset leaves one copy, the one the load took; an apply after an unload ("(no preset)") still leaves its one copy (D-05).
- After six copying operations, the five most recent copies remain and the oldest is gone; the parked filter uploads under `backup_dir` are untouched (AC3, D-05).
- An empty or non-zip `/backup` body replaces no stored copy, and the operation fails through the refusal it already had, with no new text (AC3, D-10).
- `scripts/gate.sh make check` prints `exit=0`.

## Context

- Locked: D-04 (no rollback; an unconverged apply returns its report and keeps the buffer, as today), D-05 (one copy per operation, dated from `mgr.clock`, last 5 kept), D-10 (copy validation), D-12 (superseded tests named, never edited quietly), D-13.
- Today `PresetOps._write_backup` writes `backup_dir/pre-apply-settings.zip` for all three callers (`persist_backup_for_load`, `persist_backup_for_apply`, `persist_backup_for_restore`), and `restore._restore_once` calls `persist_backup_for_restore` on every pass.
- The phase 8 ruling D-04 stands: no copy before an uploaded `/api/restore` (owner: "smells like scope expansion", phases/8/CONTEXT.md, phase 8).
- Superseded tests (D-12), each replaced in the task named and listed in that task's commit message as superseded: `tests/presets/test_backup_persist.py::test_persist_backup_writes_the_archive_to_disk` and `::test_persist_backup_raises_when_the_directory_is_unwritable` (Task 1: both write `b"archive-bytes"`, a non-zip, which D-10 now refuses to store); `tests/apply/test_http_apply.py::test_the_pre_apply_backup_is_written_to_disk` (Task 2: pins the fixed slot name); `tests/audit/test_audit_wiring.py` `stray_files` (Task 2: names the fixed slot as the one documented backup artifact). `tests/presets/test_state_export.py` lines 100 and 146-150 write their own `pre-apply-settings.zip` into `backup_dir` and test the export of whatever that directory holds, not the slot; they stay unchanged and green.

## Tasks

### Task 1: Bytes that are not a readable settings archive never replace a stored copy

- **Files:** hqptuner/presets/presetops.py, tests/presets/integrity/__init__.py, tests/presets/integrity/test_safety_copies.py, tests/presets/test_backup_persist.py, .filepawl.toml
- **Reads:** hqptuner/presets/presetops.py#PresetOps._write_backup, hqptuner/conf/presetzip.py#list_members, hqptuner/conf/presetzip.py#is_archive, hqptuner/conf/engineconf.py#base_config_xml
- **Decisions:** D-10, D-12
- **Pins:** tests/presets/test_backup_persist.py::test_a_failed_backup_aborts_a_load_before_any_restore
- **Action:** Before writing, `_write_backup` decides whether the bytes are a readable settings archive, and writes nothing when they are not. Planner's choice of test: a zip whose directory lists, read through the conf layer's existing reader (`presetzip.list_members` raising `UnreadableArchiveError`), which refuses an empty body and a non-zip, the two cases F-030 names. The decision is one function whose return value is the decision (`docs/testing.md` rule 17). When nothing is written, the operation goes on and fails at the refusal it already has downstream (`engineconf.base_config_xml` in the load, the restore pass's archive build, the engine lane's zip edit): no new error class, no new code, no new text (D-10). A failed write of a readable archive still raises its `BackupFailedError` subclass and stops the operation, as today. Replace the two superseded tests (Context) with tests that feed a readable archive, so the write and the unwritable-directory refusal stay pinned.
- **Verify:** Testing scope: AC3's validation clause. Covered already: a failed write aborts a load before any restore (pinned). Add, parametrized over an empty body and a non-zip body served as the fake daemon's `/backup`: a stored copy already in `backup_dir` is byte-identical after the operation. It goes red against the pre-change code, which overwrites it. Stop there; the downstream refusal is unchanged and needs no new check. The two replacement tests are green; `scripts/gate.sh make check` prints `exit=0`; `filepawl accept` was run if filepawl printed it.

### Task 2: Safety copies are dated and the five most recent are kept

- **Files:** hqptuner/presets/presetops.py, tests/presets/integrity/test_safety_copies.py, tests/apply/test_http_apply.py, tests/audit/test_audit_wiring.py, .filepawl.toml, CHANGELOG.md
- **Reads:** hqptuner/presets/presetops.py#PresetOps._write_backup, hqptuner/core/clock.py#Clock, hqptuner/presets/store/filterpark.py#PARK_DIR, tests/support/virtual_clock.py
- **Decisions:** D-05, D-12, D-13
- **Pins:** tests/presets/test_state_export.py::test_parked_filter_uploads_are_left_out_of_the_backups
- **Action:** Each copy is a new file in `backup_dir`, named from `mgr.clock.now()` (reached through `PresetOps`' manager, so the suite's virtual clock names them), never overwriting an existing copy: two copies taken at the same instant both survive. Planner's naming choice (Notes Q2): the stem `pre-apply-settings-`, a UTC stamp that sorts lexically in time order, a fixed-width zero-padded serial carried on every name (the first copy at an instant takes the lowest), and `.zip`, so a plain name sort is creation order even when copies share an instant. After a successful write, the five most recent dated copies are kept and older ones removed; the count is one named constant. Which copies go is one function whose return value is the decision (rule 17). The prune touches only files matching the dated pattern at the top level of `backup_dir`: never the park (`PARK_DIR`), never the fixed `pre-apply-settings.zip` an earlier version wrote, which stays in place outside the count (Notes Q2), never anything else. A prune the filesystem refuses after a good write is logged and does not fail the operation, since the new copy is already on disk; a failed write still raises as today. Replace the superseded `test_the_pre_apply_backup_is_written_to_disk` with a check that an apply leaves a new dated copy holding a readable archive, and update `stray_files` in `tests/audit/test_audit_wiring.py` so its documented artifacts are the dated copies; name both in the commit message as superseded (D-12). In the same commit, land Plan 2's owner-approved `### Security` bullet in `CHANGELOG.md` verbatim (Plan 1 Notes).
- **Verify:** Testing scope: AC3's retention clause. Not covered today. Add, at the presets lane with the virtual clock advanced between copies: (a) after six copies, the set of copies left is the five most recent, (b) two copies taken at the same instant both exist, and with five older copies already present the prune keeps the later of the two. Both go red against the pre-change single slot. The prune's reach (park and legacy slot untouched) is held by the Action, not by a test: a check of it is green against the pre-change code, which prunes nothing, so it cannot bite (`docs/testing.md` rule 8). Stop there. The pinned state-export test stays green; `scripts/gate.sh make check` prints `exit=0`; `filepawl accept` was run if filepawl printed it.

### Task 3: Each user operation writes one copy, before its first restore

- **Files:** hqptuner/lanes/http/restore.py, hqptuner/core/applyops.py, tests/presets/integrity/test_safety_copies.py, .filepawl.toml
- **Reads:** hqptuner/lanes/http/restore.py#apply, hqptuner/lanes/http/restore.py#_restore_once, hqptuner/core/applyops.py#ApplyOps.apply, hqptuner/core/applyops.py#_persistent_apply, hqptuner/presets/presetlane.py#load, hqptuner/presets/presetlane.py#unload
- **Decisions:** D-02, D-05
- **Pins:** tests/presets/test_backup_persist.py::test_apply_with_switch_to_lands_staged_edits_on_top_of_the_preset
- **Action:** A staged apply writes one copy, the daemon's state before its first restore. In `restore.apply`, the first pass whose `/backup` arrives writes it from those same bytes, with no extra fetch, and later passes write none. A pass that failed before writing any copy (its backup fetch dropped) leaves the next pass to write it: no restore has been pushed yet, so that backup is still the pre-apply state. An apply whose preset switch loaded a preset (`switch_to` non-empty: `presetlane.load` wrote the copy before its own restore) writes none in its restore passes. Whether the operation already holds its copy is passed down from `ApplyOps.apply`. It is not read from `restore.apply`'s `switched` flag, which is also true for an unload (`switch_to == ""`, `presetlane.unload`, which restores nothing), so an unload-plus-edits apply still writes its one copy. A preset load and an engine apply stay at one copy each, unchanged. Operations that take no copy today take none (Notes Q1). Run `filepawl accept` when filepawl prints it.
- **Verify:** Testing scope: AC3's first clause. Not covered today. Add, at the REST or manager lane with a fake 8088 daemon that diverges on pass 1 and converges on pass 2, parametrized over a plain apply, an apply with `switch_to` naming a stored preset, and an unload-plus-edits apply: exactly one new copy is left in `backup_dir`, and a separate check that the newest copy after the plain apply carries the pre-apply working config (the field value before the edit). Each goes red against the pre-change code (after Task 2, which writes one dated copy per pass). Stop there. `scripts/gate.sh make check` prints `exit=0`; `filepawl accept` was run if filepawl printed it.

### Task 4: The architecture records the safety-copy rule

- **Files:** docs/architecture.md
- **Reads:** docs/architecture.md
- **Decisions:** D-04, D-05, D-10
- **Action:** `docs/architecture.md` states the rule beside the restore-lane paragraph Plan 1 extended: each staged apply, preset load and engine apply writes one dated safety copy of the daemon's state before its first restore; the five most recent are kept; bytes that are not a readable archive are never stored; nothing pushes a copy back. State rules, not history. Soft-wrapped, written with `Edit`.
- **Verify:** `.venv/bin/python .claude/hooks/md-softwrap.py --check docs/architecture.md` exits 0; the `triviajudge` Stop hook raises no flag on the added lines. A `docs/` edit runs its own gate only.

## Notes

- **Owner rulings, in hand: Q1 and Q2 stand as written below.** **Q1** (Task 3): D-05 says "each user operation writes exactly one safety copy". Planner's reading: the operations that take a copy today (staged apply, preset load, engine apply) take exactly one each, and operations that take none today keep taking none: the uploaded `/api/restore` (phase 8 D-04 declined it, "smells like scope expansion"), a standalone preset save (its `_mirror` restore pushes an archive built from the backup it just read) and a speaker apply (a form POST, no restore). The alternative, a copy before every restore-pushing operation, adds copies to save and reopens the phase 8 ruling. **Q2** (Task 2): the dated name `pre-apply-settings-<UTC stamp>-<zero-padded serial>.zip`, and the fixed `pre-apply-settings.zip` an earlier version left is kept in place, outside the count of five, rather than deleted unasked.
- **Cost the owner chose with D-05.** Five copies of about 9 MB each sit in `backup_dir`, and `/api/state-export` ships every file in that directory, so a state export grows from about 9 MB of backups to about 45 MB. Phase 8 declined F-018's state-export memory clause; this plan does not change the export.
- The prune's reach: the park lives under `backup_dir` (`PARK_DIR`), which is why the prune matches its own dated pattern at the top level only. Plan 3's temporary files never match that pattern.
