PLAN CHECKPOINT: blocked

Plan: .planning/phases/9/PLAN-1.md

Tasks: 0 of 5

| Task | Commit | Note |
|---|---|---|
| 1 - The staged apply holds one queueing lock | none | Implemented and staged, NOT committed: pre-commit gates `suite-time` and `changelog-trivia` failed (see Open items). Staged: CHANGELOG.md, hqptuner/api/routes/apply.py, hqptuner/core/applyops.py, tests/apply/overlap/__init__.py, tests/apply/overlap/test_apply_queue.py. `make lint` exit=0; `tests/apply/overlap`, `tests/api/test_api_write.py`, `tests/apply/test_http_apply.py` green. |
| 2-5 | not started | Held behind the Task 1 commit. |

Task 1 work, as staged:

- `ApplyOps.write_lock` (one `asyncio.Lock`, created in `__init__`). The `apply` route checks `NothingStagedError` first, then `async with manager.applyops.write_lock:` runs `_apply_held` (staged-set read, preset switch and lanes, audit, clear, `_persist_after_apply`).
- The test seam lives in `tests/apply/overlap/__init__.py` (`RestoreHold`, `lull`, `Held`, `held_app`), not `tests/support/fake_http.py`: that file is at 799 lines and filepawl's cap for tests is 800, so adding the hold there fails `filepawl check` ("test over cap 800 (850 lines)"). Task 3 reuses the seam by `from overlap import ...`; Task 4's `tests/matrix/test_park_release.py` cannot import it (`tests/apply` is on sys.path only once the overlap tests are collected) and would carry its own copy.
- Bite: against pre-change code `test_a_second_apply_pushes_nothing_while_the_first_is_held_at_the_daemon` is red (`assert 2 == 1`: the second apply pushed `/restore` while the first was held); green after.

Deviations:

- [deviation] Task 1 Verify says both checks must go red against pre-change code. Expected (b) red, observed green: pre-change a second apply also answers 200 (no lock, no refusal), so `test_a_second_apply_that_waited_answers_success` has no pre-change state to fail on. Kept as the D-01 no-new-refusal guard (docs/testing.md rule 8 characterization exemption).
- [deviation] The plan names `tests/support/fake_http.py` as the home of the hold; that file is at its 800-line cap, so the hold sits in `tests/apply/overlap/__init__.py` (a file the lease names).

Open items:

- BLOCKED, `suite-time` gate: `suite 108.6s, last green 101.6s: +7.0s, escalate to owner (--accept)`. Two pre-commit runs gave +6.3s and +7.0s. A control run with this change stashed (HEAD only) took 107.6s, so the slowdown is not this change (the two new tests cost 0.33s). Baseline `.suite-time.dev.json` was written 2026-11-13 00:53 and no commit landed since. Cause of the +6s is unknown (host load or drift); `--accept` is the owner's.
- BLOCKED, `changelog-trivia` judge (non-deterministic: passed on the first pre-commit run, failed on the second): `CHANGELOG.md:19: Describes mechanism (coordination/ordering) rather than user-visible effect` on the owner-approved verbatim bullet `- **Settings staged while an apply runs are kept**, and two applies at once take turns.` The copy is the owner's character for character; rewording it is a copy change.
- Declined: a shared `tests/support/` module for the hold, since the lease names none; if the owner leases one, the Task 4 copy collapses into it.
