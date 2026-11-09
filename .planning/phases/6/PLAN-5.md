---
phase: 6
plan: 5
# Phase 6 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against findings F-004, F-005, F-015, F-017, F-020, F-021, F-022 and F-023, the Success Criteria and CONTEXT AC1-AC7.
requirements: []
files:
  - hqptuner/engine/discovery.py
  - hqptuner/core/connection.py
  - tests/engine/test_discovery.py
  - tests/api/login/test_connection_file_mode.py
  - .planning/security/DISPOSITIONS.md
  - .filepawl.toml
---

# Phase 6: Connection host and stored credential - Plan 5: Discovery parses safely and bounds its sweep, connection.json is owner-only, and every finding is recorded

## Goal

Findings F-004, F-005, F-015, F-017, F-020, F-021, F-022 and F-023 are each fixed or carry an owner ruling. This plan closes F-020 and F-023 and records the phase: discovery replies are parsed with `defusedxml` and capped, `connection.json` is created owner-only, and `.planning/security/DISPOSITIONS.md` carries all eight findings with their commits and proof tests.

## Must be true when done

- A discovery reply carrying an XML entity declaration is rejected as not a reply, and no hostile datagram turns `/api/discover` into a 500 (AC6).
- One sweep keeps and dials at most the reply cap however many senders answer, and the sweep yields to the event loop on every pass (AC6).
- `connection.json` is created with mode 0600, also when a leftover temp file with a wider mode is in the way (D-16).
- `.planning/security/DISPOSITIONS.md` lists all 8 findings, each naming its fixing commit and a proof test that fails against the pre-fix code; F-004 and F-005 also carry the residual the owner accepted in D-01 (AC7, record half).
- `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows` pass on the phase's last `dev` commit (AC7, CI half; human-verify at the phase CI checkpoint in Notes, not a task).

## Context

- Locked: D-15, D-16, D-19 (the phase 4 shape: disposition, commits, proof).
- `parse_reply`, `_collect`, `discover` and `enrich` are in `hqptuner/engine/discovery.py`; `hqptuner/engine/frames.py` already imports `defusedxml.ElementTree.fromstring` and `DefusedXmlException`. `LoginSecret.persist` in `hqptuner/core/login.py` is the `os.open(..., 0o600)` pattern D-16 names.
- Probed for this plan (defusedxml 0.7.1, `.venv`, run with `-I`): an entity declaration raises `EntitiesForbidden` (a `ValueError`, not `ParseError`), and an unknown `encoding=` raises `LookupError` from both the standard library and `defusedxml`. `parse_reply` catches only `ParseError`, and `discover` catches only `NotAReplyError`, so either datagram escapes the sweep today.
- Builds on Plans 1 to 4, whose commits and proof tests the record names.

## Tasks

### Task 1: A discovery reply is parsed with defusedxml, and any refused datagram is not a reply

