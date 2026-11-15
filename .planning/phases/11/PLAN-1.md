---
phase: 11
plan: 1
# Phase 11 maps no requirement ID (ROADMAP: "Requirements: None"); this plan fixes the settings half of F-043 and F-046 and proves it with the new agent-tooling gate (CONTEXT AC1).
requirements: []
files:
  - .claude/settings.json
  - scripts/gates/check_agent_tooling.py
  - tests/gates/test_agent_tooling.py
  - Makefile
  - .pre-commit-config.yaml
  - .claude/hooks/no-version-bumps.py
  - .claude/hooks/manual-by-tool.py
---

# Phase 11: Agent tooling and repo guards - Plan 1: Settings, the agent-tooling gate and the hook docstrings

## Goal

Findings F-043, F-044, F-045, F-046, F-047 and F-048 are each fixed or carry an owner decision. This plan covers the tracked agent settings and hooks: the allowlist is narrowed, deny rules exist, the MCP self-enable is gone, a gate keeps it that way, and the two tracked hooks say only what they do.

## Must be true when done

- `.claude/settings.json` has no allow rule that runs `pip install` or `npx`, has a `deny` rule covering `git commit --no-verify`, and has no `enabledMcpjsonServers` key; its allow rules name exact commands, and the owner approved the file's new content before it was written (D-01, D-04, D-11, D-13).
- A new offline gate, `scripts/gates/check_agent_tooling.py`, exits non-zero against an export of the phase's base commit, naming each of the three faults, and exits 0 on this tree; it runs in `make check` and in pre-commit (D-10, AC1).
- The `no-version-bumps.py` docstring promises only a literal-name match on the bump script, and both tracked hooks' docstrings say they let a call through on input they cannot parse, that they are guidance, and that enforcement is CI's `make check` (D-05, D-11).
- No hook changes behavior: both hooks' `--self-test` still pass and every changed line sits in a module docstring (D-05, D-12).
- `.claude/settings.local.json` and `~/.claude/settings.json` are untouched; pruning them is the owner's (D-02).

## Context

- Locked: D-01 (narrow to exact commands, drop `Bash(.venv/bin/pip install *)` and `Bash(npx prettier *)`, add `deny` rules; the residual is declined), D-03 (hooks stay in the tree, wired through `${CLAUDE_PROJECT_DIR}`), D-04 (remove `enabledMcpjsonServers`), D-05 (fail-open documented, not changed), D-10 (one new gate under `scripts/gates/`, tests under `tests/gates/`, not inside `check_supply_chain.py`), D-11 (docstring promises a literal-name match; a deny rule covers `--no-verify`; no new CI gate), D-13 (owner approves every `.claude/settings.json` edit).
- Pattern to follow: `scripts/gates/check_release_signatures.py` (optional checkout-root argument, one line per fault, exit 1 on any) and its tests in `tests/gates/test_release_signatures.py`; wiring is policed by `scripts/gates/check_gates_wired.py`.
- Out of scope: moving hooks out of the tree, failing the hooks closed, a CI gate tying version changes to release commits, `settings.local.json` and global settings, any `CHANGELOG.md` entry (D-09).

## Tasks

### Task 1: The tracked settings allow exact commands only, deny `--no-verify`, and enable no MCP server

- **Files:** .claude/settings.json
- **Reads:** .claude/settings.json#permissions, .mcp.json#hqpdoc, CLAUDE.md#Repo rules
- **Decisions:** D-01, D-02, D-04, D-11, D-13
- **Action:** Before writing anything, put the complete proposed `permissions` block and the removal of `enabledMcpjsonServers` in front of the owner, verbatim, and write only what the owner approves (D-13); an edit the owner has not approved is not written. The proposal must: drop `Bash(.venv/bin/pip install *)` and `Bash(npx prettier *)`; replace every wildcard allow rule with exact command lines, keeping a trailing `*` only on a rule whose command cannot run without arguments (the `git add`, `git restore` and `git commit` rules) and naming each such keep to the owner as a kept wildcard; add a `deny` list whose entries include a rule covering `git commit` carrying `--no-verify` anywhere in its arguments, plus any further deny rule the owner approves from candidates this repo's rules already forbid (`SKIP=` before a commit, `git push`); and remove the top-level `"enabledMcpjsonServers": ["hqpdoc"]` line. Leave the `hooks` block and `enabledPlugins` exactly as they are (D-03). Do not touch `.claude/settings.local.json` or `~/.claude/settings.json` (D-02). Check the Claude Code permissions documentation for how a `*` in the middle of a `Bash(...)` rule matches and whether a project `deny` rule overrides allows from local and global settings and `defaultMode`, and keep what it says, with its URL, for Plan 6's F-043 and F-046 entries; never run a `--no-verify` command to find out.
- **Verify:** The owner's approval of the exact content is quoted in the task's commit message body. `python3 -c "import json,sys; d=json.load(open('.claude/settings.json')); print('enabledMcpjsonServers' in d, [r for r in d['permissions']['allow'] if 'pip install' in r or 'npx' in r], d['permissions'].get('deny'))"` prints `False`, `[]` and a non-empty deny list holding the `--no-verify` rule. `python3 -c "import json; print([r for r in json.load(open('.claude/settings.json'))['permissions']['allow'] if '*' in r])"` lists only rules on the owner's approved kept list (`git add`, `git restore`, `git commit`), each matched against the approval quoted in the commit message. `git diff .claude/settings.json` shows no line of the `hooks` block or `enabledPlugins` changed. The gate in Task 2 is this task's automated proof; this task adds no test.

