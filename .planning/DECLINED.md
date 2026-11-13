# Declined: findings this repository said no to

Written by `issue-filing.mjs file` when a gate's finding is DECLINED, read by
`issue-filing.mjs unfixed` as the set it must never ask about again. Same row
grammar as FILED.md: the date, the provider, the repository slug, the finding's
(file, claim) fingerprint and its title.

NOT part of the recall corpus and not a queue. `planning.mjs recall` reads
CAPTURE.md, ARCHIVE.md, the task records and FILED.md by explicit path, and
this file is deliberately absent from that list - a decline is a closed
question, and putting closed questions in front of a planner is the
accumulation the corpus rules exist to prevent. Query it, do not load it.

A line that is not a row is skipped, so a human note added here changes nothing
the seam reads.

- 2026-11-07 github ohshitgorillas/hqptuner 6f85a49fb2065eae: [cadence 6f85a49fb2065eae] Task 2 says to keep `.planning/config.json`'s working-tree content as it is and commit it with full pre-commit. After the merge, the `prettier` hook (integrate `.pre-commit-
- 2026-11-07 github ohshitgorillas/hqptuner 4eb77839e1091b6b: [cadence 4eb77839e1091b6b] The plans only disclose the footprint of the four full `make check` runs (Plan 1 Tasks 1 and 3, Plan 2 Task 4, Plan 3 Task 3). Each runs `test-js` at node's default concurre
- 2026-11-07 github ohshitgorillas/hqptuner cbd6a7df0f651db3: [cadence cbd6a7df0f651db3] The merge puts 168 changed `hqptuner/` files and the rebuilt frontend onto `v2`. The repo rules require `/task-check`, a hand-back URL and the owner's eyes on every visual c
