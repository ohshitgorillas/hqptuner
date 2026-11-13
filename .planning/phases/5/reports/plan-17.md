PLAN COMPLETE

Plan: .planning/phases/5/PLAN-17.md

Tasks: 5 of 5

| Task | Commit | Note |
|---|---|---|
| 1 Hardware draft reads unloaded before first read | 33e13ac0 | Earlier dispatch. Bite: `loaded: read !== null` -> `loaded: true` red, reverted. |
| 2 Edit set back to base stops differing | 2538815e | Earlier dispatch. Bite: draftDiffers dropping the samePosted comparison red, reverted. String-over-numeric-base case struck by owner (D-01). |
| 3 staged false while every edit matches base | 489a9a96 | Bite: `staged = computed(() => Object.keys(form.values.value).length > 0)` red (expected false, actual true), reverted. |
| 4 All-stations alone does not differ | 4dd759b8 | Bite: `differs: ... \|\| allStations.value` red (expected false, actual true), reverted. |
| 5 Apply with all-stations off sends all_presets false | 4805a55d | Bite: `all_presets: true` always red on deepEqual, reverted. `PYTHONPATH=$(pwd) scripts/gate.sh make check` exit=0 (log /tmp/gate-make-XzvLqZu7.log). |

Deviations: none (task 2 string case: owner-struck, recorded in the earlier report plan-17.1.md)

Open items:

- Task 1 uses a `?unread` query import of hardware.js; that second instance stays subscribed to `generation` for the rest of the file.
- No existing assertion line removed (git diff -U0 showed no removed lines); eslint exit=0; source git diff clean after each bite.
