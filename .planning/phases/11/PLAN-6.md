---
phase: 11
plan: 6
depends_on: [1, 2, 3, 4, 5]
# Phase 11 maps no requirement ID (ROADMAP: "Requirements: None"); this plan records the six findings' dispositions (Success Criterion 1, CONTEXT AC5) and closes on the gate's red-then-green run (AC1, AC6).
requirements: []
files:
  - .planning/security/DISPOSITIONS.md
---

# Phase 11: Agent tooling and repo guards - Plan 6: The dispositions

## Goal

Findings F-043, F-044, F-045, F-046, F-047 and F-048 are each fixed or carry an owner decision. This plan records that: one entry per finding in `.planning/security/DISPOSITIONS.md`. Each fixed part names its commit and a proof that fails against the pre-fix code; each declined part quotes the owner.

## Must be true when done

- `.planning/security/DISPOSITIONS.md` holds one entry each for F-043 to F-048, after F-042 in finding order, in the existing shape (D-09, AC5).
- Every fixed part names its commits and a proof red against the pre-fix code: a named test, the gate's red run against the base export, or, for F-045, the before and after wording (D-15).
- Each declined part quotes the owner verbatim: the F-043 residual ("Yes, keep them all"), hooks in the tree ("Keep in tree, decline clause"), the F-044 agent clause ("Fix url only, leave agent"), and F-045's text-only proof ("Diff, owner accepts"). The F-046 fail-open is kept, quoting "Document fail-open" (AC5).
- Each host action is a Note: the owner prunes `.claude/settings.local.json` and `~/.claude/settings.json`, and enables hqpdoc in local settings (D-02, D-04).
- The gate exits non-zero against the base export and 0 on the phase's last commit (AC1). `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows` pass on the phase's last `dev` commit (AC6). `/cad-verify` reads them with `ci-status` after the owner pushes; no task here pushes.

## Context

- Locked: D-01, D-02, D-03, D-04, D-05, D-06, D-09 (one entry per finding, no `CHANGELOG.md` entry), D-11, D-15, D-19.
- Entry shape, as F-034 to F-042 use it: `### F-NNN · <title exactly as REPORT.md gives it>`, then `- Disposition:`, `- Commits:` (each hash with a parenthetical saying what it did), `- Proof:` (test node ids, or the named check with its quoted output), `- Owner decision:` quoting verbatim, and `- Note:` for an owner action outside the tree or a stated limit.
- Read commits from `git log` and proofs from Plans 1 to 5's commit messages, which record each red run. Each finding's "What the code shows" clauses are each either named as fixed or quoted as decided; none is left silent.
- Markdown is written with `Edit`, soft-wrapped (`.claude/hooks/md-softwrap.py`).

## Tasks

### Task 1: F-043 has its disposition

- **Files:** .planning/security/DISPOSITIONS.md
- **Reads:** .planning/security/DISPOSITIONS.md#F-042, .planning/security/REPORT.md#F-043, .planning/phases/11/CONTEXT.md#Durable decisions
- **Decisions:** D-01, D-02, D-03, D-04
- **Action:** Append the F-043 entry after F-042. Disposition: fixed in the tree (exact allow rules, `pip install` and `npx` rules dropped, deny rules added, no MCP self-enable), with the residual and the out-of-tree hooks clause declined. Commits: Plan 1 Tasks 1 and 2. Proof: the gate's tests in `tests/gates/test_agent_tooling.py` and the gate's quoted output against the base export (exit 1 and its fault lines), with its exit 0 on the phase's last commit. Owner decisions, one per declined clause: the residual (an exact `make check` still runs the branch's Makefile, and `git commit` the branch's pre-commit entries), quoting "Yes, keep them all" (D-01); and keeping the hooks in the tree, quoting "Keep in tree, decline clause" (D-03). Notes: the owner prunes `.claude/settings.local.json` and `~/.claude/settings.json` (D-02); the owner enables hqpdoc in local settings, since `manual-by-tool.py` denies `pdftotext` (D-04). The finding's own inference that a branch switch in a trusted folder does not prompt again is stated as unverified, unless Plan 1 Task 1's documentation reading settled it, in which case cite that page.
- **Verify:** `grep -n "^### F-043" .planning/security/DISPOSITIONS.md` finds one heading, after F-042's. The entry holds both quotes verbatim and both Notes, and its Proof quotes at least one gate fault line from the base-export run. `python3 .claude/hooks/md-softwrap.py --check .planning/security/DISPOSITIONS.md` passes.

### Task 2: F-044 has its disposition

- **Files:** .planning/security/DISPOSITIONS.md
- **Reads:** .planning/security/REPORT.md#F-044, .planning/phases/11/PLAN-2.md#Notes
- **Decisions:** D-06, D-07, D-14
- **Action:** Append the F-044 entry. Disposition: fixed for the `url` (loopback allowlist checked before the login POST) and for redirects (`redirect: 'error'` on every eqstage request). The stage-only confinement clause and the agent text are declined, quoting "Fix url only, leave agent" (D-06). Commits: Plan 2 Tasks 1 and 2. Proof: the test node names from `tests/js/eqstage/eqstage-url.test.js` and `tests/js/eqstage/eqstage-redirect.test.js`, each noted red against the pre-fix code. Note: the 307-to-`/api/config/apply` chain is closed by eqstage refusing every redirect. Whether Node's `fetch` drops a manual `Cookie` header across origins is stated as untested, unless Plan 2 showed it. `scripts/eqtools_mcp.py` still passes `url` through unchanged, and eqstage is where it is checked.
- **Verify:** `grep -n "^### F-044" .planning/security/DISPOSITIONS.md` finds one heading, after F-043's. The entry quotes "Fix url only, leave agent" verbatim and names at least one test from each of the two new test files. `python3 .claude/hooks/md-softwrap.py --check .planning/security/DISPOSITIONS.md` passes.

