# Phase 5: Untested behaviors covered - Context

Gathered: 2026-11-12

Feeds: /cad-plan 5

## Scope boundary

In: every behavior on `todo.txt:22-40` ("untested behaviors (triaged)", about 135 behaviors across 19 bullets) gets a test that fails when it breaks, or is struck with the owner's say-so; the dead "no active profile" branch of `matrix_scope` is deleted.

Out: the trace changes of Phase 7 (SPEC-02); any coverage or mutation report as the source of truth for the list; teaching the 8088 fake `<fixed>` logic again; any new clock seam in production code; any test against the live hqplayerd.

Deferred: None

Plan shape: multiple plans (owner: big, planning splits the work into several plans inside this phase).

## Durable decisions

- D-01 (what a bullet means): each bullet lists test claims struck in the 2026-10-12 one-claim-per-test sweep and three nearby commits, not lines no test executes; no coverage or mutation report backs the list. A negative claim (no dot, reads none, raises nothing, not grayed) comes back only if its test fails on a named plausible wrong implementation (always lit, fires at once, latches dirty); a claim with no such implementation goes to the owner as a strike candidate. Evidence: commits `9bd3515b`, `b27383b9`, `14949055`, `95299f7d`, `9a92a3e4`, `a76b9e4d`, `1e6dcdf8`, `1dff97a8`, `c1fa2eb7`, `bb3db9a9`, `a235bdf3`, `a78a9d8b`; `docs/spec/testing.md:60-68` (rule 10), `:79` (rule 12).
- D-02 (bite proof): every test here characterizes code that already exists, so criterion 2's red run is a mutation, not a revert to HEAD. Python tests cite a `make mutate` mutant they kill; JS tests are run red against a deliberate break of the covered line, which is reverted after. Evidence: owner ruling 2026-11-12; `docs/spec/testing.md:43-47,104-117`; `pyproject.toml` `[tool.mutmut]`; `Makefile` `mutate`.

## Decisions