- **Files:** hqptuner/engine/discovery.py, tests/engine/test_discovery.py
- **Action:** `parse_reply` parses with `defusedxml.ElementTree.fromstring` and drops `# noqa: S314` (D-15). Every refusal the parser raises for a datagram becomes a `NotAReplyError`: `ParseError` as today, `DefusedXmlException` for an entity or DTD declaration, and `LookupError` for an unknown encoding. The last is the same cause as the entity case, a hostile datagram escaping `discover`'s `except NotAReplyError`, so it is fixed in the same pass (`~/dev/CLAUDE.md` 10.2) and named in the commit message. `NotXmlError`'s constructor takes the error it wraps; widen its accepted type rather than adding a sibling class.
- **Verify:** Testing scope, pure-function lane (strong area `hqptuner/engine/`; risk surface untrusted_input): a datagram with an internal entity declaration raises `NotAReplyError`; one declaring `encoding="x-bogus"` raises `NotAReplyError` (two cases); the existing reply and non-reply cases stay green. Bite: both red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`, ruff's S314 included.

### Task 2: One sweep keeps and dials at most a capped number of replies, and yields every pass

- **Files:** hqptuner/engine/discovery.py, tests/engine/test_discovery.py
- **Action:** `_collect` stops keeping replies once it holds the reply cap, and also stops once the bytes kept reach a byte cap; it awaits the injected `sleep` on every pass, a zero-length one when the socket had a datagram, so a steady stream cannot hold the event loop until the deadline (D-15, F-020). Because `enrich` dials each kept, deduped address once, the cap bounds the sequential 4321 dials too. Choose both caps with the case they serve in mind (one daemon per machine, a handful per LAN) and record the values and basis beside them and in the commit message. The deadline test after every pass stays as `_collect`'s docstring describes it.
- **Verify:** Testing scope, function lane with a datagram factory that answers every receive with a valid reply from a fresh sender, on `VirtualClock` (risk surfaces untrusted_input and concurrency): a sweep returns at most the reply cap of daemons; the opener counts at most the cap of 4321 dials; the injected `sleep` is awaited at least once per datagram read, counted by the fake. Bite: all three red against the commit before this one. `test_a_search_whose_found_hqplayer_falls_silent_ends_on_the_handed_deadline_without_real_time` stays green unchanged. `scripts/gate.sh make check` prints `exit=0`.

### Task 3: connection.json is created owner-only

- **Files:** hqptuner/core/connection.py, tests/api/login/test_connection_file_mode.py
- **Action:** `ConnectionStore.write` creates its temp file through `os.open` with mode 0600, as `LoginSecret.persist` does, and replaces the record with it as today (D-16). A leftover temp file from an earlier crash, whatever its mode, does not pass its mode to the result: remove it first or open exclusively after removing it, executor's choice. On Windows `os.open`'s mode sets only the read-only bit, so the protection there is the per-user data directory's ACL; the code comment says so, and the claim goes no further.
- **Verify:** Testing scope, store lane on POSIX (risk surface secrets): under a process umask the test sets and restores (`os.umask`, so the result does not depend on the runner's umask, `docs/testing.md` rule 16), a written record's mode is 0600; with a leftover temp file of mode 0644 in place, the written record's mode is still 0600 (two cases). Bite: both red against the commit before this one under a 022 umask. `scripts/gate.sh make check` prints `exit=0`.

### Task 4: Record every disposition

- **Files:** .planning/security/DISPOSITIONS.md
- **Action:** Add one entry per finding, F-004, F-005, F-015, F-017, F-020, F-021, F-022 and F-023, each headed exactly as `.planning/security/REPORT.md` heads it, in the phase 4 shape (D-19): `Disposition`, `Commits` (short hashes, each with what it fixed, every hash checked with `git cat-file -e`), and `Proof` (test node ids that are red against the pre-fix code, from each task's bite run). A finding declined or deferred carries the owner's ruling verbatim instead. F-023's entry states that mode 0600 protects the file on POSIX and that on Windows the protection is the per-user directory's ACL (Task 3), not more. F-004's and F-005's entries each carry the residual the owner accepted in CONTEXT D-01, quoted verbatim: "a caller who can reach the app before login can still retarget it to a server they control, so the owner re-enters the real host and pair, and can still learn through the login whether another host answers; no stored credential leaves either way." Written with `Edit`, soft-wrapped (`.claude/hooks/md-softwrap.py --check`).
- **Verify:** Testing scope: a record, no test. The file has eight new headings matching `REPORT.md`'s; every named commit resolves with `git cat-file -e`; every Python proof node id is collected by `.venv/bin/pytest --collect-only -q <node>`, and every JS proof (F-021's) names a test file and test title that `npm test` runs; the F-004 and F-005 entries each quote D-01's accepted residual; `scripts/gate.sh make check` prints `exit=0`.

## Notes

- **Phase CI checkpoint (human-verify, after Task 4, not an executor task).** Required jobs `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows`. The owner pushes `dev`; the executor never pushes (`~/dev/CLAUDE.md` 11.2). The owner then reads the run on the phase's last `dev` commit, and each job passes. This also checks Plan 3 Task 3's `Dockerfile` marker through `smoke`. A failure is reported with its failing line, and no disposition is called done on it (`~/dev/CLAUDE.md` 6.3). `/cad-verify` reads this with AC7.
- No copy in this plan: `DISPOSITIONS.md` is a planning record. The stored-unencrypted note that F-023's remediation asks for lands in Plan 2 Task 4.
- Shared with Plans 1, 3 and 4, which run before this one: `hqptuner/engine/discovery.py`, `hqptuner/core/connection.py`, `.filepawl.toml`.
