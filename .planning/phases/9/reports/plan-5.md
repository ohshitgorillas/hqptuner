PLAN COMPLETE

Plan: .planning/phases/9/PLAN-5.md

Tasks: 1 of 1

Full suite: `scripts/gate.sh make check` (Makefile; workflow.test_command is null) printed `exit=0`, log /tmp/gate-make-0guuJfIe.log.

| Task | Commit | Note |
|---|---|---|
| 1 - Each finding of the phase has its disposition | 4c5f246a | F-029, F-030, F-031 inserted between F-028 and F-032 in `.planning/security/DISPOSITIONS.md`. All hooks ran, none skipped. |

Verify results:
- `md-softwrap.py --check` rc=0; `grep -c '^### F-0'` 30 before, 33 after; 14 distinct hashes named, each `git cat-file -e` ok; 22 proof node ids, `pytest --collect-only -q` lists 41 tests, no collection error.
- `scripts/gate.sh .venv/bin/python scripts/gates/check_changelog.py` exit=0. The four `### Security` bullets are in `CHANGELOG.md` `[Unreleased]` character for character (`grep -cxF` 1 each) and `git show` adds each in its Plan 1 Notes commit: 42807119, 930890d7, b1a24b91, 51d22885. Nothing in CHANGELOG.md was edited here.
- Bite re-check against the pre-fix code (temporary detached worktree, removed after): `b1a24b91^` with the final test file, the three preset-store cases fail by assertion (torn `hqplayerd/` bytes, `StoreCorruptError`); `3149609e^`, the seven JSON-store cases fail (`JSONDecodeError`); `7ba25a4c^`, the safety-copy-killed, park-write-killed and temp-file-in-park cases fail, the `OSError` case passes (as Plan 3 recorded). `833793ae^` has no `hqptuner/atomicwrite.py`; the editable install resolved it from the main tree in the worktree, so that check was inconclusive and the entry says the helper's proofs fail at collection. Other bites (Plans 1, 2, 4) are taken from their reports.

Deviations: none

Open items:
- The residual race Plan 4's risk review left (deleting the active preset while an apply's auto-save awaits `/backup` brings it back; `hqptuner/presets/presetlane.py:290-298`) is recorded in F-029 as "Residual, not fixed", with "The owner declined to file it". It is not described as fixed.
- Plan 1's recorded deviations (hold placed in `tests/apply/overlap/__init__.py`, own copy of the hold in `tests/matrix/test_park_release.py`) were executor choices the owner has not ruled on; unchanged here.
- `smoke-windows` and the other CI jobs (AC6) run on the phase's last `dev` commit after the owner pushes; not run here. Plan 3 flagged the Windows `os.replace` over an open handle as a possible `PermissionError`.
