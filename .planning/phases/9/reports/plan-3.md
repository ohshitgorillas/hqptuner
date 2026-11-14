PLAN COMPLETE
Plan: .planning/phases/9/PLAN-3.md
Tasks: 4 of 4
| Task | Commit | Note |
|---|---|---|
| 1 - One fsynced temp-and-rename helper, adopted by the connection store | 833793ae | `hqptuner/atomicwrite.py` (`write`, `is_temp`, `TEMP_SUFFIX`, `SHARED_MODE`); `ConnectionStore.write` adopted at 0600; pinned mode tests green |
| 2 - The six JSON stores | 3149609e | live, favorites (both kinds), descriptions, autopilot, narrowing, matrixmode; 7 cases red against in-place write, green after |
| 3 - Preset store XML, store.json, active.json, CHANGELOG | b1a24b91 | stamp, XML, store.json, active.json via helper; `### Security` bullet landed verbatim; temp name shortened after `test_preset_names` 255-byte case failed (File name too long) |
| 4 - Park and safety copy; park skips temp files | 7ba25a4c | `FilterPark.park` and `_write_new_copy` via helper; `_parked()` skips `is_temp` names for `files` and `_parked_bytes` |
Suite: `make test` (workflow.test_command null; the Makefile offline suite with coverage floor and suite-time gate) exit=0, 104.1s.
Deviations:
- [deviation] Task 1 Verify says inject the failed rename by patching `os.replace`; the filepawl pre-commit gate rejects any patch ("patches at line N - fake at the wire, never a patch") and no exemption is approved. Used real filesystem faults: `RLIMIT_FSIZE` cutting the temp write one byte short (after the temp exists, before the rename), and a non-empty directory at the target (a real refused rename). Same contract proven; tests bite.
- [deviation] Task 4 (a) asserts the safety-copy write "goes red against the pre-change in-place write", but Plan 2's `_write_new_copy` already unlinked a half-written copy on `OSError`, so an `OSError` fault is green both ways. The red case is a kill that is not an `OSError`: the test turns SIGXFSZ into a `BaseException`. Pre-change leaves a partial dated copy as the newest (red); now none. A second case pins the `OSError` path as `BackupBeforeApplyFailedError`.
- [deviation] The plan's Task 1 Action says the temp name carries a marker; a name derived from the target's overran the 255-byte filename limit for a 255-byte preset name (caught by `tests/presets/test_preset_names.py`). The temp name is now `.<16 hex>.atomictmp`, independent of the target's name.
Open items:
- `_write_new_copy` used an exclusive create; the helper replaces atomically, so "never over an existing copy" now rests on an `exists()` check before the write, sound because it runs synchronously on the event-loop thread. Two processes backing up into one directory in the same second could overwrite one copy. Declined an exclusive-create option on the helper (link-then-unlink) because nothing in the plan asks for it.
- Flagged in the plan Notes, no retry added: on Windows `os.replace` onto a file another handle holds open can fail with `PermissionError`, which surfaces as `store_unwritable`. `smoke-windows` is a CI job on the phase's last `dev` commit; not run here.
- Tests import `numbered_archive`/`stored_copies` from `integrity.test_safety_copies` and `file_growth_refused` from `test_atomic_write` (a new `tests/support` module is outside the lease).
- `hqptuner/core/login.py`'s link write left as the plan scopes it out.
