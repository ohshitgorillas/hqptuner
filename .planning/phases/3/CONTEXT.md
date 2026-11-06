# Phase 3: Retired-shape ports - Context

Gathered: 2026-11-06

Feeds: /cad-plan 3

## Scope boundary

In: in `.claude/worktrees/integrate` (branch `rebuild/integrate`), port every test and support under `tests/js/` whose fake data uses a shape production no longer reads or the server no longer sends, onto the approved interfaces (design step 12b), and excise the `config` push event at both ends.

Out: `{ data }` fakes on routes that still serve `deps.Snapshot` (`/api/matrix`, `/api/state`, `/api/status`, `/api/enumerations`, `/api/speakers`); `file_profiles` / `preset_profiles` (valid `StoredProfile` data served by `/api/matrix`); `live_active` in test names and comments (`pipeline-baseline.test.js`); the `profile-fixtures.js` `reset()` parameter names (D-02, Phase 2); coverage thresholds and green CI (Phase 4); any work on `v2`.

Deferred: None.

Plan shape: multiple plans, same phase (size question not asked; set by the coordinator from the 40 to 50 file scope, /cad-plan breaks it down, shared helpers before their callers).

## Durable decisions

- D-01 (Retired-shape list): "retired" means a shape production no longer reads or the server no longer sends, not only what `make check` fails on; the list is `fileTruth` (`tests/js/store/live/live.test.js:147-150`), the `/api/config` `{ data }` body (9 files plus `support/easy/easytiles.js:187` and `support/wire/unreadwire.js:80-85`), `profiles` and `device_caps` keys in `config.value` fixtures (about 30 files, 8 under `components/faceplate-drawers-output/`), `live_profiles` / `live_active` keys written into `matrixConfig.value` (4 files), and the hand-built `readings.value = {...}` literal in `store/guards/xfmode-refusal.test.js:108-138`. Rejected: the literal `make check` list (only `fileTruth`), and the Phase 2 hand-off list alone. Evidence: owner answer 2026-11-06 ("everything old"); `docs/superpowers/specs/rebuild-integrate-design.md:17,103,126`; `hqptuner/static/store/resolve.js:81`; `hqptuner/static/store/core/readings.js:54,137-148`; `hqptuner/static/store/matrix/profiles.js:30,32`.
- D-02 (Config push excised): the SSE `config` event is excised at both ends: the `["config", config, data]` entry in `hqptuner/static/store/sync.js` `ROUTES`, the `Source("config", ...)` in `hqptuner/api/push.py:71`, and the tests that pin it (`tests/js/store/live/polling.test.js:116-121`, `tests/js/store/live/mirror.test.js` config cases, and the Python push tests covering the config event). It is excised because `ROUTES` unwraps `.data` from a `ConfigReading` push that carries none, so every push writes `undefined` into the form-metadata signal and never reaches `readings`. Live values keep coming from the `refreshConfig` poll, today their only working path. Rejected: re-routing the push into `readings`; deleting only the two JS tests; deferring the defect. Evidence: owner ruling 2026-11-06 ("excise"); `hqptuner/static/store/sync.js:115-122,145-146`; `hqptuner/api/routes/config.py:147-160`; `hqptuner/api/push.py:63-73`.

## Decisions

- D-03 (Kept shapes): fakes on routes that still serve `{ data }`, `file_profiles` / `preset_profiles`, test names naming `live_active`, and the `profile-fixtures.js` `reset()` parameter names stay unchanged. Evidence: `hqptuner/api/routes/matrix/matrix.py:69-76,101,183`; `hqptuner/api/routes/status.py:79,95,128,136`; `docs/spec/matrix.md:29`; Phase 2 D-02.
- D-04 (Wire-served literals): hand-written reading objects served as fake wire bodies (`store/core/control.test.js`, `store/faceplate-page/profile-core.test.js`, `store/faceplate/drawers-output.test.js`, `components/faceplate-drawers/drawer-rows.test.js`, `components/faceplate-drawers-output/drawers-output*.test.js`) are ported only where they carry a retired key from D-01; `store/core/readings.test.js` and `model/store/reading.test.js` test the reading model itself and stay. Evidence: analyzer scan 2026-11-06; `tests/js/support/readings.js:14-19`.
- D-05 (Pre-edit baseline): each port runs `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <files>` and gets `exit=0` before its edit; the port's commit message quotes that run and the after-run; asserts stay byte-identical except under the contract-mismatch route. A failing pre-edit baseline goes back to repair, not to the port. Evidence: `rebuild-integrate-design.md:126`; `.planning/phases/2/PLAN-5.md:48,81,87,93`.
- D-06 (Starting baseline): the phase opens with one full JS suite run at the worktree tip, since the last full run was at `3e90a616` and `e50d7316` was checked per-file only. Evidence: `.planning/phases/2/baseline/regression.txt`; `.planning/phases/2/UAT.md:67-77`.
- D-07 (Exit command): the whole-suite check is the `.planning/phases/2/baseline/base.txt` glob command with no coverage flags; `make test-js` thresholds are Phase 4. Evidence: Phase 2 D-06; Phase 1 D-05; `Makefile:135-145`.
- D-08 (Carried rules): Phase 2's D-03 failure routes, D-12 production-fix scope, D-13 stage-by-name and D-14 red intermediate commits apply unchanged. The design's `test-writer` agent is retired (`~/.claude/agents-retired/`), so the port rule rides cadence plan tasks as in Phase 2. Evidence: `.planning/phases/2/CONTEXT.md`; `ls ~/.claude/agents/`.

## Acceptance criteria

- [ ] AC1: a search under `tests/js/` finds no `fileTruth`, no `/api/config` or `config` push fake carrying a `data` key, no `profiles` or `device_caps` key in a `config.value` fixture, no `live_profiles` / `live_active` key in a `matrixConfig.value` fixture, and no `readings.value =` assignment outside `store/core/readings.test.js` and `model/store/reading.test.js`.
- [ ] AC2: a search of `hqptuner/static/store/sync.js` and `hqptuner/api/push.py` finds no `config` push route or source, and no test under `tests/` subscribes to or asserts on a `config` push event.
- [ ] AC3: every port commit in the phase quotes a pre-edit gate run on its files printing `exit=0`.
- [ ] AC4: the phase's commits change no assert line in a ported test unless the commit records the contract-mismatch route with before-and-after document quotations, or deletes a test pinning the excised `config` push.
- [ ] AC5: in `.claude/worktrees/integrate`, the D-07 whole-suite command prints `exit=0` with zero failures after the last port.
- [ ] AC6: `.venv/bin/pytest -m "not live" -q tests/api` run through `scripts/gate.sh` in `.claude/worktrees/integrate` prints `exit=0` after the push excision.

## Flagged assumptions

- The page reads nothing else from the `config` push, so excising it changes no user-visible behavior - Likely; if wrong: some live update the page shows today stops until the next poll.
- The v2 Python tree does not import on `v2` (Phase 2 deviation), so AC6 runs only in the integrate worktree - Likely; if wrong: AC6 can also run on `v2`.
- The `profiles: null` / `device_caps` counts (about 30 and 8 files) come from the analyzer's grep and were not re-counted - Likely; if wrong: the plan split needs resizing.
- The acceptance criteria and the size question were not put to the owner; the owner said "fine, go" after the excise ruling - planner and owner may revise both at /cad-plan.