- D-03 (already covered): four behaviors are already pinned and are struck as covered once their test is shown to bite: lane.py `reenumerated` (`tests/live/test_live_reenumeration_report.py`), a staged mode equal to the running one is dropped (`tests/live/test_live_mode_first.py:61`), `presets/store/live.py` creates missing parent directories, now at :305 (`tests/presets/stores/test_store_first_save.py:121`), an idle or stopped loop queues no frame (`tests/js/store/meter/loop.test.js:232,241`). Evidence: those files; `hqptuner/lanes/live/lane.py:187-235`; `hqptuner/presets/store/live.py:298-306`.
- D-04 (uncovered): reached by no test today: health.js speed alerts, `wireNum("0")`, metering `request_timeout` bound and stuck-dial retry, matrixscope refusing a self-closing or unclosed named profile, the five fixed-volume transitions, the `health` push event, `wavRateFromHeader` on a corrupted RIFF tag, the no-copy rule's seeded composed literal, `meterFeedOpen` false while metering is off, the range-buttons load-time choice and signal move, HF with no engine state or no enumeration, engine-row "reads none" cases, hydration failure lines, the abuse.sh baseline upload. Every other component and store bullet is treated as uncovered too. Evidence: `tests/js/store/live/health.test.js`, `tests/js/lib/coerce.test.js`, `tests/js/store/live/polling.test.js:96-127`, `tests/matrix/test_matrix_scope.py`, `tests/apply/test_volume_config.py:78-100`, `tests/js/lib/wav.test.js`, `tests/js/lib/no-copy-assertions-rule.test.js:136`, `tests/js/store/meter/feed.test.js:116`, `tests/js/store/faceplate/hf.test.js`, `tests/js/store/faceplate/engine.test.js`, `tests/e2e/test_abuse_bracket.py`.
- D-05 (strikes): struck with the owner's say-so: matrixscope "reads the whole config with no active profile", whose `if not profile: return xml` branch is deleted as dead code (only caller `hqptuner/conf/matrixconf.py:130` always passes a name); "all-stations starts off"; "pref off returns options in input order, exactly three"; "shaperfit source mode lists SDM before PCM". Strikes are made in `todo.txt`, which is gitignored, so no commit carries them. Evidence: owner rulings 2026-11-12; `hqptuner/conf/matrixscope.py:142-155`; `docs/spec/testing.md:49-58,70-77`; `.gitignore:144`.
- D-06 (clocks): the health alerts run on the existing JS fake clock (`initHealth(fake.clock)`, `SUSTAIN_MS = 6000`), and the metering timeout and retry on the existing `VirtualClock` with `fall_silent()`. No production clock change. Evidence: `hqptuner/static/store/health.js:26,99-129`, `tests/js/store/live/health.test.js:16-33`, `hqptuner/engine/metering.py:148-168,245-265`, `tests/support/virtual_clock.py:70-96,199-240`.
- D-07 (fixed volume lane): fixed volume through an apply is tested at the `presetconf.apply_edits` pure lane on hand-written XML, not through the 8088 fake. Evidence: `tests/apply/test_volume_config.py:1-14,78-85`, `hqptuner/conf/fixedvol.py:67-140`, commit `b27383b9`.
- D-08 (abuse lane): no test needs the live daemon. The abuse.sh baseline upload is tested in the e2e lane only (`tests/e2e/test_abuse_bracket.py`, three wire fakes), which `make check` does not run, so its bite proof and pass need their own `pytest -m e2e` run. Evidence: `scripts/abuse.sh:20-34,180-225`, `tests/e2e/support/stack.py:1-17`, `Makefile:84-85,110-121`, `docs/spec/testing.md:21-27`.
- D-09 (meter trace): "before the feed covers a 0.1 s delay the scene shows no trace" is pinned at the meter loop's frame contract, not the painters' trace drawing, so Phase 7 does not rewrite it. Evidence: owner ruling 2026-11-12; `hqptuner/static/store/meter/loop.js:21-51`.
- D-10 (gates): new tests clear the gates as written: jscpd 2.3% over `tests/` too (shared fixtures for the many similar JS cases), one assertion per test, the assertion-shape gates, the no-copy rule, the Python suite-time bar and per-test idle gate. Python cases sit at the pure or store lane unless the behavior needs the app. Evidence: `.jscpd.json`, `Makefile:45-61`, `docs/spec/testing.md:27-41,119-123`, `scripts/gates/testing/`.

## Acceptance criteria

- [ ] AC1: Every behavior on `todo.txt:22-40` has a test that fails when it breaks, or is struck from the list with the owner's say-so.
- [ ] AC2: Each new Python test kills a recorded `make mutate` mutant of the line it covers.
- [ ] AC3: Each new JS test is shown red against a deliberate break of the line it covers, and the break is reverted.
- [ ] AC4: The phase's git diff changes no existing assertion line in `tests/`.
- [ ] AC5: `matrix_scope` in `hqptuner/conf/matrixscope.py` no longer has its "no active profile" branch.
- [ ] AC6: `scripts/gate.sh make check` and `scripts/gate.sh .venv/bin/pytest -m e2e tests/e2e/test_abuse_bracket.py` both print `exit=0`.

## Flagged assumptions

- The component and store bullets beyond those checked in D-04 are all uncovered; none was checked one by one - Likely; if wrong: a few behaviors re-pinned under new names get duplicate tests, which rule 12 deletes.
- Some strikes in `9bd3515b` look wrong under rule 10 and come back with their discrimination stated, e.g. `wireNum("0", -60) === 0` kills `Number(v) || d`, and "held just short of six seconds does not alert" kills an alert that fires at once - Likely; if wrong: the restored test is a tautology and is struck again.
- Deleting the `matrix_scope` branch narrows its `profile` parameter to `str`; no other caller exists - Confident; if wrong: a caller passing `None` reads a scoped body error instead of the whole config.
- abuse.sh close keeps its `sleep 2` retry and readback loops, which the e2e rule allows as bounded condition polls - Likely; if wrong: the e2e test is slow or flagged by the clock gates.
