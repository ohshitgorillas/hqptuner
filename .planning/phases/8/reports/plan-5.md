PLAN COMPLETE

Plan: .planning/phases/8/PLAN-5.md

Tasks: 2 of 2

Final suite: `scripts/gate.sh make test` (the Makefile offline target; `workflow.test_command` is null) printed `exit=0`, suite 100.3s against last green 99.3s, idle and clock-wait gates ok.

| Task | Commit | Note |
|---|---|---|
| 1 - The changelog carries every approved Security bullet of the phase | none (read-only check) | Per Plan 1 Notes (owner ruling 2026-11-11) the phase ships ONE bullet: `- **Settings, restore archives and preset names HQPlayer can't use are refused**, and special characters in names save correctly.` It is present verbatim under `[Unreleased]` `### Security`, below the two earlier bullets, added by `2665a322` (Plan 1 Task 1, the marked task) per `git log -S`. `scripts/gate.sh .venv/bin/python scripts/gates/check_changelog.py` printed `exit=0`. |
| 2 - Every finding of the phase has its disposition | 34271eaf | Thirteen entries inserted in finding order in `.planning/security/DISPOSITIONS.md`. `md-softwrap.py --check` exit 0; `### F-0` count 17 to 30; every hash resolves; the 69 distinct test node ids collect (163 cases); the two JS proof names exist in `tests/js/store/narrow/inherited-labels.test.js`; no em dash. |

Deviations: none

Open items:

- F-018 quotes the Q3 ruling from Plan 1 Notes ("Q3: decline the state-export clause; no task is added.") and D-06 from CONTEXT as copy item 13 directs; F-011 and F-033 likewise quote D-05 and D-07 as CONTEXT records them. The owner may want to review these quotations.
- F-019's anchoring (`135c4c1d`) is held by characterization only, as stated in the entry (D-09); the failing-before proof is the ceiling test.
- F-018: the filter-walk and `/api/backup` recompression clauses are placed under the D-06 thread-move ruling, and the entry says the upload and archive ceilings of `9803eddd` and `56b41122` bound them. The filter upload is bounded by `Config.filter_max_bytes` (32 MiB default), which no phase 8 task changed.
- Plan 2's stale `docs/architecture.md` row for `archive_unreadable` (500) is outside every lease and still open from the Plan 2 report.
- The pre-commit hook took several minutes for this docs-only commit (the offline suite runs in it).
- Not run by this plan: `ci-status` on the seven CI jobs (AC6); `/cad-verify` reads it after the owner pushes.
