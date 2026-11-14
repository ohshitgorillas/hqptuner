PLAN CHECKPOINT: blocked

Plan: .planning/phases/9/PLAN-1.md

Tasks: 3 of 5

| Task | Commit | Note |
|---|---|---|
| 1 - The staged apply holds one queueing lock | 42807119 | `ApplyOps.write_lock`; the `apply` route takes it after the `NothingStagedError` check. Committed with `SKIP=changelog-trivia` only (owner approval for that one site, the verbatim CHANGELOG bullet); suite-time gate passed on the rerun; every other hook ran. |
| 2 - Preset load/save, engine apply, uploaded restore, speaker apply queue behind the lock | 8f4edaf8 | Routes `preset.py` (load, save; delete outside), `config.py` (`engine_apply`, `restore`), `matrix/matrix.py` (`speakers_apply`) take `write_lock`. `.filepawl.toml` `config.py` allowance 406 to 408 (owner-approved). Bite run before the route change: 5 of 5 "nothing sent while held" cases red; green after. All hooks ran and passed. |
| 3 - An apply clears from the pending buffer only what it applied | 382b2250 | The apply runs on its own copy (`http` dict, each live bucket); `pending.applied_entries` decides, `PendingStore.clear_applied` executes. Bite run: 3 of 3 new cases red before (`assert {} == {'mode': 'auto'}`), green after. Pinned `tests/api/test_api_write.py` green. All hooks ran and passed. |
| 4 - The filter park releases only the uploads an apply carried | none | Implemented, NOT committed (unstaged): `hqptuner/presets/store/filterpark.py` (`FilterPark.release`, `MEMBER_DIR`), `hqptuner/presets/presetops.py` (`after_restore` and `release_parked_filters` take the carried set; `clear_parked_filters` stays for discard), `hqptuner/core/applyops.py` (reads the park once, passes `carried` to `restore.apply` and `after_restore`), `hqptuner/lanes/http/restore.py` (`apply` takes `carried`, defaulting to one read; `_restore_once` takes it), `tests/matrix/test_park_release.py` (own copy of the hold, see open items). Bite run: red before (`assert [] == ['data/late.wav']`), green after. `tests/matrix tests/apply tests/presets tests/api/test_api_write.py`: 1430 passed. `make lint` green except filepawl. |
| 5 | not started | Held behind Task 4. |

Blocked on: `.venv/bin/filepawl check` prints `hqptuner/lanes/http/restore.py: grew past allowance (418 > 410); split it`. Task 4's lease names restore.py and `.filepawl.toml`, but the owner approved only the `config.py` allowance (406 to 408); no other allowance change is approved. The growth is 8 lines: `apply` signature wraps (+2), one default-resolution line (+1), `_restore_once` signature explodes one-per-line under black (+5 over the old 3-line form; with a shorter form it is still wider than 120). No docstring line was added to keep it minimal. Needs: an owner ruling (raise the `restore.py` allowance to 418, or another route). Working tree holds Task 4 uncommitted.

Deviations:

- [deviation] Task 1 Verify says both checks must go red against pre-change code. Expected (b) red, observed green: pre-change a second apply also answers 200 (no lock, no refusal), so `test_a_second_apply_that_waited_answers_success` has no pre-change state to fail on. Kept as the D-01 no-new-refusal guard (docs/testing.md rule 8 characterization exemption). Task 2's `test_a_lane_that_waited_answers_success` is the same shape, for the same reason.
- [deviation] Executor deviation, NOT owner-ruled: the plan names `tests/support/fake_http.py` as the home of the hold; that file is at its 800-line filepawl cap for tests, so the hold sits in `tests/apply/overlap/__init__.py` (a file the lease names). The owner has not ruled on this.

Open items:

- Task 4's `tests/matrix/test_park_release.py` carries its own copy of the hold: importing `apply.overlap` from there makes mypy report `tests/apply/overlap/__init__.py: error: Source file found twice under different module names: "overlap" and "apply.overlap"`, and `overlap` is on sys.path only when `tests/apply/overlap` is collected. Declined: a shared `tests/support/` module, since the lease names none.
- The `changelog-trivia` judge flagged the owner-approved bullet at Task 1 (`CHANGELOG.md:19: Describes mechanism ... rather than user-visible effect`); skipped for that one commit on the owner's word. Every later commit ran every hook.
