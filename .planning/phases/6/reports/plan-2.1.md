PLAN CHECKPOINT: decision
Plan: .planning/phases/6/PLAN-2.md
Tasks: 0 of 5
| Task | Commit | Note |
|---|---|---|
| 1 - struck by owner ruling (F-021) | none | Struck, not skipped. Discovery behavior and its test stay. |
| 2 - refused save shows backend's sentence | none | Not started. Task 2 lands the CHANGELOG `[Unreleased]` `### Security` entry in the same commit; owner-approved wording not in hand. Plan: "If that approval is not in hand, stop and ask." |
| 3 - blank-password placeholder | none | Not started. Current text is "Leave blank to keep the stored password" (`hqptuner/static/components/Setup.js:208`); owner approval of shipping wording not in hand. |
| 4 - stored-password-unencrypted note | none | Not started. Owner-approved note wording not in hand. |
| 5 - IPv6 bracket in daemon link | none | Not started (no copy dependency; held behind Tasks 2-4 to keep plan order, CLAUDE.md 10.1). |
Deviations: none
Open items: none
Need: owner-approved verbatim wording for (a) the CHANGELOG `### Security` entry (Task 2), (b) the blank-password placeholder, or confirmation the current text stands (Task 3), (c) the stored-password-unencrypted note (Task 4). Windows meaning of "owner-only" (Plan 5 Task 3) bears on (c): note must not claim file protection Windows does not give. Checked: PLAN-2, CONTEXT D-17, plan-1 report, CHANGELOG.md, Setup.js; no approved wording found.
