PLAN COMPLETE

Plan: .planning/phases/7/PLAN-5.md

Tasks: 3 of 3

| Task | Commit | Note |
|---|---|---|
| 1 - Apply inert and LIVE edits held while not ready | 85c9e708 | New `tests/js/store/live/live-held.test.js` (3 cases) and the replaced pendingbar case were red against pre-change code, green after. `connected` computed removed from signals.js. Fixture upkeep: live.test.js, live-reenum.test.js and support/easy/easytiles.js `resetLive` now seed a ready `health`, because `writeLive` holds while not ready. `make check` exit=0. |
| 2 - D-06/D-09/D-15 comments and docstrings | 0abfd055 | Comment, docstring and log-text changes in the six source files; `docs/openapi.json` moved by the one `matrix_profile` description (regenerated with `--write`, then `prettier --write` to keep the file's formatting). `check_openapi.py` exit=0, `make check` exit=0. |
| 3 - sweep | none (nothing to rewrite) | Every grep hit is kept, see Open items. Looser second grep found nothing relevant. `docs/architecture.md` section 1 already states the two-lane requirement. |

Deviations: none

Open items: the plan's Verify names `scripts/gate.sh npm test`; there is no `test` npm script, so `make test-js` (inside `make check`) was the JS gate. The final suite is `make check` (no `workflow.test_command` set), run green on the tree of the last commit 0abfd055 before it was committed. `make test-e2e` exit=0 (106 passed) with `HQPTUNER_CHROMIUM=/usr/lib64/chromium-browser/headless_shell`; the first run without it failed at browser launch (no ms-playwright chromium on this host).

Open items: Task 3 kept hits (wire fact or refusal, none presents a 4321-only mode as working): `hqptuner/api/routes/config.py:4` (state-export route reads only HQPTuner's own files; it names the dependency, own-store route the gate leaves open); `tests/apply/test_manager_connect_load.py:53` (parametrize id for a state, not a mode); `hqptuner/static/css/features/easy.css:275`, `hqptuner/static/components/speakers/Card.js:234,259`, `tests/js/store/live/live-reenum.test.js:299`, `tests/js/components/matrix/speakers.test.js:140`, `docs/guide/notes/ui-inventory.txt:133` ("still applies" in unrelated senses); `hqptuner/core/manager.py:374` (refusal: raises when no credentials); `hqptuner/core/connection.py:218` (the rule "no credentials, no 8088 lane"); `hqptuner/api/deps.py:78` (refusal wording); `tests/e2e/test_hwapply.py:63` (fake daemon takes the whole 8088 lane down, test-infrastructure note); `tests/api/surface/test_not_ready_reads.py:1` (the readiness gate's own open reads, answered from last-read data); `tests/support/fake_network.py:283` (Digest wire fact); `tests/gates/test_openapi_snapshot.py:75` (a route needing no daemon); `docs/architecture.md:35,85` (35 states the two-lane requirement; 85 is a refused-setter wire fact); `docs/plans/credentials-apply-fetch-race.md:66` (states `ready` stays false, a refusal).

Open items: `make trivia` exits 2 on uncommitted `.planning/` files only (FILED.md, phases/5, 6, 8 plans and CONTEXT: dated-event and narration flags); none is in a path this plan changed or committed. Not touched.

Fix pass (risk_surface review, owner ruling 2026-11-11, D-08 amendment):

| Task | Commit | Note |
|---|---|---|
| Fix - remove the LIVE hold; the refusal shows on the control | 585e5fbe | `writeLive` sends every write (the former `sendLive` is now `writeLive`); `held`, `flushHeld`, the flush `effect`, `sendable` and the unused imports (`effect`, `untracked`, `ready`, `engineRestarting`) are gone. `live-held.test.js` renamed `live-not-ready.test.js` with 3 cases, red against 0abfd055 (3 of 3 failed), green after: a LIVE edit made while not ready is sent as one `POST /api/config/live`; the same during the app's own restart while `ready` still reads true; the server's refusal text shows on the edited control's error. Removed tests and what each pinned: `test_live_edits_made_while_not_ready_send_nothing` (an edit made while not ready sends nothing), `test_held_live_edits_go_out_once_per_setting_with_the_newest_value_when_ready` (held edits flush on ready, one per setting, newest value), `test_a_live_edit_made_during_the_apps_own_restart_is_held_though_ready_still_reads_true` (the restart flag holds an edit though ready reads true). Ready-health seeding reverted in `live.test.js`, `live-reenum.test.js` and `tests/js/support/easy/easytiles.js` (those tests no longer need it). `PendingBar` still reads `ready`, so Apply, Save and Save as New stay inert. No new user-facing text. `make check` exit=0 after `check_suite_time.py --accept` (suite 98.7s, last green 92.3s, +6.4s, inside the owner-covered 5 to 10 s band). `make test-e2e` exit=0 (106 passed) on the final tree. |

Open items (fix pass): `docs/architecture.md` and PLAN-5 Notes untouched by this fix (the orchestrator owns `.planning/`). No process left running.
