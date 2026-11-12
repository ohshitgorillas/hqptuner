---
phase: 8
status: complete
completed: 2026-11-12
---

# Phase 8: Config write path and input validation - Summary

Client input now reaches hqplayerd and its files only in allowed shapes: XML attribute values are escaped, staged values are checked against the daemon's own page choices and carry length and key-count ceilings, restore uploads and archives carry size and member-name ceilings, Control API values containing `"` are refused, profile switches name only listed profiles, preset paths stay inside their store, and every one of the thirteen findings has its disposition in `.planning/security/DISPOSITIONS.md`.

## What shipped

- XML attribute escaping on write and unescaping on read, the fixed-volume line escaped, the whitespace-leading patterns anchored on a literal - `hqptuner/conf/xmledit.py`, `hqptuner/conf/fixedvol.py`, `hqptuner/conf/matrixconf.py`, `hqptuner/conf/matrixprofiles.py`
- Staged values: length ceiling 262144 characters, key ceiling 256, control characters, lone surrogates and U+FFFE/U+FFFF refused - `hqptuner/api/routes/pending.py`, `hqptuner/conf/xmledit.py` (`attr_cannot_carry`)
- One choices decision (`presetconf.check_choices`) used by the stage route and the LIVE route - `hqptuner/conf/presetconf.py`, `hqptuner/api/routes/pending.py`
- A 401 after a normal answer in the same apply is reported as an engine fault and leaves `credentials_ok` as it was - `hqptuner/lanes/http/restore.py`
- Restore: upload ceiling, declared member and total size ceilings before any read, member-name rule, the same ceilings on the first-connect archive read, archive description entries held to the PUT limits - `hqptuner/conf/presetzip.py`, `hqptuner/api/routes/config.py`, `hqptuner/presets/store/descriptions.py`
- Control API: a value containing `"` is refused before a byte is written; `POST /api/volume` refuses a non-number level; a profile switch re-reads the daemon's list and refuses an unlisted name - `hqptuner/engine/control.py`, `hqptuner/api/routes/volume.py`, `hqptuner/lanes/matrixlane.py`
- Stored names: Windows build refuses `:` and reserved device names; preset paths resolve inside their store; `/api/audit` answers at most 1000 rows - `hqptuner/presets/names.py`, `hqptuner/presets/store/presets.py`, `hqptuner/api/routes/audit.py`
- SPA option lookups read own keys only - `hqptuner/static/store/plainnames.js`, `hqptuner/static/store/narrow/match.js`
- `docs/architecture.md` section 4.7, `docs/matrix-spec.md` and `docs/openapi.json` descriptions updated
- One `### Security` bullet under `[Unreleased]` in `CHANGELOG.md`
- Thirteen disposition entries - `.planning/security/DISPOSITIONS.md`

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | 2665a322 | escape attribute values on write, unescape on read |
| 1 | 2 | 87f967e0 | the fixed-volume line escapes its level |
| 1 | 3 | 135c4c1d | the five whitespace-leading patterns start on a literal |
| 1 | 4 | 6feb6195 | staged values carry a length and a key-count ceiling |
| 1 | 5 | 5721909e | one decision says whether a staged value is among its page's choices |
| 1 | 6 | 60611f4f | the stage route refuses a value its page does not offer |
| 1 | 7 | 8eb3e576 | the LIVE route refuses a value its page does not offer |
| 1 | 8 | f1bcc93c | a 401 after a normal answer in the same apply is an engine fault |
| 1 | fix | 35c6a137 | a staged value with a control character is refused (risk_surface fix pass) |
| 1 | fix | 1c9453b2 | a value holding a surrogate or U+FFFE/U+FFFF is refused (risk_surface re-arm, by hand on the owner's word) |
| 2 | 1 | 9803eddd | an oversized restore upload is refused before it is read |
| 2 | 2 | 56b41122 | an archive's declared member sizes are checked before any member is read |
| 2 | 3 | 762e8034 | the first-connect archive read carries the same ceilings |
| 2 | 4 | ddc4bbde | an archive member name outside the observed set is refused |
| 2 | 5 | 05d1fdf6 | description entries an archive carries meet the PUT limits |
| 3 | 1 | c8de972d | a Control API attribute value containing a double quote is refused |
| 3 | 2 | 0129d2f7 | POST /api/volume refuses a level that is not a number |
| 3 | 3 | 00869dfd | a profile switch names only a profile the daemon lists |
| 4 | 1 | fb93582b | the Windows build refuses a colon or a device name in a stored name |
| 4 | 2 | 02d09c02 | a preset path stays inside its store |
| 4 | 3 | 6419c0dc | /api/audit answers at most its cap |
| 4 | 4 | 00e726e1 | the SPA's option lookups read own keys only |
| 5 | 1 | none | read-only check: the phase's one Security bullet is present verbatim (landed by 2665a322) |
| 5 | 2 | 34271eaf | the thirteen phase 8 findings have their dispositions |

## Deviations

- [deviation] Plan 1 Task 2: the Verify expected a parked `fixed_volume` of `1-->` to be non-well-formed; expat parses it well-formed with the level corrupted. The well-formedness test uses `1--2`; `1-->` stays as the read-back test. Commit 87f967e0.
- [deviation] Plan 2 Task 2: the plan assumed `UnreadableArchiveError` already mapped to a 4xx; `archive_unreadable` maps to 500. To meet the 4xx must-be-true (D-16), the restore route's `ArchiveUnreadableError` now carries `invalid_input` (422); `archive_unreadable` stays for daemon-archive paths. Commit 56b41122. The `docs/architecture.md` error-table row for `archive_unreadable` is now stale (open item).
- [deviation] Plan 3 Task 2: the Verify expected the `-3"/><Stop/` level to be red before; Task 1's quote refusal in `ControlClient.send` already refused it, so only the `abc` case was red. Commit 0129d2f7.

## Open items

- `docs/architecture.md` error-table row `archive_unreadable | 500 | an uploaded backup archive ...` is stale after 56b41122; it should name an archive the daemon served. Outside every plan's lease.
- New user-facing strings awaiting owner approval (refusal copy was delegated in Plan 1 Notes; the hard copy rule still wants the owner's character-for-character sign-off): `pending.py` `StagedValueTooLongError`, `StagedBufferFullError`, `NOT_OFFERED_REASON`, `StagedValueControlCharsError`; `restore.py` `RestoreRefusedAfterAnswerError`; `routes/config.py` `RestoreUploadTooLargeError`, `ArchiveTooLargeError`, `ArchiveMemberNameError`; `controlerrors.py` `AttributeValueRefusedError`; `matrixlane.py` `UnknownProfileError`; `names.py` "contains colon.", "reserved device name.", `OUTSIDE_STORE`. Whether the UI displays each is not verified.
- D-11 refuses any member name containing `..`, so a preset named with two dots (`a..b`) is refused on restore; tightening to path components is the owner's call.
- Archive member ceilings (64 MiB member, 128 MiB total) do not follow a raised `Config.filter_max_bytes`; a filter limit above 64 MiB would have its own backup refused on restore.
- The key ceiling counts `http` fields plus `live` keys, not arguments inside one live bucket; a bucket with many short arguments is bounded only by the request body size.
- An apply whose only 401s are swallowed by settle polls (ending unconverged, never raising `AuthRefused`) still leaves the client verdict False.
- A Windows-saved name such as `A:B` cannot be overwritten by a later save on a Windows build; read, apply and delete still work.
- Plan 5's disposition entries quote the Q3 ruling and D-05, D-06, D-07; the owner may want to review the quotations. F-019's anchoring is held by characterization only (D-09).
- Damage report from Plan 1: an executor ran `pytest tests/live`, whose canary tests made read-only GETs against the production hqplayerd with the stock pair (answered 401). Nothing was written; nothing left running.
- The offline suite's wall-time gate refused commits during Plan 1 under host load; the owner made one `--accept`. Cause investigation is in `.planning/phases/8/HANDOFF-suite-time.md`, unresolved.
- The pre-commit hook runs the offline suite twice per commit, several minutes each, docs-only commits included.
- Not run: `ci-status` on the seven CI jobs (AC6); `/cad-verify` reads it after the owner pushes.

## Goal check

All thirteen findings carry a disposition in `.planning/security/DISPOSITIONS.md` (34271eaf, 89 lines added; `grep '^### F-0'` finds F-006, F-007, F-010, F-011, F-012, F-013, F-014, F-016, F-018, F-019, F-026, F-032 and F-033, each with a `Disposition:` line). Eight are Fixed outright, backed by named commits: F-006 (2665a322, 87f967e0, 35c6a137, 1c9453b2), F-010 (c8de972d, 0129d2f7), F-013 (5721909e, 60611f4f, 8eb3e576, f1bcc93c), F-014 (00869dfd), F-016 (9803eddd, 56b41122, 762e8034), F-019 (135c4c1d, 6feb6195), F-026 (fb93582b, 02d09c02), F-032 (05d1fdf6). F-007, F-018 and F-033 are fixed in part with the rest declined on recorded owner rulings (D-04, D-06, D-07), and F-011 and F-012 are declined on owner rulings (D-05, D-03). The goal's "fixed or carry an owner ruling" is met on the record. Two gaps sit below the goal: a stale `docs/architecture.md` error row from Plan 2's deviation, and the new refusal strings, which still need the owner's verbatim sign-off under the copy rule. Every plan's report records `make test` green at its end (Plan 5: exit=0, 100.3s).

complete locally, not CI-verified
