---
phase: 5
status: partial
completed: 2026-11-12
---

# Phase 5: Untested behaviors covered - Summary

Pinned tests, each with a recorded bite, for every claim on `todo.txt`'s triaged untested list but one (two more struck by the owner), plus three fixes the tests exposed: `scripts/abuse.sh close` reads audit `fields`, the control connection redials at once after a restart, and `close` waits for Ready before its readback.

## What shipped

- Python lanes: matrixscope bodyless-profile refusal, metering dial give-up and redial, five fixed-volume transitions; dead no-profile branch in `matrix_scope` deleted - `tests/matrix`, `tests/engine`, `tests/apply` (Plan 1)
- `scripts/abuse.sh close` baseline upload pinned on apply, live write and preset write, and not after none - `tests/e2e/test_abuse_bracket.py`; fixes in `scripts/abuse.sh` and `hqptuner/core/manager.py` (`take_control_down` redials) (Plan 2)
- Health alerts, lib readers, client store lines, plate failure lines (Plans 3, 4)
- Meter, preferences, guards and range buttons (Plan 5)
- Drawer family, grammar, head, loudness, modes, output, volume, HF, xref, engine, switcher, view, crossfeed, pipelines, source plot, page, list and hardware draft stores - `tests/js/store/` (Plans 6 to 9, 14 to 17)
- Output, speakers, volume, builder rail, list, settings and builder components - `tests/js/components/` (Plans 10 to 13, 18)
- Mutation bites shown for the four already-covered claims, and `todo.txt` reconciled; the file is gitignored, so no commit carries it (Plan 19)

## Commits

| Plan | Tasks | Commits |
|---|---|---|
| 1 | 5 | b53ccd36, 4eda6128, 2e09ec6a, 2fa9d5b9, 846d3652 |
| 2 | 4 | e3200241, 8b949cf9, 6a1c14d5, d5d3ac43 |
| 3 | 7 | aa7077bd, e23c99d5, ec1e5bb9, 173a4591, 759c8546, 152bdde6, e1c72200 |
| 4 | 7 | 13677275, e2fc6593, cb836c54, 4b1ab140, 38da170f, 24b9057d, fc323cf8 |
| 5 | 8 | 066e31e7, 60f161b1, 76946e6f, cb1becab, c300818e, (Task 6 none, strike candidate), 73007a15, 87786893 |
| 6 | 6 | 1e1a1958, (Task 2 none, already covered), 78cf6455, 234dfcb7, 5b1d22b0, 06afeaf2 |
| 7 | 5 | f3fa34a7 (Tasks 1 to 4), 021bfcee |
| 8 | 6 | 24fd2456, b2bb9832, af0f8229, 373e6e30, 39efe617, 5ed7367a |
| 9 | 6 | 070ad473 (Tasks 1 to 5), 0eae2074 |
| 10 | 6 | 11bb3788, 7d39316a, 3401320f, cac3da38, 646a666a, c02b12bb |
| 11 | 6 | d0baa472, 88f6189e, 179c0331, 7d7747c1, c531d9fa, e60a84c9 |
| 12 | 6 | e3e347bb, 22c893e3, d4b5395a, d050a7bd, 453226d0, a467369a |
| 13 | 6 | d1f4dd33, 6568a5d8, 025a93c7, 8e5440d8, 42be1f92, 2c4306fc |
| 14 | 5 | 50450fae, 9e50951b, ee1e91b7, 94613e35, 9f3b1222 |
| 15 | 7 | 98024b8c, e111fa74, 145fc422, 830a43f0, 1d1f6247, 97d65033, 6e80efb5 |
| 16 | 7 | a1ee65f0 (Tasks 1, 2), 4ec735e2 (Tasks 3 to 5), 22923c02 (Tasks 6, 7) |
| 17 | 5 | 33e13ac0, 2538815e, 489a9a96, 4dd759b8, 4805a55d |
| 18 | 4 | 702994d4, b66aeca3, 7bc05c1e, ac301ab5 |
| 19 | 5 | none (`todo.txt` is gitignored) |

Each task's bite (mutant id or deliberate break, and the test it turned red) is in `reports/plan-<k>.md` and the commit message.

## Deviations

- [deviation] Plan 2 Task 4: removing the health wait alone turns no test red, since Task 3's redial finishes first in the e2e stack; only removing the wait and the redial together does (3 failed). Owner accepted the wait with that pair bite, committed d5d3ac43.
- [deviation] Plan 7 Task 4: the active bound lives in `dropBound`, not `dropHandle`; the break was applied there. Task 5: the alsa/network cases were already bitten by existing tests, so none was duplicated; the negative half became a strike candidate.
- [deviation] Plan 11 Task 5: the loudness readouts belong to the Volume Range block (`VolumeRange.js`), so the case sits in `drawers-volume-range.test.js`.
- [deviation] Plan 13 Task 2: the pinned-rates control is a Behavior drawer field; the case sits in `engine-rows.test.js`.
- [deviation] Plan 14 Task 1: the gray reason comes from `crossfeedOff` in `store/schema/gray.js`; the break was applied there.
- [deviation] Plan 15 Task 5: no filter drops above-top ticks; the wrong implementation used was ticks built from a wider axis than the view.
- [deviation] Plan 18 Task 3: the disabled profile select is in `SnapshotRows.js`; the case sits in `rows.test.js`.

## Open items

- Uncovered: `presets/store/live.py` creates missing parent directories. Owner ruling 2026-11-12: a case red by `StoreUnwritableError` (mutants 5, 7, 9) is not bite, and the `exist_ok` mutants 6 and 10 survive, so the claim stays on `todo.txt` and needs a test that fails on its assertion.
- Struck by owner ruling 2026-11-12: "modes alsa line does not name the net bits nor the network line the alsa bits" (Plan 7) and "shaperfit source mode raises no third row" (Plan 5).
- mutmut 3.8.0 crashes its stats pass against pytest 9.2.0 (`'Function' object has no attribute '_nodeid'`); Plans 1 and 19 worked around it outside the repo. A pin or a repo-side plugin is the owner's call.
- `refresh_devices` ignores `await_ready`'s result (`hqptuner/core/engineread.py`).
- `_fixed_target`'s `or active is not None` clause cannot change the result (Plan 1); the owner may want it struck as dead code.
- Plan 8 Task 2 reads "engine holds the control" as VolumeRange enabled not 1; if the owner meant the opposite, that test is wrong.
- Plans 7, 9 and 16 committed several tasks per commit where tasks shared one file.
- Plan 7 piped two bite probes from `scripts/gate.sh`, against the repo rule; logs were read afterwards.
- The suite-time gate failed once on Plans 5, 11 and 12 commits under host load from parallel executors and passed on re-run; no bar was changed.

## Goal check

Not fully delivered. Plans 1 to 18 landed a test for each claim they covered, each with a bite recorded in its commit (e.g. Plan 19's `x__reenumerates__mutmut_2` failing 5 cases of `test_live_reenumeration_report.py`), and Plan 19 reports both closing gates at `exit=0` (`make check`, and the e2e abuse bracket with 14 passed) and no removed `assert` line in `git diff 7ac93e5b..HEAD -U0 -- tests/`. The owner struck two of the three claims left over, and the third, `presets/store/live.py` creating missing parent directories, stays on `todo.txt` with no assertion-bite (Open items), so the goal's "covered or struck" holds for every claim except that one.

complete locally, not CI-verified
