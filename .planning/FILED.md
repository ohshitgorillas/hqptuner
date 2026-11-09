# Filed: issues this repository's gates opened

Written by `issue-filing.mjs file` when a gate's finding is ACCEPTED and filed
on the tracker, read by `planning.mjs recall` beside CAPTURE.md. One `- ` row
per filed issue: the date, the provider, the repository slug, the finding's
(file, claim) fingerprint and the issue's title. No finding body - a row is a
pointer to an issue, not a copy of it, and NOTHING here is a queue. A declined
finding is never written here; its record is a row in DECLINED.md beside this
file, which is deliberately outside the recall corpus. A line that is not a row
is skipped, so a note added here mints no recall entry.

A row carrying the word `unconfirmed` before its colon is a create this
repository could not confirm landed - the forge may hold that issue and may not.
It is kept so a later fire does not file the same finding twice; delete the row
once you have looked, and nothing else here is unverified.

- 2026-11-09 github ohshitgorillas/hqptuner 2c42853514aa2533: [cadence 2c42853514aa2533] The must-be-true 'a malformed upload answers a 4xx, never a 500' is not delivered: Task 2 widens the exception catch only around opening and listing the archive, while `pres
- 2026-11-09 github ohshitgorillas/hqptuner 4bcaab6e2e0a3796: [cadence 4bcaab6e2e0a3796] The bite claim for the malformed-archive case is false: before the change, every upload that `is_archive` accepts already goes through `take_descriptions`, which turns BadZi
- 2026-11-09 github ohshitgorillas/hqptuner ee5d485f8678b8b5: [cadence ee5d485f8678b8b5] Task 7's second bite case (`filter` = an unlisted ID while in PCM) cannot be red before the change. The value sits on the loaded chain, so `routing._resolve` already resolve
- 2026-11-09 github ohshitgorillas/hqptuner 58c46bca0965be85: [cadence 58c46bca0965be85] Escaping the level does not make the parked fixed-volume comment safe. XML forbids `--` inside a comment, entity escaping cannot encode `-`, and the plan adds no value check
- 2026-11-09 github ohshitgorillas/hqptuner 6a135204ce67e93c: [cadence 6a135204ce67e93c] All the changelog work is moved into a final separate commit, which contradicts the repo rule that every user-visible change lands with its `CHANGELOG.md` `[Unreleased]` ent
- 2026-11-09 github ohshitgorillas/hqptuner c8bf6da7d8e54386: [cadence c8bf6da7d8e54386] The F-018 disposition 'Fixed by bounds' leaves one clause of the finding with neither a fix nor an owner ruling: REPORT.md says `/api/state-export` reads all stores into mem
- 2026-11-09 github ohshitgorillas/hqptuner 5bb4ad231c186f2a: [cadence 5bb4ad231c186f2a] Putting the Windows `:` and device-name refusals into the shared `validate_name` also applies them to reads and deletes. Live snapshots are JSON keys, never paths, and `live
- 2026-11-09 github ohshitgorillas/hqptuner 660163e32ecade13: [cadence 660163e32ecade13] Task 1 needs a `ControlError` subclass for a value containing `"`, but no class in hqptuner/engine/controlerrors.py fits: each one names a connection, timeout, parse or daem
