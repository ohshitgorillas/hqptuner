PLAN CHECKPOINT: decision

Plan: /home/atom/dev/hqptuner/.planning/phases/11/PLAN-1.md

Tasks: 0 of 3

| Task | Commit | Note |
|---|---|---|
| 1 | none | Stopped before any write: D-13 needs owner approval of the exact .claude/settings.json content. Proposal in the checkpoint Need field. |

Deviations: none

Open items:

- Branch cadence/phase-11-plan-1 created from 215a92b6; no commits yet.
- Permissions doc findings for Plan 6 (F-043, F-046), source https://code.claude.com/docs/en/permissions.md (fetched 2026-11-15):
  - A `*` matches any text including spaces and may sit at start, middle or end. No `*` means exact command match. A trailing ` *` also matches the bare command, only when it is the rule's sole wildcard.
  - Order is deny, then ask, then allow; first match wins; an allow cannot carve an exception out of a deny.
  - Deny from any scope beats allow from any other: "if user settings allow a permission and project settings deny it, the deny rule blocks it" (section "Settings precedence"). So a project deny covers settings.local.json and ~/.claude/settings.json allows.
  - A deny rule matches past any leading env assignment (so `SKIP=1 git commit --no-verify` still matches a `git commit *--no-verify*` deny). Deny/ask rules "aren't a security boundary": `git -C . commit --no-verify`, `/usr/bin/git commit ...` and `sh -c '...'` are not matched.
  - A matching deny blocks in auto mode (the doc says ask rules still prompt in auto mode; deny precedence is stated as mode-independent). bypassPermissions skips prompts; the doc does not state whether a deny rule still holds there, so that case is unverified.
  - `npx` is not a stripped wrapper; `Bash(npx prettier *)` allows whatever follows.
