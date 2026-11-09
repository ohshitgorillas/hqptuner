---
phase: 6
status: complete
completed: 2026-11-09
---

# Phase 6: Connection host and stored credential - Summary

One host validator gates the Connection save, the login and every 8088 URL; a bad saved host no longer stops the start and the container alias is probed only in the image; every 8088 read and Control API document carries a ceiling and a total deadline; discovery parses with defusedxml under a reply cap; connection.json is created 0600; and all eight phase findings are recorded in `.planning/security/DISPOSITIONS.md`.

## What shipped

- Host validator `check_host` / `url_host` - `hqptuner/conf/httpauth.py`; save and login refuse an invalid host (`host_invalid`, 422) and a host change needs both credentials (`credentials_required`, 422)
- connection.json never receives a pinned value or an uncarried password - `hqptuner/core/connection.py` (`stored_form`, `held_record`)
- Connection panel shows the backend's refusal sentence, the plain-text password note and a bracketed IPv6 daemon link - frontend Connection panel
- A refused or corrupt saved host reads as a corrupt record and counts as a chosen host; the image marker gates the alias probe at start and in the discovery fallback
- 8088 client total deadline, per-path reply ceilings, ceilings on the log, release and login pair readers, a replaced client closed once nothing holds it (`ConnectionManager.holding_http`), and a Control API document total deadline with a per-chunk scan
- Discovery: `defusedxml` parse, any parser refusal (entity, unknown or unreadable encoding) is not a reply, sweep capped at 32 replies / 64 KiB and yields every pass - `hqptuner/engine/discovery.py`
- `ConnectionStore.write` creates the record owner-only (0600 on POSIX)
- Dispositions for F-004, F-005, F-015, F-017, F-020, F-021, F-022, F-023 - `.planning/security/DISPOSITIONS.md`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | e3f609bf | one validator decides whether a string is a daemon host |
| 1 | 2 | 1282d44f | Connection save and login refuse an invalid host |
| 1 | 3 | a9c84d22 | every 8088 URL brackets an IPv6 host |
| 1 | 4 | e2433432 | changing the host needs both the username and the password |
| 1 | 5 | e9bc93e8 | a Connection save follows the login's pin rule |
| 1 | 6 | 48bb275c | connection.json never receives a pinned value or an uncarried password |
| 2 | 1 | none | struck by owner ruling (F-021) |
| 2 | 2 | de918df3 | a refused save or login shows the backend's sentence |
| 2 | 3 | none | owner ruling: existing placeholder stands, no change |
| 2 | 4 | 0bbc6dc4 | the panel says the stored password is plain text |
| 2 | 5 | 1382ae4d | the daemon link brackets an IPv6 host |
| 3 | 1 | 8f108525 | a saved host the validator refuses is read as a corrupt record |
| 3 | 2 | 31a88dcc | a corrupt or invalid record counts as a chosen host |
| 3 | 3 | ffad0a0b | the image carries a marker, and only a marked start probes the alias |
| 3 | 4 | f10726bc | the discovery fallback asks the alias only in the image |
| 3 | 5-6 | none | struck by owner ruling (D-04 offer half) |
| 3 | 7 | d4a7bd2e, ca7d073b | alias comment; README rows and changelog line |
| 4 | 1 | 52689703 | an 8088 exchange ends at a total deadline on the app's clock |
| 4 | 2 | 0f6745f2 | an 8088 reply is read up to a ceiling set for its path |
| 4 | 3 | f3a4d5f3 | the log and release readers carry a ceiling and the total deadline |
| 4 | 4 | 8e352b34 | the login's pair check carries a ceiling and the total deadline |
| 4 | 5 | e2ae85d3 | a replaced 8088 client is closed once nothing holds it |
| 4 | 6 | 87e616ce | a Control API document has a total deadline |
| 4 | 7 | 5b73a1e3 | the Control API scan does work per chunk, not per buffer |
| 5 | 1 | 1342e893 | a discovery reply is parsed with defusedxml |
| 5 | 2 | eb260c54 | one sweep keeps and dials at most a capped number of replies, and yields every pass |
| 5 | 3 | 23dcb192 | connection.json is created owner-only |
| 5 | 4 | 7d019ced | record the disposition of the eight findings |
| 5 | risk fix | a87efb10 | a datagram declaring an encoding the parser refuses is not a reply (risk_surface high finding) |
| 5 | record | f13aabf0 | F-020's disposition names the encoding fix |

