PLAN CHECKPOINT: blocked

Plan: .planning/phases/1/PLAN.md

Tasks: 4 of 6

| Task | Commit | Note |
|---|---|---|
| 1 Carry policy and config onto integrate | 053b39de | `git checkout v2 --` of both files; diff vs v2 empty; policy check accepted:true with the three "in no workflow file" problems only. |
| 2 Track report check, lint it | 69ec84f3 | cmp 0, check-ignore 1, ls-files lists both, report check lines 97.54% meets 95 / branches 91.10% meets 90, eslint 0, prettier 0. |
| 3 pytest-offline recipe | 6c2e527f | Accepted run contiguous; sorted tokens identical before and after; diff touches only recipe line and comment. |
| 4 check job | 812f4704 | Steps in plan order; policy check ok:true accepted:true gate_found:true problems:[]; actionlint 0; PyYAML counts hold. |
| 5 Docstrings | none (blocked) | Amended action applied (each paragraph cut to end at "Loaded by ... on PYTHONPATH."). ruff exit=0, black exit=0, diff docstring lines only. Commit rejected by `comment-trivia`. Four files restored to HEAD, nothing staged. |
| 6 Prove coverage | not started | Stopped at the Task 5 checkpoint per the plan's "stop and quote its reason". |

Deviations: none

Open items:

- Blocker, task 5: after the amended cut, the `comment-trivia` judge (hook `comments state what holds now (LLM judge)`) still rejects all four docstrings: "Describes implementation details and measurement mechanics" on `scripts/clock_probe.py:2`, `scripts/idle_probe.py:2`, `scripts/pytest_plugins/run_stamp.py:2`, `scripts/pytest_plugins/suite_deadline.py:2`; summary line "4 line(s) narrate history. State what holds now, or delete the remark." The reason is the same on unedited text: the judge flags any docstring that is changed, and the rejected content is the body (measurement mechanics), not the removed clause. Per the plan, cutting any further sentence is the owner's call. Options: (a) owner approves leaving the four docstrings unchanged (they keep calling the Makefile target "the one command line" though `check.yml` now carries a copy); (b) owner decides which further sentences are cut or supplies wording; (c) the edit moves where the judge does not read. No bypass used (`SKIP=` and `--no-verify` untouched).
- Task 6 does not depend on Task 5's files; it can run from this state once Task 5 is decided.
- Report rotation: prior report renamed to `plan-1.2.md` (earlier one is `plan-1.1.md`).
- Hook `md-softwrap.py` rejects the contract's one-line-per-field layout; blank lines between fields are the workaround.
- Untracked `uv.lock` and `.planning/reads.jsonl` in integrate left untouched and unstaged.
