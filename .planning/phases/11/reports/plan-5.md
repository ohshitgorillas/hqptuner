PLAN COMPLETE

Plan: /home/atom/dev/hqptuner/.planning/phases/11/PLAN-5.md

Tasks: 1 of 1

| Task | Commit | Note |
|---|---|---|
| 1 - All three credential rule sites exempt only hqplayer/password | 0a4a3ae9 | Drafts A (CLAUDE.md:46) and B (live-daemon SKILL.md:34 opening sentence) committed verbatim; owner approval "Approve all three" quoted in commit body. Draft C written to ~/.claude/skills/opal-hqptuner/SKILL.md:13 (host file outside the repo, EDITED, NOT committed). md-softwrap --check rc=0; `scripts/gate.sh make check` exit=0 before commit and again after (full suite). Pre-commit passed. No em dash added (CLAUDE.md's 3 existing ones untouched). |

Deviations: none

Open items: Plan 6 F-045 entry needs before/after wording (proof per D-15). Host-skill edit to record as a Note in Plan 6: ~/.claude/skills/opal-hqptuner/SKILL.md:13 was edited outside the repo and is not in any commit.

## Before/after proof (D-15)

Before, `grep -n "hqplayer" CLAUDE.md .claude/skills/live-daemon/SKILL.md` (credential lines):
- CLAUDE.md:46: "- **Credentials**: placeholders only in commits, with one explicit exception: hqplayerd management credentials are not secret (LAN-only daemon, stock pair published in its docs and this README) and may appear in commands, logs and reports unredacted. Everything else follows the general rule."
- .claude/skills/live-daemon/SKILL.md:34 opens: "`HQPTUNER_HQP_USERNAME` / `HQPTUNER_HQP_PASSWORD` are not secret (binding exception in `CLAUDE.md`) and print freely; they live in the unblocked `hqpcreds` file. Every other credential on the host: ..."

After:
- CLAUDE.md:46: "- **Credentials**: placeholders only in commits, with one explicit exception: the stock hqplayerd management pair, username `hqplayer` and password `password`, is not secret (LAN-only daemon, published in hqplayerd's docs and this README) and may appear in commands, logs and reports unredacted. Any other management password is a secret under the general rule: placeholders in commits, presence test only in the shell, never printed in commands, logs or reports. Everything else follows the general rule."
- .claude/skills/live-daemon/SKILL.md:34 opens: "Only the stock hqplayerd management pair, username `hqplayer` and password `password`, is not secret (binding exception in `CLAUDE.md`) and prints freely. Any other `HQPTUNER_HQP_PASSWORD` is a secret: presence test only, never printed. Both `HQPTUNER_HQP_*` variables live in the unblocked `hqpcreds` file. Every other credential on the host: ..."

Host skill, `grep -n "not secret\|redact" ~/.claude/skills/opal-hqptuner/SKILL.md`:
- Before, line 13: "- **These credentials are not secret** (user decision 2026-07-25): LAN-only daemon, no WAN exposure, stock pair published in hqplayerd's own docs. Reading, sourcing, or echoing them in shell commands, logs, and hand-back reports is expected and necessary — do not flag or redact them. The binding exception is in the repo `CLAUDE.md` under Project rules."
- After, line 13: "- **Only the stock pair is not secret**: username `hqplayer` and password `password`, LAN-only daemon, published in hqplayerd's own docs. Those two values may appear in shell commands, logs and hand-back reports unredacted. Any other management password, this host's included, is a secret: test presence only, never print or echo it. The binding rule is in the repo `CLAUDE.md` under Repo rules."
- No line remains telling agents not to redact the pair.
