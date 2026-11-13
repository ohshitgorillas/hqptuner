---
phase: 4
plan: 1
requirements: [BUG-05]
files:
  - hqptuner/static/store/faceplate/conn.js
  - hqptuner/static/components/faceplate/Plate.js
  - hqptuner/static/css/base.css
  - hqptuner/static/store/enginewrite.js
  - tests/js/store/faceplate/conn.test.js
  - tests/js/components/faceplate/plate-away.test.js
  - tests/e2e/test_plate_dims_while_hqplayer_away.py
  - docs/spec/lifecycle.md
---

# Phase 4: Dimmed while HQPlayer is away - Plan 1: The plate dims while HQPlayer is away

## Goal

The app is dimmed while HQPlayer is unavailable or disconnected, and undimmed once it is back.

## Must be true when done

- While HQPlayer has no control connection to HQPTuner (health phase Down or Alarm), the whole plate shows dimmed, the same look the plate already takes while an own restart is under way.
- Once HQPlayer is connected again (health phase Reachable or Ready), the plate is no longer dimmed, with no reload of the page.
- An HQPlayer that goes away on its own (a crash, a `systemctl restart`, another client's write) dims the plate, not only a restart HQPTuner asked for.
- While the plate is dimmed for HQPlayer being away, every control still takes a tap and the action it starts proceeds: nothing is disabled, made inert or blocked from the pointer.
- The existing restart dim is unchanged: the plate still dims for the length of a write that takes the daemon down, and an all-live apply still does not dim it.

## Context

- No CONTEXT.md for this phase; the meaning of "away" is a planner choice recorded in Notes for the owner.
- The page dim exists: `hqptuner/static/css/base.css` `.plate[data-restarting]` at `var(--op-2)`, stamped by `Plate` from `engineRestarting` (`hqptuner/static/store/enginewrite.js`), opacity only, every control live. This phase adds a second cause to that one look.
- `docs/spec/lifecycle.md` binds: the page reads the phase off health (`phase` in `hqptuner/static/store/signals.js`), never its parts, holds no copy and decides nothing about reachability ("Adding a consumer of the phase", rule 8).
- Product rule: user actions always proceed; the dim is a look, never a gate. No user-facing text is added or changed. No `CHANGELOG.md` entry (the v2 changelog is the owner's alone).
- Out of scope: HQPTuner's own backend becoming unreachable to the page (health then stays at its last value); the brand knob's states and copy.

## Tasks

### Task 1: The plate dims while HQPlayer has no connection

- **Files:** hqptuner/static/store/faceplate/conn.js, hqptuner/static/components/faceplate/Plate.js, hqptuner/static/css/base.css, hqptuner/static/store/enginewrite.js, tests/js/store/faceplate/conn.test.js, tests/js/components/faceplate/plate-away.test.js
- **Reads:** hqptuner/static/store/faceplate/conn.js#connState, hqptuner/static/store/signals.js#phase, hqptuner/static/components/faceplate/Plate.js#Plate, hqptuner/static/store/enginewrite.js#engineRestarting, hqptuner/static/css/base.css#.plate[data-restarting], docs/spec/lifecycle.md#The one phase, docs/spec/testing.md#Frontend, docs/spec/design-system.md
- **Pins:** tests/js/components/faceplate/plate-restarting.test.js, tests/js/store/faceplate/conn.test.js, tests/js/components/faceplate/plate.test.js, tests/js/contracts/render-cost.test.js
- **Action:** Make the plate dim whenever the health phase says HQPlayer has no connection, and undim when it has one again. Behavior the owner wants: phase Down or Alarm means HQPlayer is away and the plate dims; phase Reachable or Ready means HQPlayer is there and the plate does not dim on this account; no health reading yet (phase null) does not dim, since nothing has said HQPlayer is away. The decision lives in the store beside `connState` in `hqptuner/static/store/faceplate/conn.js` (the faceplate's reading of the connection), read from the `phase` computed only, never from `health`'s other fields and never from `inFlight` (which `conn.js` also imports for `connState`), so an own write in flight with phase Ready does not dim the plate, and exposed as a computed whose value moves only when the away answer moves; update that file's header comment to name both readings. `Plate` stamps a mark of its own on the `.plate` element while the store says away, and `base.css` draws that mark with the same `var(--op-2)` opacity as `.plate[data-restarting]`, no new token, no literal, and no `pointer-events`, `inert`, `disabled` or `aria-disabled` anywhere, because the product rule says every action proceeds while dimmed. Keep `data-restarting` and `engineRestarting` exactly as they are, with their meaning (the daemon is going away for a write HQPTuner sent), so `plate-restarting.test.js` stays green unedited; an own restart that also drives the phase Down simply shows both marks under one look. Rewrite the comments that would become false: the `enginewrite.js` header ("The page dim reads this alone") and the `base.css` comment over the dim rule, so both say the dim has two causes, an own restart and HQPlayer being away. Do not let `Plate` read `health.value` or `engineStatus.value` directly: health pushes move `connected_at` on every poll, and a direct read re-renders the whole plate on each push, the defect `tests/js/contracts/render-cost.test.js` caught in phase 3 (`.planning/phases/3/SUMMARY.md`, phase 3, recalled memory). Write the tests first and take a red run against the code at HEAD before implementing (`docs/spec/testing.md` rule 8); the unit, the lane and the assertions are the test writer's, within the two test files leased here, held to rule 15 (lowest lane) and rule 12 (no test that cannot fail without another).
- **Verify:** Testing scope: the outcomes are the away answer for each phase (Down, Alarm away; Reachable, Ready, null not away) and the plate carrying its dim mark when away and not when back. Already covered: the restart mark (`plate-restarting.test.js`) and the knob's states (`conn.test.js`), which stay green unedited. Smallest new checks: the store's away answer per phase, and one rendered check that the plate's mark follows that answer both ways. Evidence sufficient: the new tests red against the HEAD implementation (36709b23 or the phase base) with tests kept, then green; testing stops there, since the opacity look and the live controls are Task 2's browser check. Then `scripts/gate.sh make check` prints `exit=0`, with `tests/js/contracts/render-cost.test.js` passing; `grep -n "pointer-events\|inert" hqptuner/static/css/base.css` shows nothing on the new rule; `git diff 36709b23 -- tests/js/components/faceplate/plate-restarting.test.js` is empty. Then `bash .claude/task-check.sh` passes (rebuilds `hqptuner:dev`, health-checks `:8090`). human-verify: at the hand-back URL the owner, with HQPlayer away for the dev container (for example the connection panel pointed at an address with no HQPlayer, then put back), sees the whole plate dimmed, taps a control and sees it respond, and sees the plate undim once the address is restored. No agent stops hqplayerd or points it anywhere to produce this.

### Task 2: A browser shows the away dim and every control still takes a tap

- **Files:** tests/e2e/test_plate_dims_while_hqplayer_away.py
- **Reads:** tests/e2e/conftest.py#stack, tests/support/fake_control.py#take_lane_down, tests/e2e/test_hf_menu_dead_rows_look_dead.py, tests/e2e/support/stack.py#_app_env, docs/spec/testing.md#Frontend
- **Pins:** tests/e2e/test_hf_menu_dead_rows_look_dead.py, tests/e2e/test_stop_and_restart.py
- **Action:** Add a browser test of the behavior only a browser computes: with the control lane taken away, the plate looks dimmed against its own look before the lane went, a user action started while dimmed proceeds (an action whose effect is observable without the engine, such as opening a drawer or the Settings body, or a staged edit reaching the pending buffer; the writer picks), and once the lane is back the plate looks as it did before. Compare looks only with other observed looks, never with a literal opacity or token, as `test_hf_menu_dead_rows_look_dead.py` does. Take the lane away through the control fake's state (`_down` with a generation bump, as `take_lane_down` does) and bring it back by clearing `_down` in the same test, with cleanup that runs on failure, because the `stack` fixture is session-scoped and every later test needs a live lane; or give the module a stack of its own, as `test_stop_and_restart.py` does, if bringing the session lane back proves unreliable. Every wait is a bounded ceiling on an observed condition (the e2e app polls at 0.1 s and alarms at 0.05 s), never a fixed sleep (repo rule: slow tests are defects). Disclosure for the executor's report: the run launches headless chromium and the app subprocess for a few seconds; run this file alone, not the whole e2e suite, while iterating.
- **Verify:** Testing scope: the outcomes are the dimmed look while away, an action proceeding while dimmed, and the undimmed look on return; the rendered mark is already pinned by Task 1, so this file asserts only the computed look and the action's effect. Evidence sufficient: with Task 1's three behavior files (`hqptuner/static/store/faceplate/conn.js`, the `Plate` component and `hqptuner/static/css/base.css`; the `enginewrite.js` edit is comment-only) reverted to the phase base (tests kept), the dimmed-look case runs red; restored, `scripts/gate.sh .venv/bin/pytest tests/e2e/test_plate_dims_while_hqplayer_away.py -q` prints `exit=0`, and `scripts/gate.sh make test-e2e` prints `exit=0` (state its footprint before running, per `~/dev/CLAUDE.md` 3.1: the whole e2e suite under headless chromium), showing no later e2e test inherits a dead lane. Testing stops there. `scripts/gate.sh make check` prints `exit=0`.

### Task 3: The lifecycle spec names the page dim as a phase consumer

- **Files:** docs/spec/lifecycle.md
- **Reads:** docs/spec/lifecycle.md#The lifecycle pipeline, docs/spec/lifecycle.md#Rules
- **Action:** Add the page dim to the lifecycle pipeline table as the hop that draws the phase (Down or Alarm dims the plate) and the page's own restart write, homed in `store/faceplate/conn.js` and the plate, written in the table's existing voice and module-path style. Change no other row and no rule: the dim reads the phase and decides nothing about reachability, which rule 8 already allows. Write with Edit, soft-wrapped, one row per line.
- **Verify:** `grep -n "Page dim\|dim" docs/spec/lifecycle.md` shows the new row inside the pipeline table; `python3 .claude/hooks/md-softwrap.py --check docs/spec/lifecycle.md` passes; `git diff HEAD -- docs/spec/lifecycle.md`, run before the task commit, touches only that one row.

## Notes

- **Owner choice to confirm, the meaning of "away".** Chosen: phase Down or Alarm dims; Reachable, Ready and no reading do not. Reason: the existing dim means "the engine is not there right now" (`enginewrite.js`), and in Reachable the control connection stands and live writes work; `docs/spec/lifecycle.md` also says an install with no management credentials sits Reachable by design, which would be dimmed for good if Reachable dimmed. The brand knob, by contrast, reads red for Reachable too (`connState`). If the owner wants the dim to follow the knob's red exactly, the store answer in Task 1 widens to every phase but Ready, at the cost of a permanent dim on an install without management credentials.
- The whole plate dims, brand knob and connection panel included, matching the existing restart dim; nothing is carved out.
- Not covered: HQPTuner's own backend going away from the page. The push stream then stops and health keeps its last value, so the plate does not dim. The requirement names HQPlayer, so this is left out; it is a candidate for its own item.
- No user-facing text, no `data/*.json`, no `CHANGELOG.md` change. A user-visible change like this may look missing from the changelog; the entry is the owner's to write.
- Caller-side delta: no split or extraction; `Plate` is the only new reader of the store's away answer, and `connState`'s callers are untouched.
- Footprint: Task 1 and Task 2 run `make check` and a browser e2e file through `scripts/gate.sh`; the e2e run holds chromium and the app subprocess for seconds. No write reaches hqplayerd.
