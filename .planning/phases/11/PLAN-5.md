---
phase: 11
plan: 5
# Phase 11 maps no requirement ID (ROADMAP: "Requirements: None"); this plan fixes F-045 by rule text (CONTEXT AC5's credential clause).
requirements: []
files:
  - CLAUDE.md
  - .claude/skills/live-daemon/SKILL.md
---

# Phase 11: Agent tooling and repo guards - Plan 5: Only the stock management pair is exempt

## Goal

Findings F-043, F-044, F-045, F-046, F-047 and F-048 are each fixed or carry an owner decision. This plan fixes F-045: the agent rules exempt only the stock hqplayerd pair, by value, and treat every other management password as a secret.

## Must be true when done

- The `Credentials` rule in `CLAUDE.md` exempts only username `hqplayer` with password `password`, named by value, and says any other management password is a secret under the general rule (D-08, AC5).
- The `Secrets in the shell` section of `.claude/skills/live-daemon/SKILL.md` says the same. A non-stock `HQPTUNER_HQP_PASSWORD` gets the presence test only and is never printed (D-08, AC5).
- The owner approved both new wordings verbatim before they were written (D-13).
- The before and after wording of the two sites is the proof, with no new gate (D-15).

## Context

- Locked: D-08 (stock pair by value; this host's pair is non-stock), D-13 (owner approves every `CLAUDE.md` and `live-daemon` skill edit), D-15 (the wording diff is the proof; a gate on the rule text was rejected), D-16 (`.claude/briefs/compose-pins.md` stays as written).
- Both files are Markdown: written with `Edit`, soft-wrapped one logical line per paragraph or list item (`.claude/hooks/md-softwrap.py`), no em dashes.
- This host's management pair is a secret once this lands. Never print `hqpcreds`, `HQPTUNER_HQP_PASSWORD` or its value; test presence only.

## Tasks

### Task 1: All three credential rule sites exempt only `hqplayer`/`password`

- **Files:** CLAUDE.md, .claude/skills/live-daemon/SKILL.md
- **Reads:** CLAUDE.md#Repo rules, .claude/skills/live-daemon/SKILL.md#Secrets in the shell, ~/.claude/skills/opal-hqptuner/SKILL.md, README.md, hqptuner/config.py
- **Decisions:** D-08, D-13, D-15, D-16
- **Action:** Draft a replacement for the `Credentials` bullet in `CLAUDE.md` and one for the opening of the `Secrets in the shell` section in the skill. Keep each site's other content: placeholders only in commits, the presence-test guidance, and the note about the ambient shell. Draft a third replacement for the bullet in the host skill `~/.claude/skills/opal-hqptuner/SKILL.md` that opens "**These credentials are not secret**" and says not to flag or redact them; it is a same-cause instance (`~/dev/CLAUDE.md` rule 10.2) and agents load it before touching the daemon. That file is outside this repository: it is a host action, written only on the owner's approval, never committed here, and recorded as a Note in Plan 6. Then put all three drafts in front of the owner, verbatim, and write only the wording the owner approves (D-13). The new wording must name the exempt pair by value, username `hqplayer` and password `password`, as the stock pair hqplayerd's docs and `README.md` publish. It must say every other management password is a secret: placeholders in commits, the presence test in the shell, and nothing printed in commands, logs or reports. And it must drop both skills' claims that the `HQPTUNER_HQP_*` pair prints freely or must not be redacted. Do not edit `.claude/briefs/compose-pins.md` (D-16) or the `Dev` section's `hqpcreds` line.
- **Verify:** The owner's approval of each exact wording is quoted in the commit message body, and `git diff CLAUDE.md .claude/skills/live-daemon/SKILL.md` shows only those two passages changed. Before and after, both sites read with `grep -n "hqplayer" CLAUDE.md .claude/skills/live-daemon/SKILL.md`. The after lines name `hqplayer` and `password` and say other passwords are secret; keep both outputs for the F-045 entry in Plan 6 (D-15). `grep -n "not secret\|redact" ~/.claude/skills/opal-hqptuner/SKILL.md` shows the approved wording and no line telling agents not to redact the pair; keep before and after for Plan 6. `python3 .claude/hooks/md-softwrap.py --check CLAUDE.md .claude/skills/live-daemon/SKILL.md` passes. `scripts/gate.sh make check` exits 0. No test: the proof is the wording diff, by owner decision (D-15).

## Notes

- Plan shape: CONTEXT's example slices name no home for F-045. Its two files are touched by no other plan, so it is a plan of its own.