## Deviations

- [deviation] Plan 1 Task 1: `hqptuner/conf/` was at the filepawl directory cap, so the validator went into `hqptuner/conf/httpauth.py` instead of a new `hostaddr.py`; no exemption (e3f609bf).
- [deviation] Plan 2 Task 5: the bracketed-pageHost case was green before the change; kept as a guard, and a bare-IPv6 pageHost case that is red before was added (1382ae4d).
- [deviation] Plan 5 risk_surface review raised a high finding (a declared multi-byte or idna encoding escaped `parse_reply` as `ValueError`/`UnicodeError` and made `/api/discover` a 500); fixed in a87efb10, round-2 narrowed review raised nothing.

## Open items

- risk_surface plan 4, medium, declined by the owner: the METER SSE route depends on `Mgr`, so an open METER tab holds a replaced 8088 client open until the tab closes (`hqptuner/api/deps.py:100`).
- risk_surface plan 5, medium, declined by the owner: the discovery reply cap counts unparsed datagrams, so 32 junk datagrams can end a sweep before a real reply (`hqptuner/engine/discovery.py:237`).
- GET /api/connection and the login still read the record through `remembered(store)`, which raises on a corrupt record; only the save path reads through `held_record` (plan 1).
- `test_a_save_that_changes_only_the_host_logs_nobody_out` no longer exercises a host change, since a host change now needs both credentials (plan 1).
- Login strips the host before validating, so ` 10.0.0.5` is accepted at login while the save refuses it (plan 1).
- A non-identity `Content-Encoding` 8088 reply is refused with the "too large" sentence; a dedicated sentence would need owner copy (plan 4).
- `/log` past 32 MiB is refused, so the System tab log tail shows the "too large" error (plan 4).
- F-021's and F-022's "Owner ruling" quotes in DISPOSITIONS.md are taken from PLAN-2 Task 1 / CONTEXT D-07 and CONTEXT D-04, not typed by the owner there; replace if other words are wanted (plan 5).
- F-017's proofs for 52689703, 0f6745f2, f3a4d5f3 and 8e352b34 are red pre-fix as collection ImportErrors; the assertion bite by mutation is in plan-4.md. 5b73a1e3 is a performance change with no failing test (plan 5).
- Phase CI checkpoint (AC7 CI half) is the owner's: push `dev`, then read `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos`, `smoke-windows` on the last `dev` commit. Not run.

## Goal check

The goal is that F-004, F-005, F-015, F-017, F-020, F-021, F-022 and F-023 are each fixed or carry an owner ruling. `.planning/security/DISPOSITIONS.md` carries all eight: F-004 and F-005 fixed with the D-01 residual, F-015, F-017 and F-020 fixed, F-021 declined by owner ruling, F-022 fixed with the owner's alias ruling, F-023 fixed with the password still unencrypted (grep of `### F-0xx` / `Disposition:` over that file). The 28 commits in `0afcd8d9..f13aabf0` (`git log --oneline`) match those dispositions: the host validator and pin rule (e3f609bf..48bb275c), the alias gating (ffad0a0b, f10726bc), the bounded 8088 and Control API reads (52689703..5b73a1e3), discovery hardening (1342e893, eb260c54, a87efb10) and the 0600 record (23dcb192). Every plan's risk_surface fire is settled (`risk-check status --phase 6` ok for plans 1-5). The record half of AC7 is met. Its CI half is not run yet, and two declined medium findings stay as known limits. complete locally, not CI-verified
