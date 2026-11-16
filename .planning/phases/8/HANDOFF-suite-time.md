# Handoff: why the offline suite's wall time keeps rising

From session `657edb7a-00b2-4816-8af4-8c97050c933c` (recall: `~/.claude/skills/terminus/scripts/recall-session 657edb7a-00b2-4816-8af4-8c97050c933c`), 2026-11-11.

## The task

Find out, with evidence, why `scripts/gates/testing/check_suite_time.py` keeps refusing commits on `dev`, and report the cause to the owner. Do not run `--accept`: the owner approved one accept today and has ruled out another. Do not loosen `ESCALATE` or `REJECT`, edit the gate or the hook, or use `--no-verify` or `SKIP=` (gate exemptions are owner-approved per site). If the cause is in the gate's design, report it as a proposal; the owner decides.

## What was measured today (dev branch, junit wall time vs the gate's bar)

| Time | Run | Wall | Bar | Load (1 min) | Result |
|---|---|---|---|---|---|
| 19:13 | `make check` (plan 1 task 1 code) | 94.06s | (seeded or prior) | ~6 | green, bar set to 94.06 |
| ~19:17 | pre-commit, same code | 100.7s | 94.06 | 5.6 to 6.8 | refused +6.6s |
| ~19:28 | pre-commit, same code (only a CHANGELOG line differs) | 100.3s | 94.06 | 9.3 | refused +6.3s |
| ~19:45 | owner `--accept` | 100.33s | | | bar 100.33 |
| 19:56 to 20:59 | eight plan-1 commit hooks | about 95s each | moving | 8 to 9 | each passed and lowered the bar |
| 21:10 | last green recorded | 97.747s | | | bar now 97.747 (`.suite-time.dev.json`) |
| ~21:28 | `make test` after plan 1 task 8 | 107.3s | 97.7 | 15.2 | refused +9.6s |
| 21:43 | `make check`, risk fix (uncommitted) | 103.9s | 97.7 | ~11 | refused +6.1s |

Test count: 3034 (19:28), 3089 (21:28), 3098 (21:43). The 21:43 junit report is kept at `/tmp/cad-Krv8zL/junit-fix-103.9.xml`: wall 103.871s, sum of test times 100.8s, 40 tests over 0.2s. The 19:28 report showed no test over 0.44s, and the new escaping test file took 0.0s.

## What the evidence says so far, and what it does not

- Identical code ran 94.06s under `make check` and 100.7s and 100.3s under the pre-commit hook. So at least about 6s of the swing is not code. Unverified which: host load, or the pre-commit run itself (the `pytest-offline` hook in `.pre-commit-config.yaml` runs with `--cov=hqptuner --cov-branch` and `-p idle_probe -p clock_probe -p suite_deadline`; compare that with what `make test` runs).
- The gate's docstring: "A run within `ESCALATE` seconds of the baseline passes and becomes the baseline." So every fast green run lowers the bar, and a later run under normal noise is judged against the fastest recent run. Unverified whether this ratchet, rather than a real slowdown, explains the refusals. `ESCALATE` is 5.0s, about 5% of a 100s suite.
- Host load came from other sessions: at 21:28, chromium and a playwright driver plus pytest from `/home/atom/dev/hqptuner2/.claude/worktrees/integrate`; at 21:30, `check_no_copy_assertions.py` from `/home/atom/dev/hqptuner2` at 99.7% CPU. Load on 18 cores ranged 6 to 17. Unverified how much load moves this suite: sum of test times (100.8s) is close to the wall time (103.9s), so it runs mostly serially, on one core.
- 64 tests were added between 19:28 and 21:43. Unverified what they cost. Per-test times in the junit reports would show it.

## Suggested checks, in order

1. Run `uptime` and a process list first, and note other sessions' load (`~/dev/CLAUDE.md` 5.1).
2. Diff the `make test` command line against the `pytest-offline` hook entry. Time both, back to back, on the same commit, at the same load, through `scripts/gate.sh`. Each run costs about 100s on roughly one core: say so before running (`~/dev/CLAUDE.md` 3.1).
3. Diff per-test times between two junit reports of the same commit, to see whether the swing is spread evenly (load or CPU frequency) or sits in particular tests (`idle_probe`, `clock_probe` or the coverage tracer).
4. Read `check_suite_time.py`'s baseline update rule against the history above and state whether the ratchet alone explains the refusals.
5. Report the cause, its evidence and your confidence to the owner, with any gate change as a proposal only.

## Phase 8 state this handoff leaves behind

- `/cad-execute 8` is stopped mid-run at plan 1, which is committed `2665a322..f1bcc93c`. Its report reads `PLAN CHECKPOINT: suite-red`.
- The risk_surface review raised 1 high, 1 medium and 1 low finding, all confirmed (`.planning/phases/8/REVIEW-risk_surface-plan-1.md`). The fix for the high one is written and tested but uncommitted, because the wall-time gate refused it: `hqptuner/api/routes/pending.py`, `docs/architecture.md`, `docs/openapi.json` and the new `tests/api/surface/test_staged_control_chars.py`. Once the gate question is settled, commit it as `fix(8-1): a staged value with a control character is refused`. Then run the narrowed re-arm review (one round, `triage-gate.md`), write the adjudication record and receipt, `risk-check status`, and `cursor set`, then plans 2 to 5 in order. The medium and low findings become SUMMARY open items.
- Plan Notes: `.planning/phases/8/PLAN-1.md` `## Notes`, first bullet, holds the owner's rulings for the whole phase. The plan briefs omit Notes, so every executor prompt must point to that bullet.
