PLAN CHECKPOINT: blocked
Plan: .planning/phases/4/PLAN.md
Tasks: 0 of 3 fully satisfied (Task 1 committed, its Verify tail not met; Tasks 2 and 3 not started)
| Task | Commit | Note |
|---|---|---|
| 1 - The plate dims while HQPlayer has no connection | b6c484a4 | `hqplayerAway` computed in conn.js (phase Down/Alarm only), `data-away` stamped by Plate, base.css rule shared with `data-restarting`, comments rewritten in enginewrite.js and base.css. Tests first: conn.test.js (6 appended tests, SyntaxError red at HEAD) and plate-away.test.js (2 tests, red at HEAD), then green. plate-restarting, render-cost, plate, conn pins green; `make test-js` exit=0; eslint, prettier, tsc, knip, css gates clean on JS side. `git diff 36709b23 -- plate-restarting.test.js` empty; no pointer-events/inert in base.css. |
Deviations: none
Open items:
- `scripts/gate.sh make check` exits 2 at `make lint` on `scripts/gates/check_openapi.py` (OpenAPI snapshot drift: `playback_stopped` removed from LiveApplyReport, description changed). Backend v2 work, not touched by this plan. `make lint` stops there, so `make check` and `.claude/task-check.sh` (which hard-gates the rebuild on it) cannot pass; no container rebuild, no hand-back URL.
- `make lint-js` exits 2: `jscpd` python (151 clones, tests/e2e) and javascript (167 clones, 2.28% tokens) runs report clones; python run fails, pre-existing. Every other lint-js step passed run by hand.
- Task 1 human-verify (owner sees dim at hand-back URL with HQPlayer away) not done: needs the rebuild above.
- Tasks 2 (e2e) and 3 (lifecycle.md row) not started; contract stops at a checkpoint.
- Lean shape: no configurable away set; Down/Alarm inline.
