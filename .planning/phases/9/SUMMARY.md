---
phase: 9
status: complete
completed: 2026-11-14
---

# Phase 9: Apply and store integrity - Summary

One `ApplyOps.write_lock` queues every write lane, an apply clears only what it carried, safety copies are validated, dated and kept five deep, every store writes through one fsynced temp-and-rename helper, and every store serializes its read-modify-write behind its own lock; F-029, F-030 and F-031 carry dispositions.

## What shipped

- The write-lane lock: the staged apply, preset load and save, engine apply, uploaded restore and speaker apply queue behind `ApplyOps.write_lock` - `hqptuner/core/applyops.py`, `hqptuner/api/routes/apply.py`, `preset.py`, `config.py`, `matrix/matrix.py`
- The selective clear: an apply clears from the pending buffer only the entries its own copy carried, and the filter park releases only the uploads that apply carried - `hqptuner/presets/store/filterpark.py`, `hqptuner/presets/presetops.py`, `hqptuner/lanes/http/restore.py`
- Safety copies: bytes that are not a readable settings archive never replace a stored copy; each copy is a new `pre-apply-settings-<UTC stamp>-<serial>.zip` and the five most recent are kept; a staged apply writes one copy, before its first restore - `hqptuner/presets/presetops.py`, `hqptuner/lanes/http/restore.py`
- Atomic writes: `hqptuner/atomicwrite.py` (fsynced temp and rename, temp name `.<16 hex>.atomictmp`), adopted by the connection store, the six JSON stores, the preset store's XML, `store.json` and `active.json`, the park and the safety copy; the park skips a leftover temp file
- Store locks: each JSON store, the preset store directory, the park (capacity check included), the safety copy and the connection store each hold one lock; seven stores take an optional keyword-only `lock` argument as the test seam
- `docs/architecture.md`: the write-lane lock and selective clear, the safety-copy rule, the store write rules (section 5.6)
- `CHANGELOG.md` `[Unreleased]` `### Security`: four owner-approved bullets, verbatim
- `.planning/security/DISPOSITIONS.md`: F-029, F-030, F-031

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | 42807119 | the staged apply holds one queueing write lock |
| 1 | 2 | 8f4edaf8 | preset load and save, engine apply, uploaded restore and speaker apply queue behind the write lock |
| 1 | 3 | 382b2250 | an apply clears from the pending buffer only what it applied |
| 1 | 4 | 948dff3d | the filter park releases only the uploads an apply carried |
| 1 | 5 | 5b56cdf8 | the architecture records the write-lane lock and the selective clear |
| 2 | 1 | f63e2c9c | bytes that are not a readable settings archive never replace a stored copy |
| 2 | 2 | 930890d7 | safety copies are dated and the five most recent are kept |
| 2 | 3 | 32bd0c24 | each staged apply writes one safety copy, before its first restore |
| 2 | 4 | 9e6fbfc7 | the architecture records the safety-copy rule |
| 3 | 1 | 833793ae | one fsynced temp-and-rename write, adopted by the connection store |
| 3 | 2 | 3149609e | the six JSON stores write through the atomic helper |
| 3 | 3 | b1a24b91 | the preset store writes its XML, store.json and active.json atomically |
| 3 | 4 | 7ba25a4c | the park and the safety copy write atomically, and the park skips a leftover temp file |
| 4 | 1 | 51d22885 | each JSON store serializes its read-modify-write behind one lock |
| 4 | 2 | 21f1e1e2 | the preset store takes one lock for its directory |
| 4 | 3 | 1f8dcaae | the park, the safety copy and the connection store each hold their own lock |
| 4 | 4 | 7c63f140 | the architecture records the store write rules |
| 5 | 1 | 4c5f246a | findings F-029, F-030 and F-031 have their dispositions |

## Deviations

