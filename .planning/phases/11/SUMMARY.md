---
phase: 11
status: complete
completed: 2026-11-15
---

# Phase 11: Agent tooling and repo guards - Summary

The tracked agent settings allow exact commands only and self-enable no MCP server, under a new `check_agent_tooling.py` gate. eqstage refuses a non-loopback job URL and follows no redirect. The manual tools read only inside the manual directory. The probe backup directory is private and checked. Only the stock `hqplayer`/`password` pair is exempt from the secrets rule. F-043 to F-048 each have a disposition.

## What shipped

- Exact-command allow rules, no `pip install` or `npx prettier` allow, no `enabledMcpjsonServers`, no deny block (owner decision) - `.claude/settings.json`
- Agent-tooling gate, wired into `make lint` and pre-commit - `scripts/gates/check_agent_tooling.py`, `tests/gates/test_agent_tooling.py`
- Hook docstrings that promise only what the hooks do - the two tracked hooks under `.claude/hooks/`
- Loopback-only job URL and `redirect: "error"` on every request - `scripts/eqstage/eqstage.js`, `tests/js/eqstage/eqstage-url.test.js`, `tests/js/eqstage/eqstage-redirect.test.js`
- `hqp_section`, `hqp_page` and `manual_sections()` refuse or skip files outside the manual directory - `scripts/authority.py`, the hqpdoc server, `tests/test_hqpdoc_section.py`, `tests/test_authority_sections.py`
- Shared private, checked probe backup directory used by `restore_pristine` and the three write probes - `scripts/probes/backup_dir.py`, `tests/test_probe_backup_dir.py`
- Credential exemption narrowed to the stock pair - `CLAUDE.md:46`, `.claude/skills/live-daemon/SKILL.md:34`, and (host, uncommitted) `~/.claude/skills/opal-hqptuner/SKILL.md:13`
- Dispositions for F-043 to F-048 - `.planning/security/DISPOSITIONS.md`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | 65274f07 | Tracked settings allow exact commands only and enable no MCP server |
| 1 | 2 | 0c1e4145 | Gate holds the tracked agent settings to no package fetch and no MCP self-enable |
| 1 | 3 | 04f1d1d2 | Two tracked hooks' docstrings promise only what they do |
| 1 | fix | 0dc7f0ec | Allow rules use the Makefile `lint` line forms the owner approved |
| 2 | 1 | 989408ad | eqstage refuses a non-loopback job url before its first request |
| 2 | 2 | a6f50659 | Every eqstage request fails on a redirect instead of following it |
| 3 | 1 | 858c5359 | hqp_section refuses a section file outside the manual directory |
| 3 | 2 | 28b39655 | manual_sections and the manual scans leave out files outside the manual |
| 4 | 1 | 96ba7d4f | Probe backup directory is private and checked; restore_pristine refuses an unsafe one |
| 4 | 2 | 04c0211e | Three write probes use the shared backup directory check |
| 5 | 1 | 0a4a3ae9 | Only the stock hqplayerd pair is exempt from the secrets rule |
| 6 | 1-6 | 94aec642 | Findings F-043 to F-048 have their dispositions |

Plans 2, 3 and 4 ran in parallel worktrees and merged as 266ccfe7 and 330f4368 (plan 2 fast-forwarded).

## Deviations

- [deviation] Plan 1 required a `git commit --no-verify` deny rule and a gate check for it. The owner answered "no no verify deny, pip/prettier fine, whatever" and selected neither optional deny (`git push`, `SKIP=`). There is no deny block, and the gate has two checks, not three (65274f07, 0c1e4145).
- [deviation] Plan 1's first continuation rebuilt the allow list from the plan's rule instead of the approved proposal, writing `ruff check hqptuner`, `black hqptuner` and `vulture hqptuner`. Fix pass 0dc7f0ec wrote the approved Makefile `lint` forms.
- [deviation] Plan 6's F-046 entry cannot quote a `--no-verify` gate fault line, because that check does not exist under the owner decision above. The entry says so (94aec642).

## Open items

- `~/.claude/skills/opal-hqptuner/SKILL.md:13` was edited outside the repo (Draft C, owner-approved) and is in no commit.
- Host actions stay with the owner: prune `.claude/settings.local.json` and `~/.claude/settings.json` (including `Bash(SKIP=* git commit *)`), and enable hqpdoc in local settings, since the tracked file no longer does.
- A pytest or make call with arguments other than the exact allowed forms now prompts, for example a targeted `scripts/gate.sh .venv/bin/pytest tests/... -q`.
- Whether a deny rule holds under `bypassPermissions` is unverified (permissions docs are silent); moot while no deny rule exists.
- Worktree executors had no `.venv`, `node_modules` or eqlab content, and pre-commit's `env PYTHONPATH=scripts:...` drops the worktree, so the coverage floor read 0%. Each executor built untracked wrappers. Plan 3 did not run the JS half of `make check` in its worktree; the merged tree's `make check` ran green.
- Probe backup location is unchanged at `<PROBE_OUT or tempdir>/hqptuner-probe`, open to the owner. No probe was run.
- The CI half of the acceptance (check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos, smoke-windows) waits on a push.
- `phase_diff` review is off, so the interaction of the five plans merged from wave 1 went unreviewed.
- During plan 1, a `timeout`-wrapped commit killed pre-commit while the eight unstaged user `.planning/**` edits were stashed. The executor restored them with `git apply`. The coordinator confirmed the current diff of those eight files is identical to the stashed patch `/home/atom/.cache/pre-commit/patch1794744079-224933`, apart from `index` lines.

## Goal check

The commits plausibly deliver the goal. `.planning/security/DISPOSITIONS.md` holds six `### F-04[3-8]` entries (`grep -c` prints 6, 94aec642). F-043 is fixed by 65274f07, 0c1e4145 and 0dc7f0ec: `check_agent_tooling.py` exits 1 with three fault lines against the 330f4368 export and 0 on HEAD (plan-1 and plan-6 reports). F-044 is fixed by 989408ad and a6f50659: 10 tests, red before the fix (plan-2 report). F-045 is fixed by 0a4a3ae9: the after wording is grep-confirmed verbatim at all three sites. F-046 is the 04f1d1d2 docstrings plus the owner's decline of the deny rule, recorded with the owner's quote. F-047 is fixed by 858c5359 and 28b39655, red by assertion before the fix (plan-3 report). F-048 is fixed by 96ba7d4f and 04c0211e, red against the null stub and the pre-fix writers (plan-4 report). `risk-check run` found no matches on any plan's range. `scripts/gate.sh make check` exited 0 after the wave 1 merge and again at plan 6's closing run. Missing: the CI run, and any review of how the merged plans interact.

complete locally, not CI-verified
