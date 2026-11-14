---
phase: 10
plan: 5
depends_on: [1, 2, 3, 4]
# Phase 10 maps no requirement ID (ROADMAP: "Requirements: None"); this plan records the nine findings' dispositions (Success Criterion 1, CONTEXT AC5) and closes on the gate's red-then-green run (AC1, AC6).
requirements: []
files:
  - .planning/security/DISPOSITIONS.md
---

# Phase 10: Release pipeline supply chain - Plan 5: The dispositions

## Goal

Findings F-034, F-035, F-036, F-037, F-038, F-039, F-040, F-041 and F-042 are each fixed or carry an owner decision. This plan records that: one entry per finding in `.planning/security/DISPOSITIONS.md`, each fixed part naming its commit and a proof that fails against the pre-fix code.

## Must be true when done

- `.planning/security/DISPOSITIONS.md` holds one entry each for F-034 to F-042, after F-033 in finding order, in the existing shape (D-17, AC5).
- Every fixed part names its commits and a proof that fails against the pre-fix code: a `tests/gates/test_supply_chain.py` case, or the gate's own red run against the base-commit export, or a CI job (AC5).
- F-042's triviajudge clause is declined, quoting the owner's decision verbatim: "it's my app I update it when I fucking want" (D-06).
- Each GitHub-settings half names the owner's action in a Note: the five Apple secrets moving into `signing`, and `signing`'s branch rule for `dev` and `v*` tags (D-05).
- F-040's entry records AC4 as pending until the next `v*` release, per the owner's decision in CONTEXT AC4.
- The gate exits non-zero against the base-commit export and 0 on the phase's last commit (AC1). `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows` pass on the phase's last `dev` commit (AC6). `/cad-verify` reads that with `ci-status` after the owner pushes, and no task here pushes.

## Context

- Locked: D-05 (settings halves as Notes), D-06 (triviajudge declined), D-17 (record shape).
- The entry shape is the existing one: `### F-NNN · <title as REPORT.md gives it>`, then `- Disposition:`, `- Commits:` (each hash with a parenthetical saying what it did), `- Proof:` (test node ids or the named check), `- Owner decision:` quoting verbatim where a clause is declined, and `- Note:` for an owner action outside the tree.
- Markdown is written with `Write`/`Edit`, soft-wrapped (`.claude/hooks/md-softwrap.py`).

## Tasks

### Task 1: Each finding of the phase has its disposition

- **Files:** .planning/security/DISPOSITIONS.md
- **Reads:** .planning/security/DISPOSITIONS.md#F-033, .planning/security/REPORT.md#F-034, .planning/phases/10/CONTEXT.md#Acceptance criteria
- **Decisions:** D-05, D-06, D-17
- **Action:** Append nine entries after F-033, each titled exactly as `.planning/security/REPORT.md` titles the finding. Read the commits from `git log` and the proofs from `tests/gates/test_supply_chain.py` and the plans' CI jobs. Each Proof names at least one case or run that was red against the pre-fix code, never a characterization alone. Every clause of each finding's "What the code shows" is either named as fixed or quoted as decided. Dispositions:
  - F-034: Fixed. The unpinned installs: Plan 1 Task 2, Plan 2 Tasks 2 and 3. The build/sign split: Plan 3 Tasks 2 and 3. Note: the owner moves `MACOS_CERT_P12_BASE64`, `MACOS_CERT_PASSWORD`, `NOTARY_KEY_P8_BASE64`, `NOTARY_KEY_ID` and `NOTARY_ISSUER_ID` into the `signing` environment (D-05).
  - F-035: Fixed for the repo half: `environment: signing` and the check on both signing jobs (Plan 3 Tasks 3 and 4). Notes: the secret move above, and `signing`'s deployment branch rule admitting `dev` and `v*` tags only (D-04, D-05). If the owner accepted Plan 4 Task 2's third `signing` job for Linux packaging, the entry names it as scope beyond CONTEXT's two signing jobs, with the owner's decision quoted.
  - F-036: Fixed (Plan 3 Task 1). The `check` job's unpinned dev dependencies are fixed by Plan 2 Task 2.
  - F-037: Fixed (Plan 2 Tasks 2 to 5, including the image's lock install and digest base). The `irm | iex`: Plan 1 Task 2.
  - F-038: Fixed (Plan 3 Task 5). Note: the pinned hash came from the owner's download, and whether CI exercised the download branch is what the `package-windows` log showed.
  - F-039: Fixed (Plan 1 Task 1), with Dependabot (Plan 2 Task 6). Note: the Dependabot file takes effect once it reaches the default branch, if CONTEXT's flagged assumption holds.
  - F-040: Fixed in the tree (Plan 4 Tasks 1, 3 and 4). Proof: AC4's human-verify, pending until the next `v*` release by the owner's decision. Notes: the owner's key and secret creation (D-09).
  - F-041: Fixed (Plan 3 Task 6). Proof: the gate case and the `smoke` job's installed-tree check. `spa.py` was left unfiltered by D-15.
  - F-042: Fixed for filepawl (Plan 1 Task 3, held in the lock by Plan 2 Task 2). The triviajudge clause is declined. Quote D-06: "it's my app I update it when I fucking want". Record that triviajudge's install in `check.yml` pulls its own dependencies outside the lock, which is the reach of that decision.
  - Before writing, run the gate against the base-commit export and against HEAD, and quote both exit lines in F-039's or F-034's Proof as the phase's AC1 run. Each finding's Proof quotes the base-export failure lines of the rule that closes it, never the shared exit line alone.
- **Verify:** Testing scope: this is a record, so the checks are that what it names exists. `python3 .claude/hooks/md-softwrap.py --check .planning/security/DISPOSITIONS.md` exits 0. `grep -c '^### F-0' .planning/security/DISPOSITIONS.md` counts nine more than before the task. Every hash named resolves (`git cat-file -e <hash>` exits 0 for each). Every proof node id collects (`.venv/bin/pytest --collect-only -q <ids>` lists each). `scripts/gate.sh .venv/bin/python scripts/gates/check_supply_chain.py` prints `exit=0` at HEAD, and the same gate against `git archive <base>` extracted to scratch exits non-zero, the scratch then removed. A `.planning/` edit runs no repo gate.

## Notes

- F-040's Watchtower and `:latest` clause is covered by D-09 ("Full signing"): the entry notes that a Watchtower pull does not run `cosign verify`, and the README's verify step is for a manual pull.
- F-042's LLM-judge clause is covered by D-06: those hooks are triviajudge's, which the owner runs on purpose, and the entry quotes D-06.
- This plan runs last because its entries name the commits of Plans 1 to 4.
