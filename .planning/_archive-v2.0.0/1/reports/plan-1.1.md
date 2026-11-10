PLAN CHECKPOINT: blocked

Plan: .planning/phases/1/PLAN.md

Tasks: 1 of 6

| Task | Commit | Note |
|---|---|---|
| 1 Carry policy and config onto integrate | 053b39de | `git checkout v2 --` of both files; diff vs v2 empty; policy check now accepted:true, enforcement available, 3 "in no workflow file" problems only. lease-check run with `--dir /home/atom/dev/hqptuner2/.planning` from the integrate worktree (plan lives in the parent repo). |
| 2 Track report check, lint it | none (blocked) | Files staged in integrate, not committed. All Verify items pass (cmp 0, check-ignore 1, ls-files lists both, report check prints lines 97.54% / branches 91.10% / statements disabled, `npx eslint .` 0, `npx prettier --check eslint.config.js` 0). Pre-commit hook `comment-trivia` (LLM judge, "comments state what holds now") rejects the rewritten comment above the `ignores` block in eslint.config.js on four wordings. |

Deviations: none

Open items:

- Blocker, task 2: four wordings of the replaced comment above the global `ignores` block were each rejected by the comment-trivia judge as narrating history. Rejected lines, quoted: "sessions, never shipped and never a gate's business. The one tracked" (refactor record: what was shipped and not); "is gitignored scratch, throwaway node scripts that no gate / lints. The one tracked ..." (describes what code once did or was ignored); "Every `.mjs` is a throwaway node script and is skipped, except the / coverage report check ..." (narration by negation); "Throwaway node scripts are `.mjs` files outside `.github/cadence/`, which" (describes what throwaway scripts were and where they lived). The judge reads only changed lines. Options: (a) delete the old two-line comment entirely and let the negation and the new config block speak for themselves, (b) leave the old comment untouched and add nothing, accepting it still says every `.mjs` is scratch, or (c) owner supplies the wording. Current staged state: `.github/cadence/coverage-report-check.mjs` (new), `.gitignore` (negation plus comment), `eslint.config.js` (negation, new node-globals block, the fourth comment wording); `uv.lock` untouched and unstaged.
- The plan's `files:` lease lists paths prefixed `.claude/worktrees/integrate/`. lease-check run from the integrate worktree with `--dir /home/atom/dev/hqptuner2/.planning` returns ok:true anyway.
- Hook `md-softwrap.py` rejected the report file with the contract's one-line-per-field layout; blank lines between fields are the workaround.
