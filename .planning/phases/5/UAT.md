---
status: testing
phase: 5
fields_version: 1
started: 2026-11-13
updated: 2026-11-13
---

## Items

### 1. Every triaged untested behavior is covered or struck
expected: todo.txt's triaged untested list is empty: each behavior has a test that fails when it breaks, or was struck with the owner's say-so
criterion: AC1
status: pass
first_pass: fail
source: model
evidence: todo.txt's triaged untested list holds no behavior (bullet removed after 04bbbc80). tests/live/test_live_preset_first_save.py: make mutate 'hqptuner.presets.store.live.*' kills _write__mutmut_5/_6/_7/_9/_10; hand breaks parents=False, exist_ok=False, parents dropped each fail on `assert 500 == 200`. scripts/gate.sh make check -> exit=0 log=/tmp/gate-make-vJxc8KVM.log
reported: behavior wrong - one claim remains on the list neither covered nor struck; no automated check fails on its assertion when the parent-directory creation breaks
severity: major
cause: No test fails on its assertion when presets/store/live.py:306 `mkdir(parents=True, exist_ok=True)` breaks. tests/presets/stores/test_store_first_save.py:129 goes red on mutants 5/7/9 only by StoreUnwritableError raised before its assert, which the owner ruled is not bite, and the exist_ok mutants 6/10 survive because no case saves into a parent that already exists.
fix: 04bbbc80, retest

### 2. New Python tests kill a recorded mutant
expected: Each new Python test names a `make mutate` mutant of the covered line that it kills, recorded in the plan report or commit
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: reports/plan-1.md mutant ids per task; reports/plan-2.md red-before-fix; independent spot-check: _profile_body_span mutant turns test_scoping_a_read_to_a_named_profile_with_no_body_is_refused[self-closing] red; 29 passed at HEAD.

### 3. New JS tests shown red against a deliberate break
expected: Each new JS test has a recorded red run against a deliberate break of its line, and the break is reverted (not in HEAD)
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: reports/plan-3..18 name a break and red case per task; no hqptuner/static change in 7ac93e5b..HEAD; spot-check: wireNum `Number(v) || d` reds test_a_wire_zero_is_read_as_zero_not_the_default.

### 4. No existing assertion line changed in tests/
expected: `git diff 7ac93e5b..HEAD -U0 -- tests/` removes or changes no pre-existing assertion line
criterion: AC4
status: pass
first_pass: pass
source: verifier
evidence: git diff 7ac93e5b..HEAD -U0 -- tests/: removed lines are imports, comments and hoisted helper bodies only; no assert/expect line removed.

### 5. matrix_scope has no 'no active profile' branch
expected: `hqptuner/conf/matrixscope.py` matrix_scope carries no `if not profile: return xml` branch
criterion: AC5
status: pass
first_pass: pass
source: verifier
evidence: hqptuner/conf/matrixscope.py:142 signature `profile: str`, no `if not profile` (commit 4eda6128).

### 6. make check and the e2e abuse bracket are green
expected: `scripts/gate.sh make check` and `scripts/gate.sh .venv/bin/pytest -m e2e tests/e2e/test_abuse_bracket.py` both print exit=0 (ci: check, e2e)
criterion: AC6
status: pending_ci
job: check
commit: 04bbbc80fb2764e25bc559d17f5248afdbe47ed7
first_pass: pass
source: model
evidence: Required jobs check and e2e run in GitHub Actions. Locally at 04bbbc80fb2764e25bc559d17f5248afdbe47ed7: scripts/gate.sh make check -> exit=0 log=/tmp/gate-make-vJxc8KVM.log; e2e bracket -> exit=0, 14 passed, log=/tmp/gate-pytest-lJbSvXyC.log

### 7. abuse.sh close and control redial fixes hold
expected: `scripts/abuse.sh close` uploads the baseline from audit `fields`, the control connection redials at once after a restart, and close reads state back only once the app is Ready; the e2e bracket goes red without them
status: pass
first_pass: pass
source: verifier
evidence: scripts/abuse.sh `.fields.ok`/`.fields.http` reads and Ready poll; manager.py:192 redial; plan-2 bites; spot-check: removing the redial reds test_taking_the_control_connection_down_is_followed_at_once_by_a_redial.

### 8. Four new inline noqa: S310 sites in tests/e2e/test_abuse_bracket.py lack recorded owner approval
expected: behavior wrong - repo hard rule 'Gate exemptions are owner-approved' requires approval of each inline noqa site before it is written; none is recorded
origin: verifier
status: pass
first_pass: fail
source: model
evidence: 45550f02: grep -n 'noqa: S310' tests/e2e/test_abuse_bracket.py -> lines 86 and 92 only, both in _request, down from 4 before the phase and 8 at 7ecb1e49; no new exemption site. scripts/gate.sh .venv/bin/pytest -m e2e tests/e2e/test_abuse_bracket.py -> exit=0, 14 passed, log=/tmp/gate-pytest-lJbSvXyC.log
reported: behavior wrong - repo hard rule 'Gate exemptions are owner-approved' requires approval of each inline noqa site before it is written; none is recorded
severity: major
cause: Commit e3200241 added two HTTP helpers, _get_bytes and _import_state (tests/e2e/test_abuse_bracket.py:321-339), that each build their own urllib Request/urlopen pair instead of sharing the request code _call and _live_active already hold (:78-97), so each copied the S310 noqa pair: four new exemption sites (323, 324, 332, 338), none approved.
fix: 45550f02, retest

## Summary

total: 8
passed: 7
failed: 0
pending: 0
pending_ci: 1
skipped: 0
blocked: 0
reworked: 2