### Task 2: An offline gate holds the settings, runs in `make check` and pre-commit, and is red on the base tree

- **Files:** scripts/gates/check_agent_tooling.py, tests/gates/test_agent_tooling.py, Makefile, .pre-commit-config.yaml
- **Reads:** scripts/gates/check_release_signatures.py#main, tests/gates/test_release_signatures.py, scripts/gates/check_gates_wired.py#check, Makefile#lint, .pre-commit-config.yaml#release-signatures
- **Decisions:** D-10, D-11, D-01, D-04
- **Pins:** tests/gates/test_gates_wired.py
- **Action:** Write the tests first, then the gate. The gate reads `.claude/settings.json` under a checkout root (this repo by default, or a root given on the command line, the way `check_release_signatures.py` takes one) and prints one line per fault and exits 1 on any: an allow rule that runs `pip install` or `npx`; no `deny` rule whose pattern, with `*` read as any text, covers `git commit` with `--no-verify` among its arguments (both before and after other arguments such as `-m`); a top-level `enabledMcpjsonServers` key. It exits 0 with an `[ok]` line otherwise. These three checks are the whole gate: it checks nothing else in the file (decision fidelity; extra checks are raised in the return, not added). Put the gate in the Makefile `lint` target beside the other `scripts/gates/` lines and add a pre-commit entry in the same shape as `release-signatures` (`language: system`, `pass_filenames: false`, `files:` matching `.claude/settings.json`), with a short comment saying what it reads, so `check_gates_wired.py` passes with `PRECOMMIT_EXEMPT` still empty. Do not fold any of this into `check_supply_chain.py` (D-10). Do not add a noqa, a per-file ignore or any other exemption; if one seems needed, stop and ask the owner.
- **Verify:** Testing scope: the outcomes are one fault line per broken setting and the exit status on a checkout. Nothing covers them today. The smallest set is one case per fault kind, one for the deny rule matching `--no-verify` placed after `-m` as well as before it, one for a clean file, and one for the checkout-level exit status; stop there. The gate is a new surface, so bite is shown the docs/testing.md rule 8 way: each test fails by assertion against a null stub of the gate (module present, every function returning its zero value), recorded in the commit message. `scripts/gate.sh .venv/bin/pytest tests/gates/test_agent_tooling.py -q` passes. Exported into a fresh empty directory under `${CLAUDE_SCRATCH:-/tmp}` with `git archive <base> | tar -x -C <dir>`, where `<base>` is the `dev` commit before this phase's first commit, `.venv/bin/python scripts/gates/check_agent_tooling.py <dir>` exits 1 and prints a line for the `pip install` rule, the `npx` rule, the missing deny rule and the `enabledMcpjsonServers` key; keep that output for Plan 6. On this tree it exits 0. `.venv/bin/python scripts/gates/check_gates_wired.py` prints `[ok]`. `scripts/gate.sh make check` exits 0.

### Task 3: The two tracked hooks' docstrings promise only what they do

- **Files:** .claude/hooks/no-version-bumps.py, .claude/hooks/manual-by-tool.py
- **Reads:** .claude/hooks/no-version-bumps.py#main, .claude/hooks/manual-by-tool.py#main, .github/workflows/check.yml
- **Decisions:** D-05, D-11, D-12, D-03
- **Action:** Edit module docstrings, plus the `#:` comment above `BASH_BUMP` in `no-version-bumps.py`, which repeats the "however the command reaches it" promise and gets the same literal-name wording. These are the owner's decision (D-05, D-11), so `~/dev/CLAUDE.md` rule 2.3 is met. In `no-version-bumps.py`, replace the promise that it catches the bump script "however it is spelled or reached" with what `BASH_BUMP` does: it matches the script's literal name in the command text, so a name built by glob, variable or another route passes, and a shell edit of a version file is not caught; and replace the claim that this hook is the binding control, as against advisory notes, with a statement that it is guidance and that enforcement is CI's `make check`. In both hooks, say that input the hook cannot parse as JSON lets the call through. In `manual-by-tool.py` also say what its `main` really does with a command naming the manual that `shlex` cannot tokenize: it exits 2, which refuses the call, so the docstring must not claim every parse failure passes. Change no code line, no constant and no `--self-test` case: D-05 and D-11 keep both hooks' behavior, so D-12 asks for no test here. Do not run any command that names the bump script; the hook refuses it.
- **Verify:** `python3 .claude/hooks/no-version-bumps.py --self-test` prints `PASS` and `python3 .claude/hooks/manual-by-tool.py --self-test` prints `manual-by-tool self-test: ok`. `git diff -U0 .claude/hooks/` shows every changed line inside the two module docstrings or on the `#:` comment line above `BASH_BUMP`, and no code line changed. No test is added: neither hook's behavior changes, and the F-046 deny rule's proof is Task 2's gate.

## Notes

- Plan shape: CONTEXT asks for "settings, hooks and the gate" as one slice; this is it.
- Task 1 is the only task that cannot finish without the owner: no settings content is written until the owner approves it verbatim.
- The `deny` rule's real effect on a mid-command `--no-verify`, and whether it overrides local and global allows and `defaultMode: "auto"`, is a flagged assumption in CONTEXT. Task 1 records what the Claude Code docs say; Plan 6 states it in the F-046 entry as documented or as unverified, never as tested.
