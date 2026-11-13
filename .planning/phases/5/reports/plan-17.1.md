PLAN CHECKPOINT: structural Plan: /home/atom/dev/hqptuner2/.planning/phases/5/PLAN-17.md Tasks: 1 of 5 satisfied, task 2 half done (stopped at task 2)
| Task | Commit | Note |
|---|---|---|
| 1 Hardware draft reads unloaded before first read | 33e13ac0 | Fresh second instance of hardware.js via `?unread` URL import. Bite: `loaded: read !== null` -> `loaded: true` red (expected false, actual true), reverted. |
| 2a Edit set back to base stops differing | 2538815e | Bite: draftDiffers dropping the samePosted comparison (keeps every set key) red (expected false, actual true), reverted. |
| 2b String edit equal to numeric base does not differ | none | Not written. See deviation. |
| 3-5 | none | Not started; checkpoint raised in task 2. |

Deviations:
- [deviation] Task 2 Verify asserted: making `draftDiffers` compare with `!==` on raw values turns the string-over-number case red. Actually true: the store stringifies every engine value in `readEngine` (`out[k] = String(v)`) before it becomes the base, so base is `"4"` and the edit is `"4"`; `!==` on those is equal. Ran the case written as `load({engine: NUMERIC_NBLOCKS}); setHardware("nblocks", "4"); differs === false` against (a) `member(base, k) !== values[k]` in draft.js and (b) `out[k] = v` (no String) in hardware.js: both green. Only both breaks together would turn it red. Per D-01 (no single named plausible wrong implementation bites) wrote no test, left the claim as an owner strike candidate. Stopped here because the Verify cannot be met as written. Existing `test_a_value_off_a_numeric_base_differs` is unchanged and does not cover this claim.

Open items:
- Worktree had no `.venv` and an empty `hqptuner/static/vendor/eqlab` submodule dir, so pre-commit hooks (python, tsc, knip) failed on environment. Fixed inside the worktree only: `.venv` symlink to `/home/atom/dev/hqptuner/.venv` (gitignored) and eqlab contents copied from the main checkout (no `.git` file). No hook skipped or edited.
- `npx tsc -p jsconfig.json` and knip only pass with eqlab present; not part of any commit.
- Task 1 uses a `?unread` query import of hardware.js; the second instance stays subscribed to `generation` for the rest of the file and reads `/api/engine` on a generation move. Existing file stays green; not otherwise addressed.
- Tasks 3, 4, 5 and the final `make check` not run.
