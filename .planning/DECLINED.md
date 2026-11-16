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

- 2026-11-09 github ohshitgorillas/hqptuner fc6d2e4641bcd79a: [cadence fc6d2e4641bcd79a] `Mgr` now resolves through `_held_manager`, which holds the 8088 client until the dependency exits. Under FastAPI 0.141.1 a request-scoped yield dependency exits only after
- 2026-11-09 github ohshitgorillas/hqptuner d2fdf9b79815c5e0: [cadence d2fdf9b79815c5e0] The MAX_REPLIES / MAX_BYTES cap counts raw datagrams before they are parsed. Datagrams that are not replies use up the cap and end the sweep early, so a real daemon whose re
- 2026-11-12 github ohshitgorillas/hqptuner 22ec9c24d254283e: [cadence 22ec9c24d254283e] The stage ceilings check only the length of each value and the number of top-level keys. Key names, live-argument names and the number of arguments inside a live bucket have
- 2026-11-12 github ohshitgorillas/hqptuner e0ede5870dd9bb5a: [cadence e0ede5870dd9bb5a] stage is a sync `def`, so FastAPI runs it on the threadpool. The key-ceiling check and the later store.stage merge are separate steps with no lock, so concurrent requests ca
- 2026-11-12 github ohshitgorillas/hqptuner 9211fa6272116ca6: [cadence 9211fa6272116ca6] _is_device_name compares the part before the first period without stripping trailing spaces, so the Windows build accepts a device name followed by spaces and an extension,
- 2026-11-12 github ohshitgorillas/hqptuner 7d5df863bddc1416: [cadence 7d5df863bddc1416] import_missing guards only _stored_name with its try/except. The new containment refusal is raised from self.exists(valid) and self.save(...) inside the loop, so a single pr
- 2026-11-14 github ohshitgorillas/hqptuner 252224fe2e8ee965: [cadence 252224fe2e8ee965] The new PresetStore lock covers only the file write. Auto-save decides which preset to write by reading `store.active` (line 290) outside the lock and before an `await mgr.r
- 2026-11-14 github ohshitgorillas/hqptuner bc3e600612af2ef2: [cadence bc3e600612af2ef2] main() only globs `*.yml`, but GitHub Actions also runs `.yaml` workflows. The pre-commit hook for this gate (`.pre-commit-config.yaml` line 300, `files: ^\.github/workflows
- 2026-11-14 github ohshitgorillas/hqptuner 91ecf7590ecf99b3: [cadence 91ecf7590ecf99b3] PIPED_INSTALL lets a sudo prefix through only when it is followed by `NAME=value` words. The common `sudo -E bash` form and the command-substitution forms of fetch-and-run a
- 2026-11-14 github ohshitgorillas/hqptuner 01ed019f70880448: [cadence 01ed019f70880448] permission_failures only recognizes the literal block spelling `packages: write`, so the gate misses workflow-level or job-level grants that also give packages: write, like
