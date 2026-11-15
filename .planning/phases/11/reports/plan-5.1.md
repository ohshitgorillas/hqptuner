PLAN CHECKPOINT: decision

Plan: /home/atom/dev/hqptuner/.planning/phases/11/PLAN-5.md

Tasks: 0 of 1

| Task | Commit | Note |
|---|---|---|
| 1 - All three credential rule sites exempt only hqplayer/password | none | Waiting on owner approval of the three wordings verbatim (D-13). Branch cadence/phase-11-plan-5 created at 215a92b6. No file edited. |

Deviations: none

Open items: none

## Drafts for owner approval (verbatim; nothing written yet)

Before (CLAUDE.md:46):
- **Credentials**: placeholders only in commits, with one explicit exception: hqplayerd management credentials are not secret (LAN-only daemon, stock pair published in its docs and this README) and may appear in commands, logs and reports unredacted. Everything else follows the general rule.

Draft A, replaces CLAUDE.md:46:
- **Credentials**: placeholders only in commits, with one explicit exception: the stock hqplayerd management pair, username `hqplayer` and password `password`, is not secret (LAN-only daemon, published in hqplayerd's docs and this README) and may appear in commands, logs and reports unredacted. Any other management password is a secret under the general rule: placeholders in commits, presence test only in the shell, never printed in commands, logs or reports. Everything else follows the general rule.

Before (.claude/skills/live-daemon/SKILL.md:34, opening sentence only; the rest of the paragraph stays): `HQPTUNER_HQP_USERNAME` / `HQPTUNER_HQP_PASSWORD` are not secret (binding exception in `CLAUDE.md`) and print freely; they live in the unblocked `hqpcreds` file. Every other credential on the host: presence test only, ...

Draft B, replaces that opening sentence (rest unchanged from "Every other credential on the host"): Only the stock hqplayerd management pair, username `hqplayer` and password `password`, is not secret (binding exception in `CLAUDE.md`) and prints freely. Any other `HQPTUNER_HQP_PASSWORD` is a secret: presence test only, never printed. Both `HQPTUNER_HQP_*` variables live in the unblocked `hqpcreds` file. Every other credential on the host: presence test only, ...

Before (~/.claude/skills/opal-hqptuner/SKILL.md:13, host file outside the repo, never committed here):
- **These credentials are not secret** (user decision 2026-07-25): LAN-only daemon, no WAN exposure, stock pair published in hqplayerd's own docs. Reading, sourcing, or echoing them in shell commands, logs, and hand-back reports is expected and necessary — do not flag or redact them. The binding exception is in the repo `CLAUDE.md` under Project rules.

Draft C, replaces that bullet:
- **Only the stock pair is not secret**: username `hqplayer` and password `password`, LAN-only daemon, published in hqplayerd's own docs. Those two values may appear in shell commands, logs and hand-back reports unredacted. Any other management password, this host's included, is a secret: test presence only, never print or echo it. The binding rule is in the repo `CLAUDE.md` under Repo rules.

Commit body must quote the owner's approval of each wording.
