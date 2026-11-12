---
phase: 3
status: complete
completed: 2026-11-12
---

# Phase 3: HF filter lamp follows the content - Summary

The rail's HF lamp and the engine-row HF menu now follow an acts-on rule derived from the playing content's rate: the lamp lights only on content the engaged HF filter acts on, and menu rows for filters that do nothing on that content are drawn dead and ignore a tap.

## What shipped

- Acts-on rule as a pure derivation (`contentRate`, `actsOn`) - `hqptuner/static/model/shell/hf-reach.js`
- Rail HF lamp reads the rule - `hqptuner/static/store/faceplate/chain.js`
- HF menu options carry `grayed`, judged only while transport is playing or paused, with the content rate as a `computed` so an unchanged status push wakes no reader - `hqptuner/static/store/faceplate/hf.js`
- Grayed rows disabled with a tap guard and dead ink - `hqptuner/static/components/faceplate/HfFilter.js`, `hqptuner/static/css/header.css`
- Spec states which content the HF filter acts on - `docs/spec/faceplate.md`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | e768da91 | acts-on rule for HF filters as a pure derivation |
| 1 | 2 | d9d67a88 | rail's HF lamp follows the content |
| 1 | 3 | e883423c | HF menu options say whether they do nothing on the content |
| 1 | 4 | 0ce60a46 | grayed HF menu row is drawn dead and does nothing when tapped |
| 1 | 4 repair | b19a5f40 | HF menu's content rate is a computed so an unchanged status push wakes no reader |
| 1 | 5 | 9c221f42 | faceplate spec states which content the HF filter acts on |

## Deviations

- [deviation] Task 3 read `engineStatus.value` directly in `hfNow`, so every status push re-rendered the HF components; the coordinator's `make check` caught it in `tests/js/contracts/render-cost.test.js` (2 failures, `3 !== 0` and `2 !== 0`; 5/5 at 70d0504d). Fixed in code, test untouched, b19a5f40. Task 4's owner check was moved after task 5 because the rebuild refuses a red gate.
- [deviation] `.claude/task-check.sh` run in this checkout without `PYTHONPATH=$(pwd)` imports `hqptuner` from `.claude/worktrees/integrate`, and `check_openapi.py` reports false drift; every gate in this phase ran with `PYTHONPATH=$(pwd)`. The script was not changed.

## Open items

- Owner visual check of task 4 at the hand-back URL is pending: with a 44.1 kHz track and an 88.2 or 176.4 kHz track, the engine-row HF menu's non-acting rows show in dead ink with no badge or text, a tap on one does nothing, and the rail HF lamp is lit only on content the engaged filter acts on.
- `.claude/task-check.sh` does not set `PYTHONPATH` for this checkout, so its gate goes falsely red here.

## Goal check

The commits plausibly deliver the goal. e768da91 adds the acts-on rule, d9d67a88 wires the rail lamp to it, and e883423c with 0ce60a46 carry the same rule into the HF menu. `PYTHONPATH=$(pwd) bash .claude/task-check.sh` printed `PASS — gate green, hqptuner:dev rebuilt from the working tree and serving.` at 9c221f42. No commit touches Python, so the engine's own HF reporting is unchanged and the rule depends only on the content rate the status push already carries. What is not yet evidenced is the rendered result: no one has looked at the lamp or the dead rows in a browser, and that check stays open above.

complete locally, not CI-verified
