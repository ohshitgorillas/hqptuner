PLAN COMPLETE

Plan: .planning/phases/9/PLAN-1.md

Tasks: 5 of 5

Full suite: `scripts/gate.sh make check` exit=0 (Makefile target; workflow.test_command is null).

| Task | Commit | Note |
|---|---|---|
| 1 - The staged apply holds one queueing lock | 42807119 | `ApplyOps.write_lock`; the `apply` route takes it after the `NothingStagedError` check. Committed with `SKIP=changelog-trivia` only (owner approval for that one site, the verbatim CHANGELOG bullet); suite-time gate passed on the rerun; every other hook ran. |
| 2 - Preset load/save, engine apply, uploaded restore, speaker apply queue behind the lock | 8f4edaf8 | Routes `preset.py` (load, save; delete outside), `config.py` (`engine_apply`, `restore`), `matrix/matrix.py` (`speakers_apply`) take `write_lock`. `.filepawl.toml` `config.py` allowance 406 to 408 (owner-approved). Bite run before the route change: 5 of 5 "nothing sent while held" cases red; green after. All hooks ran and passed. |
| 3 - An apply clears from the pending buffer only what it applied | 382b2250 | The apply runs on its own copy; `pending.applied_entries` decides, `PendingStore.clear_applied` executes. Bite run: 3 of 3 new cases red before, green after. All hooks ran and passed. |
| 4 - The filter park releases only the uploads an apply carried | 948dff3d | `FilterPark.release` (+`MEMBER_DIR`), `after_restore`/`release_parked_filters` take the carried set, `ApplyOps.apply` reads the park once and passes `carried` to `restore.apply` and `after_restore`; `restore.apply` defaults `carried` to one read; `_restore_once` takes it. `tests/matrix/test_park_release.py`: park-during-apply check, red before (`assert [] == ['data/late.wav']`), green after. `.filepawl.toml` `restore.py` allowance 410 to 418 (owner-approved this session, that entry and value only). `scripts/gate.sh make check` exit=0 before commit; all hooks ran, no skips. |
| 5 - The architecture records the write-lane lock and the selective clear | 5b56cdf8 | `docs/architecture.md` paragraph beside the restore-lane paragraph: names the six D-02 lanes, the LIVE/stage/discard exclusion, the selective buffer and park clear. `md-softwrap --check` exit 0; all hooks ran. |

Deviations:

- [deviation] Task 1 Verify says both checks must go red against pre-change code. Expected (b) red, observed green: pre-change a second apply also answers 200 (no lock, no refusal), so `test_a_second_apply_that_waited_answers_success` has no pre-change state to fail on. Kept as the D-01 no-new-refusal guard (docs/testing.md rule 8 characterization exemption). Task 2's `test_a_lane_that_waited_answers_success` is the same shape, for the same reason.
- [deviation] Executor deviation, NOT owner-ruled: the plan names `tests/support/fake_http.py` as the home of the hold; that file is at its 800-line filepawl cap for tests, so the hold sits in `tests/apply/overlap/__init__.py` (a file the lease names). The owner has not ruled on this.

Open items:

- Task 4's `tests/matrix/test_park_release.py` carries its own copy of the hold (not owner-ruled): importing `apply.overlap` from there makes mypy report `tests/apply/overlap/__init__.py: error: Source file found twice under different module names: "overlap" and "apply.overlap"`. Declined: a shared `tests/support/` module, since the lease names none.
- The `changelog-trivia` judge flagged the owner-approved bullet at Task 1 (`CHANGELOG.md:19: Describes mechanism ... rather than user-visible effect`); skipped for that one commit on the owner's word. Every later commit ran every hook.
- Untracked `bug.png` at the repo root is not mine; left alone.