### Task 3: F-045 has its disposition

- **Files:** .planning/security/DISPOSITIONS.md
- **Reads:** .planning/security/REPORT.md#F-045, .planning/phases/11/CONTEXT.md#D-08
- **Decisions:** D-08, D-15, D-16
- **Action:** Append the F-045 entry. Disposition: fixed by rule text. Commits: Plan 5 Task 1. Proof: the before and after wording of `CLAUDE.md`'s `Credentials` rule and of the skill's `Secrets in the shell` section, quoted or cited by line from that commit's diff. Owner decision, for the text-only proof: "Diff, owner accepts" (D-15). Note: this host's pair is non-stock (a boolean compare of `hqpcreds`, nothing printed, 2026-11-14), and `git log --all -S<value>` over 4007 commits found no hit (D-08). Host-action Note: the third site, `~/.claude/skills/opal-hqptuner/SKILL.md`, was changed on the owner's approval outside this repository and has no commit here; quote its before and after lines from Plan 5's record. `.claude/briefs/compose-pins.md` stays as written, since it records username `atom` and `has_password: true` and never a password value (D-16). Never write any password value into this entry.
- **Verify:** `grep -n "^### F-045" .planning/security/DISPOSITIONS.md` finds one heading, after F-044's. The entry quotes "Diff, owner accepts" verbatim and names `hqplayer` and `password` as the only exempt pair, and carries the host-action Note for `~/.claude/skills/opal-hqptuner/SKILL.md`. `python3 .claude/hooks/md-softwrap.py --check .planning/security/DISPOSITIONS.md` passes.

### Task 4: F-046 has its disposition

- **Files:** .planning/security/DISPOSITIONS.md
- **Reads:** .planning/security/REPORT.md#F-046, .planning/phases/11/PLAN-1.md#Notes
- **Decisions:** D-05, D-11, D-12, D-02
- **Action:** Append the F-046 entry. Disposition: fixed for the docstring and for `--no-verify`, with the fail-open kept by owner decision. Commits: Plan 1 Task 3 (docstrings) and Plan 1 Tasks 1 and 2 (the deny rule and the gate that holds it). Proof: the gate's `--no-verify` fault line against the base export and its test, plus the docstring diff. The entry states that no hook behavior changed, so D-12 produced no hook test. Owner decision on fail-open: "Document fail-open" (D-05). Notes: enforcement stays in CI, which runs `make check IDLE_GATE=off` (D-11). The owner removes `Bash(SKIP=* git commit *)` from `~/.claude/settings.json` (D-02). The deny rule's reach (a mid-command flag, and whether it overrides local and global allows and `defaultMode: "auto"`) is stated as documented, citing the Claude Code page Plan 1 Task 1 read, or as unverified; never as tested. `git commit -n`, the short form of `--no-verify`, is named as covered or not covered by the rule as approved.
- **Verify:** `grep -n "^### F-046" .planning/security/DISPOSITIONS.md` finds one heading, after F-045's. The entry quotes "Document fail-open" verbatim and quotes the gate's `--no-verify` fault line. `python3 .claude/hooks/md-softwrap.py --check .planning/security/DISPOSITIONS.md` passes.

### Task 5: F-047 has its disposition

- **Files:** .planning/security/DISPOSITIONS.md
- **Reads:** .planning/security/REPORT.md#F-047, .planning/phases/11/PLAN-3.md#Context
- **Decisions:** D-17
- **Action:** Append the F-047 entry. Disposition: fixed. Commits: Plan 3 Tasks 1 and 2. Proof: the test node names from `tests/test_hqpdoc_section.py` and `tests/test_authority_sections.py`, each noted red by assertion against the pre-fix scripts. Note: the second site is `_ManualLocator.locate` in `hqpdoc_tools.py`, which opens names `manual_sections()` returns. This is how CONTEXT's flagged assumption resolved.
- **Verify:** `grep -n "^### F-047" .planning/security/DISPOSITIONS.md` finds one heading, after F-046's, naming at least one test from each test file. `python3 .claude/hooks/md-softwrap.py --check .planning/security/DISPOSITIONS.md` passes.

### Task 6: F-048 has its disposition, and the phase closes on the gate's red-then-green run

- **Files:** .planning/security/DISPOSITIONS.md
- **Reads:** .planning/security/REPORT.md#F-048, .planning/phases/11/PLAN-4.md#Notes
- **Decisions:** D-18, D-19
- **Action:** Append the F-048 entry. Disposition: fixed. Commits: Plan 4 Tasks 1 and 2. Proof: the test node names from `tests/test_probe_backup_dir.py`, each noted red by assertion against the pre-fix probes, or against a null stub for the new shared module (rule 8). Notes: no probe ran against the production hqplayerd, and the proof is offline against a temporary directory (D-19). The directory keeps the path `<PROBE_OUT or tempdir>/hqptuner-probe`, so a second local user who pre-creates it can now only make the probes refuse, and the operator then sets `PROBE_OUT`. Then rerun the gate against the base export and on this tree, and run `make check`, as the phase's closing check.
- **Verify:** `grep -c "^### F-04[3-8]" .planning/security/DISPOSITIONS.md` prints `6`. `.venv/bin/python scripts/gates/check_agent_tooling.py <base-export-dir>` exits 1 and the same command without the argument exits 0. `scripts/gate.sh make check` exits 0. `python3 .claude/hooks/md-softwrap.py --check .planning/security/DISPOSITIONS.md` passes. The CI half of AC6 is read by `/cad-verify` after the owner pushes; no task pushes.

## Notes

- Plan shape: the record needs every earlier plan's commits, so it comes last and `depends_on` names Plans 1 to 5.
