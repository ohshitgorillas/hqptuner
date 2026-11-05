# Phase 2: Baseline recovery - Context

Gathered: 2026-11-05

Feeds: /cad-plan 2

## Scope boundary

In: in `.claude/worktrees/integrate` (branch `rebuild/integrate`), reproduce the affected JS baseline fresh, then bring every test file of it, plus every importer of each repaired shared helper, to zero failures through test-machinery repairs and production fixes (design step 12a). Migrate every field-value seed under `tests/js/`, failing and passing files alike, from `config.value` / `matrixConfig.value` to `seedReadings`. Audit WIP commit `6343d922`.

Out: porting retired shapes such as `fileTruth` (Phase 3, step 12b); the JS coverage command exiting 0 at lines 95 / branches 90 and green CI (Phase 4, per Phase 1 D-05); changes to `seedReadings` or `fieldReading`; any work on `v2`.

Deferred: None.

Plan shape: multiple plans, same phase (owner's size answer; /cad-plan breaks it down, shared helpers before their callers).

## Durable decisions

- D-01 (Form signals): `config.value` and `matrixConfig.value` carry only `fields` (names, options, bounds), `profiles` and `device_caps`; the `file`, `active` and `rows` keys are removed from every fixture. Rejected: leaving empty `file: {}` / `active: ""` placeholders. Evidence: `hqptuner/static/store/resolve.js:78-82`, `store/ui/options.js:141`, `store/faceplate/stations.js:43`, `store/narrow/devicecaps.js:62` (the only production reads), `store/signals.js:28-29`, owner commit `c530a6e3`.
- D-02 (Helper repairs): a repaired support helper keeps its callers' signatures where it can, seeds the values it receives through the one `seedReadings`, and strips them from the form signal. Rejected: changing each helper's signature and rewriting every caller. Evidence: owner commits `59916b51`, `c530a6e3`; `tests/js/support/devicecaps-harness.js:142-176`; `rebuild-integrate-design.md:87`.
- D-03 (Failure routes): each failure takes exactly one route. Wrong test machinery is a lead-authored `repair` to `test-writer` with claims and assert lines byte-identical. An implementation failing a valid claim goes to `builder` with the failing test unchanged, and `test-writer` writes a red test first when no valid failing test exists. An assertion contradicting approved behavior takes the contract-mismatch route, `moved` only with before-and-after document quotations. Shared-helper repairs land before their callers. Evidence: `rebuild-integrate-design.md:87,104,124`; `~/.claude/agents/test-writer.md:81-89`; `~/.claude/agents/divvyer.md:72`.

## Decisions

- D-04 (Baseline list): before any repair, the baseline is reproduced fresh on the current `rebuild/integrate` tip, and the exact failing test-file list and full log are kept at a durable path outside `/tmp`. The Oct 29 log `/tmp/gate-make-xpmIlBwM.log` (209 failures in 56 files) predates `6343d922`, `59916b51`, `c530a6e3` and `151e8723`, so it is not the list. Evidence: `rebuild-integrate-design.md:124`; `docs/queue.md:356`; `.planning/phases/1/SUMMARY.md:38`.
- D-05 (Every cause): every failing baseline test is adjudicated in this phase whatever its cause, including writes to computed signals (`speakers.value =` at `rail-staged.test.js:130` against `store/matrix/speakers.js:50`), "direct_sdm is not staged", `openPanel` undefined and "expected a recognized block". None is deferred to Phase 3. Evidence: `rebuild-integrate-design.md:18,126`.
- D-06 (Exit command): the exit check is one `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <files>` run with no coverage flags; `make test-js` is not the exit command because its thresholds cannot be met by a subset. Evidence: `Makefile:135-142`; `tests/js/support/vendor-resolve.js:1-30`; Phase 1 D-05.
- D-07 (Helper consumers): "consumers of a repaired shared helper" means every importer of each touched support file, including files `6343d922` touched (`listsfixture.js` 14 importers, `shaperfit-fixtures.js` 8, `profile-fixtures.js` 8, `field-harness.js` 6, `threetrees.js` 4, `easy/easytiles.js` 4, `devicecaps-harness.js` 3, `rendered/pipelines-fixture.js` 2, `rendered/volume-range.js` 2). Evidence: import-path grep 2026-11-05; `git show --stat 6343d922`.
- D-08 (Seed scope): INTG-02 covers all of `tests/js/`, so the about 10 passing files that seed values are migrated in this phase, each with its pre-edit pass recorded and its asserts byte-identical. Evidence: owner answer; `.planning/REQUIREMENTS.md` INTG-02.
- D-09 (Helper-routed seeds): seeds that pass through a helper's parameters count toward INTG-02: `field-harness.js` `reset({fields})`, `easy/easyrate.js` `configPayload` (assigned at `easy/easytiles.js:279`), and `profile-fixtures.js:64-65`. Evidence: `tests/js/support/field-harness.js:34,129,145-146`; `tests/js/support/easy/easyrate.js:68-73`.
- D-10 (Seed builder fixed): `seedReadings` and `fieldReading` stay unchanged; `seedReadings` replaces `readings.value` whole, so a test seeding config and matrix fields seeds them in one call. Evidence: `tests/js/support/readings.js:14-51`; `rebuild-integrate-design.md:80-85`; `hqptuner/static/store/core/readings.js:52-66`.
- D-11 (WIP audit): `6343d922` is audited in this phase. Its renamed asserts in `tests/js/store/faceplate/drawers-crossfeed.test.js` (`crossfeed_enabled` to `post_bauer_enabled`, same for `_preset`) go through the contract-mismatch route or are reverted, and its engine-name behavior (`nameOf` in `hqptuner/static/model/store/reading.js`) gets a test with a red bite proof. Evidence: owner answer; `git show 6343d922`; `docs/spec/api.md:20,31`.
- D-12 (Production fix scope): production fixes touch only `hqptuner/static/` paths that a failing line of the baseline run names, and a full JS suite run serves as a regression check beside the exit check, not as the exit criterion. Evidence: `docs/queue.md` s4.2kc.d22; `rebuild-integrate-design.md:124,128`.
- D-13 (Staging): recovery commits stage paths by name and never include the untracked `uv.lock` or `.planning/reads.jsonl`. Evidence: `git -C .claude/worktrees/integrate status --short`; `~/dev/CLAUDE.md` 11.3.
- D-14 (Red commits): intermediate repair commits may land while the JS suite is red, under the owner's v2 red-commit override; other pre-commit gates still apply. Evidence: `hqptuner2/CLAUDE.md` "Active override in effect".

## Acceptance criteria

- [ ] AC1: in `.claude/worktrees/integrate`, one `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <files>` run over the retained baseline plus every importer of each touched support file prints `exit=0` with zero failures.
- [ ] AC2: the retained baseline file list and its failure log, captured on the branch tip before the first repair, exist at a path outside `/tmp`, and the AC1 run uses exactly that list plus the helper importers.
- [ ] AC3: a search under `tests/js/`, support helpers included, finds no `config.value` or `matrixConfig.value` assignment carrying a field value or a `file`, `active` or `rows` key.
- [ ] AC4: the phase's commits change no assert line in a baseline test file unless the commit records the contract-mismatch route with before-and-after document quotations, and each assert `6343d922` renamed in `drawers-crossfeed.test.js` is either reverted or carries that record.
- [ ] AC5: a test covers the `nameOf` engine-name behavior `6343d922` added, and the phase record shows that test failing against code without `nameOf`.
- [ ] AC6: `git log --name-only` over the phase's commits lists neither `uv.lock` nor `.planning/reads.jsonl`.

## Flagged assumptions

- About 20 `config.value` assignments take their payload from a variable and could not be classified by the analyzer's scan - Unclear; if wrong: more files carry value seeds than the about 33 counted, and AC3 finds them late.
- The current failure count is near Phase 1's 195, not the Oct 29 log's 209 - Likely; if wrong: the fresh baseline (D-04) is larger and the plan split needs more plans.
- `seedReadings` defaults the engine `name` to `String(value)`, so a row seeded with a plain enum index shows `"3"` rather than the option label; such a row is a test-seed issue, not a production defect - Likely; if wrong: a real naming defect is misrouted as a repair.
