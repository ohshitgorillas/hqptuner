---
phase: 8
plan: 5
depends_on: [1, 2, 3, 4]
# Phase 8 maps no requirement ID (ROADMAP: "Requirements: None"); this plan records all thirteen findings' dispositions (Success Criterion 1, CONTEXT AC6) and the changelog entry.
requirements: []
files:
  - .planning/security/DISPOSITIONS.md
---

# Phase 8: Config write path and input validation - Plan 5: The changelog entry and the dispositions

## Goal

Findings F-006, F-007, F-010, F-011, F-012, F-013, F-014, F-016, F-018, F-019, F-026, F-032 and F-033 are each fixed or carry an owner ruling. This plan records that: a check that the `[Unreleased]` `### Security` bullets Plans 1 to 4 landed are the approved ones, and one disposition per finding in `.planning/security/DISPOSITIONS.md`.

## Must be true when done

- `CHANGELOG.md` `[Unreleased]` `### Security` carries every owner-approved bullet for this phase, verbatim, each in the commit of the task it describes, and `scripts/gates/check_changelog.py` passes (D-16).
- `.planning/security/DISPOSITIONS.md` holds one entry for each of the thirteen findings, in the file's finding order and the phase 4 shape: every fixed finding names its commits and a proof that fails against the pre-fix code, and every declined or partly declined one quotes the owner's ruling (AC6, D-16).
- `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows` pass on the phase's last `dev` commit (AC6). That is read by `/cad-verify` with `ci-status` after the owner pushes; no task here pushes.

## Context

- Locked: D-03 (F-012 declined, owner ruling quoted), D-04 (F-007's safety copy declined, quoted), D-05 (F-011 declined), D-06 (F-018's thread move declined), D-07 (F-033's regex and error-boundary clauses declined), D-16 (the record and the copy).
- The entry shape is the existing one: `### F-NNN · <title as REPORT.md gives it>`, then `- Disposition:`, `- Commits:` (each hash with a parenthetical saying what it did), `- Proof:` (test node ids), and `- Owner ruling:` or `- Residual accepted by the owner:` quoting verbatim.
- Markdown is written with `Write`/`Edit`, soft-wrapped (`.claude/hooks/md-softwrap.py`). Em dashes are forbidden in owner copy.

## Tasks

### Task 1: The changelog carries every approved Security bullet of the phase

- **Files:** none (a read-only check; `CHANGELOG.md` is written by the marked tasks of Plans 1 to 4, each bullet in its own task's commit, per the repo's same-commit changelog rule).
- **Action:** Compare `CHANGELOG.md` `[Unreleased]` `### Security` against the owner-approved bullets (Plan 1 Notes, copy item 12): every approved bullet is present character for character, below the two that were there before the phase, and `git log -p` shows each one added in the commit of the task it describes. A missing or differing bullet is a defect in that task's commit and goes to the owner as a blocking question; this plan never drafts or edits a bullet.
- **Verify:** `scripts/gate.sh .venv/bin/python scripts/gates/check_changelog.py` prints `exit=0`; each approved bullet's text is found verbatim in `CHANGELOG.md`, and its adding commit is one of the marked tasks' commits. No rebuild and no URL.

### Task 2: Every finding of the phase has its disposition

- **Files:** .planning/security/DISPOSITIONS.md
- **Action:** Insert thirteen entries among the existing ones in finding order, each titled exactly as `.planning/security/REPORT.md` titles the finding, commits and proofs read from `git log` and the test files Plans 1 to 4 landed. Each Proof names at least one test that went red in its task's bite run (or, for a static discharge, the test the task's null stub fails), never a characterization case alone. Dispositions:
  - F-006: Fixed (Plan 1 Tasks 1, 2, 5, 6, 7).
  - F-007: Fixed by the member-name rule and the ceilings (Plan 2 Tasks 1, 2, 4), with the safety copy declined; quote D-04: "smells like scope expansion".
  - F-010: Fixed (Plan 3 Tasks 1, 2, 3).
  - F-011: Declined; quote the owner's ruling as approved for the record (copy item 13), D-05 recording the confirmation and its reasons.
  - F-012: Declined; quote D-03: "why the fuck do you want to refuse valid user actions? flagrant rule violation".
  - F-013: Fixed (Plan 1 Tasks 5, 6, 8).
  - F-014: Fixed (Plan 3 Task 3).
  - F-016: Fixed (Plan 2 Tasks 1, 2, 3).
  - F-018: Fixed by bounds (Plan 1 Task 4, Plan 2 Tasks 1 and 2, Plan 4 Task 3), with moving the bounded archive and XML work onto threads declined; quote the ruling as approved (copy item 13); the `/api/state-export` memory clause carries the owner's Q3 ruling (Plan 1 Notes), quoted as approved (copy item 13), and if Q3 was ruled a fix, its commits and proof are named here instead; the discovery item was closed under F-020. Every clause of the finding's text in `.planning/security/REPORT.md` is either named as fixed or quoted as ruled: none is left out.
  - F-019: Fixed (Plan 1 Task 3, the anchoring, held by characterization; Plan 1 Task 4, the ceiling, the proof that fails against the pre-fix code, per D-09).
  - F-026: Fixed (Plan 4 Tasks 1, 2).
  - F-032: Fixed (Plan 2 Task 5).
  - F-033: Fixed for the own-key lookups (Plan 4 Task 4), with the regex rewrite and the error boundary declined; quote the ruling as approved (copy item 13).
- **Verify:** `.venv/bin/python .claude/hooks/md-softwrap.py --check .planning/security/DISPOSITIONS.md` exits 0; `grep -c '^### F-0' .planning/security/DISPOSITIONS.md` counts thirteen more than before the task; every hash named resolves (`git cat-file -e <hash>` exits 0 for each); every proof node id collects (`.venv/bin/pytest --collect-only -q <ids>` lists each, and each JS proof names a test that exists in its file). A `.planning/` edit runs no repo gate.

## Notes

- **Owner rulings, 2026-11-11.** Plan 1 Notes, first bullet, holds them: the phase has ONE approved `### Security` bullet, quoted there verbatim, and Task 2 quotes the rulings as that bullet states.
- Copy items 12 and 13 and ruling Q3 are gathered with Plan 1's request (Plan 1 Notes). This plan runs last because its entries name the commits of Plans 1 to 4.
