PLAN COMPLETE
Plan: /home/atom/dev/hqptuner2/.planning/phases/5/PLAN-11.md
Tasks: 6 of 6
| Task | Commit | Note |
|---|---|---|
| 1 | d0baa472 | discard live after an edit; bite: Head.js discard `disabled=${!live}` -> `${live}`, new case red on assertion |
| 2 | 88f6189e | no input/select disabled while idle; bite: Speakers.js `busy = speakersBusy.value \|\| !enginePlaying.value`, new case red (and the existing direct-sdm case, collaterally) |
| 3 | 179c0331 | block not grayed + boxes enabled with fixed off (2 cases); bite: store volume.js gray reduce seeded "always", both red |
| 4 | 7d7747c1 | needle absent when engine reports enabled "0" (paired with the reported case); bite: volume.js liveLevel kept only `!vr`, red |
| 5 | c531d9fa | loudness readouts show while loudness runs, in drawers-volume-range.test.js; bite: VolumeRange.js `hidden=${!!loud}`, new case red (and the hide case) |
| 6 | e60a84c9 | Level tab undotted before an edit with fixed volume running; bite: drawer.js dirtyTabs `isDirty(k) \|\| !!runningValue("fixed_volume_enabled")`, red |
Deviations:
- [deviation] Task 5 asserted a Loudness-drawer readout hidden while loudness is off, pinned in drawers-loudness.test.js. Actually: the Loudness drawer (Loudness.js, loudness/RangeBar.js, RespPlot.js) has no readout that hides with loudness off (the playback output and the applied trace label always render; the block only grays). The claim comes from commit a76b9e4d, which renamed test_the_loudness_readouts_show_while_loudness_runs to the hide-while-off case in the Volume range suite: the readouts are the Volume Range block's loudness bounds row (`inl`, VolumeRange.js). I wrote the case in drawers-volume-range.test.js (in the lease) and ran the bite on VolumeRange.js; drawers-loudness.test.js is untouched.
Open items:
- Worktree lacked .venv, node_modules and the populated eqlab submodule; symlinked .venv and node_modules to the main checkout's and copied eqlab core/, src/, package.json in (all untracked or ignored; no hook or config touched).
- Task 3: contrast Auto mode (gray) is not pinned in the component suite (loader fixes optimal_iso "0"); the Manual contrast is. The Must-be-true names only Off, so it was not added.
- Task 1's contrast (discard disabled before an edit) is already pinned in drawers-speakers-schema.test.js; the new case carries it in its own pair only.
- Full suite: `make check` first run failed only at check_suite_time ("suite 46.0s, bar 37.7s: +8.3s, escalate to owner (--accept)") with 3664 passed, under host load 14 from parallel executors and this plan's commits touching no Python. Not accepted (owner's call). One re-run of `make check` printed exit=0 (lint, lint-js, test, test-js all green).
