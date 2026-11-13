PLAN COMPLETE

Plan: /home/atom/dev/hqptuner2/.planning/phases/5/PLAN-8.md

Tasks: 6 of 6. Full suite: `PYTHONPATH=$(pwd) scripts/gate.sh make check` exit=0.

| Task | Commit | Note |
|---|---|---|
| 1 Output no tier hatched without caps | 24fd2456 | bite: grayRatesByDevice treating absent caps as an empty set turned the new case red; reverted. Local `hatched` helper hoisted to module level (no assertion line changed) |
| 2 Volume needle hidden while engine holds control | b2bb9832 | bite: liveLevel without the VolumeRange enabled check turned the new case red; reverted |
| 3 HF names no filter without state / enumeration | af0f8229 | bites: txt falling back to first enumerated name (no-state case red); txt falling back to raw index (no-enumeration case red); both reverted |
| 4 HF offers no options without state / enumeration | 373e6e30 | bites: options built without the State check (no-state red); options falling back to a fixed list (no-enumeration red); both reverted. Shared `lose` helper extracted from task 3 (no assertion line changed) |
| 5 Xref no link for a reason naming no place | 39efe617 | bite: reasonXref falling back to first TARGETS id turned the new case red; reverted |
| 6 Engine readings that read none | 5ed7367a | 7-case table; bites each alone: drop `playing &&` (3 stopped cases + existing phase cases red), `Number(v) \|\| 0` (empty speed, unreadable total red), drop `fill < 0` (-1 case red), drop outputApplies (non-applying red); all reverted |

Deviations: none

Open items:

- Task 2: read "engine holds the control" as VolumeRange enabled not 1 (volume control disabled/held by the engine; spec api.md:119, protocol.md:369), the only reading the code and the existing needle test allow. todo.txt line 30 words the same claim as "needle absent while the engine does not report the control". If the owner meant the opposite reading, this test is wrong.
- Worktree environment: no `.venv` and an empty eqlab submodule, so pre-commit hooks failed to start; symlinked `.venv` to the main checkout's and copied eqlab's files in (gitignored / submodule content, uncommitted, no hook weakened).
