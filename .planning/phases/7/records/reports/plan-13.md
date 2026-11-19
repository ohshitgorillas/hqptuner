PLAN COMPLETE

Plan: /home/atom/dev/hqptuner2/.planning/phases/7/PLAN-13.md

Tasks: 7 of 7

| Task | Commit | Note |
|---|---|---|
| 1 - The builder suites share their wire, readings and staged rows | e86e59a9 | 16 clones gone; wire, enumerations, form, overlay and Headphones book in `tests/js/support/rendered/builderwire.js`; Bauer/DAC lists, config form, File values, served readings and fresh-builder reset in `profile-fixtures.js`; two live-cell cases share `liveDiffs`. Per-file case names and ok/not-ok equal baseline. `pendingOf` read against rule 13: only plumbs, shared as is; in the commit message. |
| 2 - The control suites share their input fake and their tables | ed9c2027 | Fake input, handlers, clamp and grayed-box tables in `tests/js/support/rendered/controls.js` (moved there after the filepawl cap checkpoint). 77 per-file lines equal to baseline, 0 not ok. |
| 3 - The alert suites share their unread-saves rig | f602bc1f | Health readings, junk advice, `/api/status` poll, plate signal reset, Day readings seed, tap event, fetch restore and rail stage-button finder in `rendered/alerts.js`; settings `rail.test.js` and alerts `rail.test.js` share the finder. 71 lines equal to baseline, 0 not ok. Only the plate-unread-saves~plate-unread import list is left. The shared advice reason is the neutral `reason-fixture` (alerts.test.js compares by `ADVICE.reason`, never the literal). |
| 4 - The list and page suites share their loaders and button tables | cd5de7ee | `capAt128` kept-rate table in `listsfixture.js`; list markup/opener/lists load and settle, meter `stream`, `presetTable`, `writeEngine` in `rendered/pagefixtures.js`. 220 lines equal to baseline, 0 not ok. Left: import lists; rate-cap~rate-floor and profile-core (PLAN-14's). |
| 5 - The state import suites share their rig | 4d525175 | Page reads, upload handler, archive and change event in `rendered/aboutstate.js`. 20 lines equal, 0 not ok. No clone left. |
| 6 - The faceplate suites share their page, panel and switcher rigs | 9015090a | `insertNode` in `page.js` (display-delay fake uses it); `connpanel.js` (station-load fetch fake); `switcherwire.js` (recording fetch, junk-filter engine, switcher reset); `treewalk.js` gains `pickValue` and the switcher suite takes its markup walkers from it. 168 lines equal, 0 not ok; 358 lines across the 28 other consumers of `page.js`/`treewalk.js`, 0 not ok. |
| 7 - The app and matrix suites drop their copied cases | d2212a3c | `askedWire` (in `treewalk.js`) shared by import and no-app; library-clear's two cases folded into one loop, both names kept. Same 4 cases, same names. |

Deviations: none

Full suite: `scripts/gate.sh make test-js` (the manifest JS suite; no Python touched): 5646 tests, 5634 pass, 12 fail. The 12 are the AC7 playhead baseline (test_a_start_stands_one_delay_behind_the_line_*, test_the_playhead_*, test_a_restart_*, test_after_a_stand_the_edge_moves_on_toward_the_line), not regressions. Log: /tmp/gate-make-NKq0XG6y.log.

Open items:

- `askedWire` lives in `tests/js/support/rendered/treewalk.js` under its own section: the lease names no light, store-free home for it (`page.js` is at the filepawl cap of 800, `pagefixtures.js` and `switcherwire.js` import stores statically, which `app/import.test.js` must not load before its import case). A dedicated module would need a lease amendment.
- `display-delay.test.js` still carries its own minimal fake DOM (`Node`/`Text`/`Element`); only the shared `insertNode` was removed (the jscpd clone). Replacing the fake with `fakePage`/`hostPage` would change what the case proves about the global document, so it was not done.
- Clones with a side in these component dirs but outside this lease remain: display-meters~display-range, rail-staged~rail.test (named as staying), connpanel-verdict~view-panel, display-format pair, drawer-grammar~drawer, rail-now~rail-pipelines, rate-cap~rate-floor, profile-core self-clone. PLAN-14 names rate-cap and profile-core; the rest are not in any file lease of this plan.
- display-range.test.js has its own `pick` that finds the Display panel first, so it is not a clone of `pickValue`.