- [deviation] Plan 1 Task 1 committed with `SKIP=changelog-trivia` on the owner's word, for that one commit only; the judge flagged the owner-approved bullet (`CHANGELOG.md:19: Describes mechanism (coordination/ordering) rather than user-visible effect`) after passing it on an earlier run. Every later commit ran every hook. 42807119
- [deviation] Plan 1 raised two filepawl allowances, each owner-approved for that entry and value: `hqptuner/api/routes/config.py` 406 to 408 (8f4edaf8) and `hqptuner/lanes/http/restore.py` 410 to 418 (948dff3d).
- [deviation] Plan 1's hold seam sits in `tests/apply/overlap/__init__.py`, not `tests/support/fake_http.py`, which is at its 800-line cap; `tests/matrix/test_park_release.py` carries its own copy. Executor choice, not owner-ruled. 42807119, 948dff3d
- [deviation] Plan 1's "a lane that waited answers success" checks are green against the pre-change code too, since the lockless code also answered 200; kept as the D-01 no-new-refusal guard. 42807119, 8f4edaf8
- [deviation] Plan 2 held `restore.py` at its 418-line allowance by changing `restore.apply`'s `switched: bool` to `switch: str | None` and rewrapping the `apply` and `_restore_once` docstrings to 120 columns. 32bd0c24
- [deviation] Plan 3 proves the failed rename with real filesystem faults (`RLIMIT_FSIZE`, a non-empty directory at the target), since the filepawl gate refuses a patch of `os.replace`; the safety-copy kill case uses SIGXFSZ as a `BaseException`, since plan 2 already cleaned up on `OSError`. 833793ae, 7ba25a4c
- [deviation] Plan 3's temp name is `.<16 hex>.atomictmp`, not derived from the target, since a derived name overran the 255-byte filename limit (`tests/presets/test_preset_names.py`). 833793ae
- [deviation] Plan 4: owner-ruled constructor seam in place of a `patches` exemption. LivePresetStore, FavoriteStore, DescriptionStore, AutopilotStore, MatrixModeStore, PresetStore and FilterPark take an optional keyword-only `lock`; production call sites are unchanged. Bite by null stub: 7 failed by assertion, none by TypeError. 51d22885, 21f1e1e2, 1f8dcaae

## Open items

- Plan 4's `risk_surface` review left one medium finding unfixed, declined by the owner and not filed: deleting the active preset while an apply's auto-save awaits `/backup` brings the deleted preset back (`hqptuner/presets/presetlane.py:290-298`; the delete routes in `hqptuner/api/routes/preset.py` run outside `applyops.write_lock`). F-029 records it as residual, not fixed.
- The NarrowingStore, PresetOps safety-copy and ConnectionStore locks have no behavioral test, since their writes replace the whole document and end last-wins either way.
- FilterPark's capacity check sits inside the park lock, a wider hold than the plan named.
- PresetStore writes from event-loop code now wait on the lock for one small file write.
- "Never over an existing safety copy" rests on an `exists()` check before the atomic write; two processes backing up into one directory in the same second could overwrite one copy.
- A wall clock that steps backward can date a new safety copy before five newer ones, and the prune then removes it at once.
- On Windows, `os.replace` onto a file another handle holds open can fail with `PermissionError`, surfacing as `store_unwritable`; `smoke-windows` and the other CI jobs have not run.
- `filepawl accept` was denied by the permission system when filepawl reported `restore.py` shrank; `.filepawl.toml` was left unchanged.
- `hqptuner/core/login.py`'s link write is not atomic; the plan scoped it out.

## Goal check

The commits plausibly deliver the goal. F-029 (concurrent applies) is answered by the write lock and the selective clear: 42807119 and 8f4edaf8 queue all six write lanes, 382b2250 and 948dff3d clear only what an apply carried, and their tests failed before the change (`assert 2 == 1`, `assert {} == {'mode': 'auto'}`, `assert [] == ['data/late.wav']` per the plan 1 report). F-030 (safety copies) is answered by f63e2c9c, 930890d7 and 32bd0c24, with rollback declined under an owner ruling quoted in `.planning/security/DISPOSITIONS.md`. F-031 (interrupted and interleaved store writes) is answered by 833793ae through 7ba25a4c and 51d22885 through 1f8dcaae; the bite re-check in the plan 5 report has the pre-fix stores failing by assertion and `JSONDecodeError`. Each finding carries its disposition (4c5f246a, `### F-0` count 30 to 33). Not delivered in full: the delete-versus-auto-save race stays open, recorded as residual in F-029 and declined, and three locks rest on the code alone. Every plan's last `scripts/gate.sh make check` printed `exit=0`, and the `risk-check status` for plans 1 to 5 reads `recorded`.

complete locally, not CI-verified
