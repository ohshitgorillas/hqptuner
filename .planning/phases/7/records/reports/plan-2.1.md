PLAN CHECKPOINT: blocked

- Plan: .planning/phases/7/PLAN-2.md
- Tasks: 1 of 3 committed; task 2 done and staged, not committed

| Task | Commit | Note |
|---|---|---|
| 1 - pacing decision reads frame start and end through the time base | 12a32005 | per-test outcomes of the 5 playhead suites identical to the HEAD baseline (345 tests, the same 12 red); `make lint-js` green; full `task-check.sh` not run per task (the 12-red baseline stops it at make check) |
| 2 - spectrogram slices end where their last frame ends | not committed | staged: store/meter/spectrogram.js, model/gauges/slicerange.js, lib/spectroraster.js, components/faceplate/drawers/source/paint.js, tests/js/store/meter/spectrogram.test.js, tests/js/model/gauges/slicerange.test.js, and `.filepawl.toml`. Red run first: new join case `test_slices_of_frames_stamped_at_44100_hz_join_with_no_gap_and_no_overlap` failed by AssertionError against the old spectrogram.js. After: all 8 pinned files give the same outcome per test as before, the new case passing. `make lint-js` green (eslint, prettier, tsc both, knip, jscpd). The three greps print nothing / the COLUMN_EPS definition. |

Blocked: the pre-commit `filepawl tree gate` failed: `hqptuner/static/lib/spectroraster.js: back under watch line 400; drop it`. The file shrank under 400 lines because its own `endOf` export went. The repo rule says to run `filepawl accept hqptuner/static/lib/spectroraster.js` whenever filepawl prints it; I ran it, and it removed the entry `"hqptuner/static/lib/spectroraster.js" = { lines = 401 }` from `.filepawl.toml`. `.filepawl.toml` is not in the plan's `files:` lease, so `lease-check` returns `undeclared-files` and I did not commit. The commit cannot pass the gate without that removal.

Deviations: none

Open items:
- Task 2 verify item (5) and Task 1 verify item (3): `bash .claude/task-check.sh` stops at `make check` on the 12 known phase 8 red tests, so no rebuild and no hand-back URL; the owner's look at the Source drawer's spectrogram is not possible from this run.
- Task 3 not started.
