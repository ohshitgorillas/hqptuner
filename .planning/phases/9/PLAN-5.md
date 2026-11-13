---
phase: 9
plan: 5
depends_on: [1, 2, 3, 4]
# Phase 9 maps no requirement ID (ROADMAP: "Requirements: None"); this plan records the three findings' dispositions (Success Criterion 1, CONTEXT AC5) and checks the changelog entry.
requirements: []
files:
  - .planning/security/DISPOSITIONS.md
---

# Phase 9: Apply and store integrity - Plan 5: The changelog entry and the dispositions

## Goal

Findings F-029, F-030 and F-031 are each fixed or carry an owner ruling. This plan records that: one disposition per finding in `.planning/security/DISPOSITIONS.md`, with a check that the approved `### Security` bullet is the one in `CHANGELOG.md`.

## Must be true when done

- `CHANGELOG.md` `[Unreleased]` `### Security` carries the four owner-approved bullets for this phase verbatim, each added in the commit of the task Plan 1 Notes names for it, and `scripts/gates/check_changelog.py` passes (D-13).
- `.planning/security/DISPOSITIONS.md` holds one entry each for F-029, F-030 and F-031, between F-028 and F-032 in finding order, in the existing shape; every fixed part names its commits and a proof that fails against the pre-fix code, and the per-client buffer and rollback declines quote the owner's ruling (AC5, D-03, D-04, D-13).
- `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows` pass on the phase's last `dev` commit (AC6). `/cad-verify` reads that with `ci-status` after the owner pushes; no task here pushes.

## Context

- Locked: D-03 (F-029's shared-buffer clause declined, owner ruling "Keep shared, decline clause"), D-04 (F-030's rollback declined, owner ruling "No rollback, decline"), D-13 (the record's shape).
- The entry shape is the existing one: `### F-NNN · <title as REPORT.md gives it>`, then `- Disposition:`, `- Commits:` (each hash with a parenthetical saying what it did), `- Proof:` (test node ids), and `- Owner ruling:` quoting verbatim, then `- Reason:` where the existing entries carry one.
- Markdown is written with `Write`/`Edit`, soft-wrapped (`.claude/hooks/md-softwrap.py`).

## Tasks

### Task 1: Each finding of the phase has its disposition

- **Files:** .planning/security/DISPOSITIONS.md
- **Reads:** .planning/security/DISPOSITIONS.md, .planning/security/REPORT.md
- **Decisions:** D-03, D-04, D-11, D-13
- **Action:** Insert three entries between F-028 and F-032, each titled exactly as `.planning/security/REPORT.md` titles the finding. Read the commits from `git log` and the proofs from the test files Plans 1 to 4 landed. Each Proof names at least one test that went red in its task's bite run (for the new helper module, the case its null stub fails), never a characterization case alone. Every clause of each finding's text in REPORT.md is either named as fixed or quoted as ruled; none is left out. Dispositions:
  - F-029: Fixed for the serialization and the blind clears (Plan 1 Tasks 1 to 4), with the shared buffer's "one client's field applies under another's press" clause declined; quote D-03: "Keep shared, decline clause".
  - F-030: Fixed for the single slot, the per-pass overwrite and the unvalidated write (Plan 2 Tasks 1 to 3), with rollback declined; quote D-04: "No rollback, decline".
  - F-031: Fixed for the in-place writes and the interleaved writers (Plan 3 Tasks 1 to 4, Plan 4 Tasks 1 to 3), with the "the API can't repair the store and it takes a disk edit" clause kept as it stands by D-11 (no API path overwrites a corrupt store). quote the owner ruling in Plan 1 Notes (3): "already answered these".
- **Verify:** `.venv/bin/python .claude/hooks/md-softwrap.py --check .planning/security/DISPOSITIONS.md` exits 0; `grep -c '^### F-0' .planning/security/DISPOSITIONS.md` counts three more than before the task; every hash named resolves (`git cat-file -e <hash>` exits 0 for each); every proof node id collects (`.venv/bin/pytest --collect-only -q <ids>` lists each). The changelog check: `scripts/gate.sh .venv/bin/python scripts/gates/check_changelog.py` prints `exit=0`, each of the four owner-approved `### Security` bullets (Plan 1 Notes) is in `CHANGELOG.md` `[Unreleased]` character for character, and `git log -p` shows each added in the commit of the task Plan 1 Notes names for it; a missing or differing bullet goes to the owner as a blocking question, and this plan never drafts or edits a bullet. A `.planning/` edit runs no repo gate.

## Notes

- This plan runs last because its entries name the commits of Plans 1 to 4.
