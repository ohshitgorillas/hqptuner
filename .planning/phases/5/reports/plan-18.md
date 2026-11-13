PLAN COMPLETE

Plan: /home/atom/dev/hqptuner2/.planning/phases/5/PLAN-18.md

Tasks: 4 of 4

| Task | Commit | Note |
|---|---|---|
| 1 - no refusal line while idle | 702994d4 | bite: SnapshotBuilder.js captionText `refused.value` -> `refused.value \|\| cur.value.name`, red on test_the_caption_holds_no_refusal_while_idle only, reverted |
| 2 - no confirm line while idle | b66aeca3 | bite: SnapshotBuilder.js askLine `ask.value` -> `ask.value ?? { text: "" }`, red on test_the_confirm_line_is_absent_while_nothing_is_asked only, reverted |
| 3 - profile select enabled once held | 7bc05c1e | in rows.test.js; bite: SnapshotRows.js select `disabled=${!v.on}` -> `disabled=${true}`, red on test_the_profile_select_is_enabled_once_the_row_is_held only, reverted |
| 4 - no diff mark on an off row | ac301ab5 | bite: SnapshotRows.js liveCell `v.differs && v.on && "diff"` -> `v.differs && "diff"`, red on test_the_live_cell_marks_no_difference_on_a_row_that_is_off only, reverted |

Full suite: `PYTHONPATH=$(pwd) scripts/gate.sh make check` (the manifest target; workflow.test_command is null) printed exit=0 after the last test commit. Only additions in the diff against the pre-plan HEAD, so no assertion line was removed.

Deviations:

- [deviation] Task 3 asserted the profile select lives in the ProfileBuilder component file (`profile.test.js`, reads ProfileBuilder.js and store/faceplate/builders/profile.js). The only `select` with a `disabled` state is the Snapshot builder's profile row in SnapshotRows.js (`disabled=${!v.on}`), already pinned for the off case in rows.test.js; ProfileOverview's picker has no `disabled`. The test went into rows.test.js, a file in the plan's lease, and profile.test.js is untouched.

Open items:

- The worktree had an uninitialized `hqptuner/static/vendor/eqlab` submodule and no `.venv`; to run the gates I copied the main tree's eqlab files into the worktree path (git shows no change) and symlinked the gitignored `.venv` to the main tree's.
- Task 1 and 2 contrast cases (refusal shown while refused, confirm line shown while asked) were already covered by existing tests, so no duplicate was added.
