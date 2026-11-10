---
phase: 4
status: complete
completed: 2026-11-07
---

# Phase 4: Integrate into v2 - Summary

`rebuild/integrate` is merged into `v2` by the `--no-ff` merge commit `d1fbfb2b`, and `scripts/gate.sh make check` exits 0 on `v2` after it (`.planning/phases/4/baseline/v2-check.txt`).

## What shipped

- `make check` green on `rebuild/integrate` at fe97fb16 - `.planning/phases/4/baseline/integrate-check.txt` (Plan 1).
- Local e2e suite green on integrate, 143 passed, with the production defects behind its failures fixed - `.planning/phases/4/baseline/e2e.txt`, `integrate-final.txt` (Plan 2).
- `rebuild/integrate` merged into `v2`, the dirty planning files committed, `make check` green on `v2`, the phase's commits audited, and the dev container rebuilt from `v2` - `.planning/phases/4/baseline/v2-check.txt`, `audit.txt`, `task-check.txt` (Plan 3).

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1, 3 | 341a2d67 | Record `make check` green on integrate at fe97fb16 |
| 2 | 2 | 631afbda, 55d5a0d0, 528dd9d0, a45d2916 | e2e causes 1 to 4 |
| 2 | 2 | 7e26d181 | `scripts/abuse.sh` `form_of` reads the config reading as served |
| 2 | 2 | cd9aa0e3 | Dropped settings on the health wire (excised later, see Deviations) |
| 2 | 2 | abe984ba | `useBodyResize` runs after the render of a changed plate line |
| 2 | 5 | 145017b7, bc6c91ee, a3d08308 | risk_surface fix passes on the drop report |
| 3 | 1 | d1fbfb2b | `merge: rebuild/integrate into v2` |
| 3 | 2 | 0258e453 | `.planning/CAPTURE.md` todo checked off, `.planning/config.json` formatted |
| 3 | 3 | 737ccda9 | Record `make check` green on `v2` |
| 3 | 4 | 4a41bee9 | Record the audit |
| 3 | 5 | d2537a0b | Record task-check green and the container rebuilt |

## Deviations

- [deviation] Plan 2's premise that the e2e failures were machinery or a missing spec change was wrong in part: causes 3, 4 and 7 were production defects and cause 6 was missing backend wiring (Plan 2 report).
- [deviation] Plan 2 landed a dropped-settings report (cd9aa0e3 and its fix passes). The owner then ordered it excised, which the off-roadmap task `excise-drop-report` did on integrate before the merge: 082482ca, 85fd14fb and 5c2e3007 (`.planning/tasks/excise-drop-report/RECORD.md`).

## Open items

- `POST /api/restore` reads its upload whole with no size cap, and `presetzip.take_descriptions` inflates every zip member with no limit (`hqptuner/api/routes/config.py:294`, `hqptuner/conf/presetzip.py:170-172`); `/api/state-import` bounds its input by `cfg.state_max_bytes`. The risk_surface review of Plan 3's range raised it at medium and it survived; it is not fixed (`ADJUDICATION-risk_surface-plan-3.json`).
- A green `make test-e2e` takes 589.64 s, 10.4 s inside the 600 s command watchdog (Plan 2).
- `Outcome`, `Standing.ended` and `outcome()` in `hqptuner/core/lifecycle.py` are read only by tests, and `AlertItem` and the Items renderer in `AlertLines.js` have no caller after the excision; `docs/spec/lifecycle.md` rule 10 still describes the outcomes.
- The `hqptuner/lanes/live/rate.py` module docstring is one line, because the comment-trivia judge refused every multi-sentence version; the facts it dropped are in `docs/spec/protocol.md`.
- The owner has not yet looked at the rebuilt faceplate at http://10.0.0.238:8090.

## Goal check

The phase goal is met on the evidence: `git merge-base --is-ancestor rebuild/integrate v2` exits 0, and `d1fbfb2b` has parents `1ce87572` and `5c2e3007` with the subject `merge: rebuild/integrate into v2`. `make check` on `v2` at 0258e453 printed `exit=0 log=/tmp/gate-make-NMy3t3HZ.log`: pytest 3657 passed, node 4856 pass and 0 fail, JS coverage 97.16 / 91.62 / 90.94. The audit in `.planning/phases/4/baseline/audit.txt` found no threshold change, no exemption marker and none of `uv.lock`, `.planning/reads.jsonl` or `.planning/phases/2/baseline/failures.log` in either range. `curl` to `127.0.0.1:8090` returns 200. The e2e suite was run on integrate at abe984ba, not on `v2` after the merge and the excision.

complete locally, not CI-verified
