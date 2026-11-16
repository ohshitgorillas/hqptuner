---
phase: 8
plan: 2
# Phase 8 maps no requirement ID (ROADMAP: "Requirements: None"); this plan covers F-007, F-016, F-018 (the restore ceilings) and F-032, against CONTEXT AC3.
requirements: []
files:
  - hqptuner/api/routes/config.py
  - hqptuner/conf/presetzip.py
  - hqptuner/core/loader.py
  - hqptuner/presets/store/descriptions.py
  - CHANGELOG.md
  - .filepawl.toml
  - tests/api/surface/test_restore_limits.py
  - tests/engine/http/test_snapshot_member_ceiling.py
  - tests/api/surface/test_restore_members.py
  - tests/api/surface/test_restore_descriptions.py
---

# Phase 8: Config write path and input validation - Plan 2: The restore route

## Goal

Findings F-006, F-007, F-010, F-011, F-012, F-013, F-014, F-016, F-018, F-019, F-026, F-032 and F-033 are each fixed or carry an owner ruling. This plan closes `POST /api/restore`: an upload over its ceiling, an archive whose members declare more than their ceilings, and an archive carrying a member name outside the observed set are refused with nothing sent to the daemon (F-007, F-016, F-018), the first-connect archive read carries the same ceilings (F-016), and description entries an archive carries meet the `PUT` limits (F-032).

## Must be true when done

- A restore upload over its ceiling is refused, and nothing reaches the daemon's `/restore` (AC3, D-10).
- An archive with a member whose declared decompressed size is over its ceiling, or whose members' total is, is refused before any member is read, and nothing reaches the daemon (AC3, D-10).
- An archive with a member name that is absolute, contains `..`, contains a backslash, carries a drive prefix, or sits at the root beside the working config is refused, and nothing reaches the daemon; an archive shaped like this host's real backups is accepted (AC3, D-11).
- A malformed upload answers a 4xx, never a 500 (D-16).
- An over-limit description entry in an accepted archive is dropped and logged, and the other entries merge (AC3, D-12).

## Context

- Locked: D-04 (no safety copy before an uploaded restore, owner ruling "smells like scope expansion"), D-10, D-11, D-12, D-16. Out: any hostile `/restore` probe against the production daemon.
- `restore` in `hqptuner/api/routes/config.py` reads the whole upload, audits it, strips `presetzip.DESCRIPTIONS_MEMBER` through `presetzip.take_descriptions` (which reads every member when that member is present), merges the descriptions, then `settle.restore`. Every check here runs before `take_descriptions` and before the merge, so a refused upload merges no description and sends nothing.
- The `/api/matrix/filter` route is the pattern: it checks `UploadFile.size` before reading. Starlette 1.6.0 (pinned in this venv) spools a file part to disk past 1 MiB (`MultiPartParser.spool_max_size`), so the upload is not held in memory before the route runs; the route-level ceiling bounds what the route reads (CONTEXT flagged assumption, answered by reading the pinned source).
- Real backups on this host: about 8.7 MB compressed, 10.7 MB decompressed, largest member 2.36 MB, root members `data/` (a directory entry) and `hqplayerd.xml` (listing of `pre-apply-settings.zip` under `/srv/hqptuner/state/backups/` and `/srv/hqptuner.v1/backups/`, read-only).
- Refusals reuse `invalid_input` (422); no new code. Tests-first with bite (`docs/testing.md` rule 8); codes and types asserted, never sentences (rule 9).
- Changelog binding as in Plan 1 Context: a task marked **Changelog** lands its owner-approved `### Security` bullet in its own commit (copy item 12), and the changelog gate prints `exit=0` in its Verify.

## Tasks

### Task 1: An oversized restore upload is refused before it is read

- **Files:** hqptuner/api/routes/config.py, hqptuner/conf/presetzip.py, CHANGELOG.md, tests/api/surface/test_restore_limits.py
- **Changelog:** yes (one bullet may cover Tasks 1, 2 and 4 if the owner's approved copy says so; it then lands with Task 1).
- **Action:** `restore` refuses an upload larger than `httpconf.BACKUP_CEILING` plus headroom for the descriptions member, before the body is read into the route: check `cfgfile.size` as `matrix_filter` does, and where the size is unknown read no more than the ceiling plus one byte and refuse past it. The headroom covers the largest descriptions member the store's limits allow (256 profiles, 128-character names, 2000-character texts, UTF-8 at up to four bytes per character, plus JSON framing); `conf` cannot import the store, so the ceiling is one constant beside `DESCRIPTIONS_MEMBER` in `presetzip.py` with that derivation in its comment. A bare XML upload is held to the same ceiling. The refusal is an `ErrorBody` with code `invalid_input` and the owner-approved sentence (Plan 1 Notes, copy item 5); if it is not in hand, stop and ask. A refused upload is not audited: the record carries a SHA-256 of bytes the route never reads.
- **Verify:** Testing scope, REST lane on the in-process fakes (risk surfaces `untrusted_input`, `destructive`): an upload one byte over the ceiling answers `invalid_input` and the fake 8088 counts no `/restore`. A real-size archive restoring is already covered by the existing restore tests, which stay green unchanged; name them in the commit message. Building the over-ceiling body costs about 34 MB of test memory once (under the 1 GB disclosure line). Bite: red against the commit before this one (pre-change answers 200 and counts one `/restore`). `scripts/gate.sh make check` prints `exit=0`.

### Task 2: An archive's declared member sizes are checked before any member is read

- **Files:** hqptuner/conf/presetzip.py, hqptuner/api/routes/config.py, .filepawl.toml, CHANGELOG.md, tests/api/surface/test_restore_limits.py
- **Changelog:** yes, unless Task 1's bullet covers it.
- **Action:** Add to `presetzip.py` a pure check over an archive's `ZipInfo` list that refuses when one member's declared `file_size` is over a per-member ceiling or the members' declared total is over a total ceiling, returning one typed result (rule 17). `restore` runs it on every archive upload (`presetzip.is_archive`), whether or not it carries the descriptions member, before `take_descriptions`, so no member is decompressed past it; the declared size is also the bound `zipfile` stops a read at, so checking it first bounds what any later read can produce. Ceiling values: both real backups on this host pass with the margin `BACKUP_CEILING` already carries over its largest body (about four times), and a member as large as `Config.filter_max_bytes` passes, since a parked filter rides the archive as a `data/` member; state the numbers and their derivation in the constants' comment and the commit message. Opening the archive and listing its members catches every exception type (D-16: `zipfile.BadZipFile`, `zipfile.LargeZipFile`, `NotImplementedError`, `RuntimeError`, `ValueError`, `EOFError`, `OSError` and whatever else the open raises), so a malformed archive answers `invalid_input`, never a 500. The same holds past the listing: `presetzip.take_descriptions` decompresses members inside `except (zipfile.BadZipFile, OSError)` alone (`presetzip.py:169-175`), so a member with a corrupt deflate stream (`zlib.error`), an encrypted member (`RuntimeError`) or an unsupported compression method (`NotImplementedError`) answers 500 today; widen that catch to every exception type, raising `engineconf.UnreadableArchiveError` as it does now, which the route already maps to a 4xx. Refusals are `ErrorBody`s with code `invalid_input` and owner copy (copy item 6). Nothing is sent and no description merges on a refusal. Run `filepawl accept` if it prints it.
- **Verify:** Testing scope, REST lane: an archive with one member declaring a decompressed size over the per-member ceiling (built by streaming zeros into a `ZipFile.open(..., "w", force_zip64=True)` member in chunks, so the test never holds the decompressed bytes) answers `invalid_input` with zero `/restore`; an archive whose members are each under the per-member ceiling but whose total is over answers the same; an archive with an intact central directory whose `hqptuner/descriptions.json` member carries a corrupt deflate stream answers a 4xx (status class asserted, rule 11) with zero `/restore`. Bite: all three red against the commit before this one (pre-change forwards an archive without the descriptions member unread, answering 200, and the corrupt-member case answers 500 from the uncaught `zlib.error`). An archive with a broken central directory is already refused as `archive_unreadable` before this task; the existing test that pins it is named in the commit message, and none is added (rule 12). `scripts/gate.sh make check` prints `exit=0`.

### Task 3: The first-connect archive read carries the same ceilings

- **Files:** hqptuner/conf/presetzip.py, hqptuner/core/loader.py, tests/engine/http/test_snapshot_member_ceiling.py
- **Action:** `presetzip.snapshot_members` runs Task 2's check before reading any member (D-10), and an archive over a ceiling raises a refusal that `loader._load_http_lane`'s migration handler logs and skips exactly as it does a `zipfile.BadZipFile` today, adding the refusal's type to that `except` if it is not already a subclass of one listed there. Reading a member also catches every exception type (D-16), as Task 2 makes `take_descriptions` do, and raises one type the migration handler skips, so a corrupt, encrypted or unsupported-method `data/cfgs/` member skips the migration instead of escaping `_load_http_lane` (which catches only `HTTPError`, `PresetError`, `OSError` and `BadZipFile` there, `loader.py:143`). The store keeps what it had and the 4321 connect is not undone.
- **Verify:** Testing scope, function lane plus wiring cases: `snapshot_members` over an archive with a `data/cfgs/x.xml` member declaring an over-ceiling size raises (type asserted) without reading it; an app whose fake 8088 serves that archive as `/backup` connects (`/api/health` answers 200) with no preset imported; an app whose fake 8088 serves a `/backup` whose `data/cfgs/x.xml` member carries a corrupt deflate stream connects the same way. Bite: all three red against the commit before this one (pre-change reads the over-ceiling member and imports `x`, and the corrupt member's `zlib.error` escapes the migration handler). If the corrupt-member wiring case is green before the change because a caller above `_load_http_lane` swallows the exception, it stays as characterization, and a function-lane case, `snapshot_members` over that archive raising the type the migration handler skips, is the bite in its place. `scripts/gate.sh make check` prints `exit=0`.

### Task 4: An archive member name outside the observed set is refused

- **Files:** hqptuner/conf/presetzip.py, hqptuner/api/routes/config.py, CHANGELOG.md, tests/api/surface/test_restore_members.py
- **Changelog:** yes, unless Task 1's bullet covers it.
- **Action:** Add to `presetzip.py` a pure check of an archive's member names, run by `restore` on every archive upload beside Task 2's check and before `take_descriptions` (D-11). Refused: a name that is absolute (leading `/`), contains `..`, contains a backslash, or carries a drive prefix (a letter and a colon first); and any root-level member, meaning a name with no `/` (so a directory entry such as `data/` is not one), other than the working config. The working config is `hqplayerd.xml` when present, else a sole root-level `.xml` that is not `hqplayerd-auth.xml` (`docs/protocol.md` §3.5 names that file as the daemon's credential store; `docs/protocol.md` §3.6 the renamed `<Profile>.xml`), as Plan 1 Notes Q2 confirms or tightens; if the ruling is not in hand, stop and ask. Use `engineconf.running_config_name` for the first two arms rather than a second spelling of them. The rule is the observed-member rule D-11 states: HQPlayer's docs do not document the format. A bare XML upload is not an archive and is unaffected. The refusal is an `ErrorBody` with code `invalid_input` and owner copy (copy item 7); nothing is sent and no description merges.
- **Verify:** Testing scope, REST lane (risk surfaces `untrusted_input`, `destructive`): parametrized refusals `/etc/x`, `data/../x`, `data\x`, `C:x.xml`, a root `hqplayerd-auth.xml` beside `hqplayerd.xml`, and a root `run.sh` beside `hqplayerd.xml` each answer `invalid_input` with zero `/restore`; an archive shaped like this host's backups (a `data/` directory entry, `hqplayerd.xml`, `data/cfgs/A.xml`, `data/impulse_0-0.wav`) restores, and so does a preset-active one (root `Speakers.xml`, no `hqplayerd.xml`). The two accepted shapes are characterization, green before and after, and are where testing stops. Bite: every refusal case red against the commit before this one. Any existing restore test that goes red because its archive carries a root member outside this rule is reported for the owner, never edited. `scripts/gate.sh make check` prints `exit=0`.

### Task 5: Description entries an archive carries meet the PUT limits

- **Files:** hqptuner/presets/store/descriptions.py, CHANGELOG.md, tests/api/surface/test_restore_descriptions.py
- **Changelog:** yes.
- **Action:** `DescriptionStore.merge` passes each incoming entry's name through `_validate_name` and its text through `_validate_text`, the checks `write` uses. A failing entry is dropped and logged with a warning, and the rest merge, keyed by the name `_validate_name` returns as `write` keys it (D-12). The 256-profile ceiling in `_save` is unchanged. Only the carried payload changes: `_clean` on an ordinary store read stays as it is, since D-12 names archive-carried entries.
- **Verify:** Testing scope, store lane (strong area `hqptuner/presets/store/`): a payload holding one entry whose text is 2001 characters, one whose name carries a control character, one whose name is 129 characters, and one valid entry; after `merge`, `read()` holds no entry for each of the three bad names (parametrized, one claim each) and holds the valid entry's text. Bite: the three dropped cases red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`.

## Notes

- **Owner rulings, 2026-11-11.** Plan 1 Notes, first bullet, holds them and supersedes every copy stop and every changelog bullet in this plan: no task here stops for copy or adds a changelog bullet.
- **D-04.** No safety copy is taken before an uploaded restore; owner ruling, quoted: "smells like scope expansion" (recalled from phases/7/CONTEXT.md, phase 7). Plan 5 records it in F-007's disposition.
- **D-06.** The remaining bounded archive work stays on the event loop, declined in the lock (recalled from phases/7/CONTEXT.md, phase 7); Tasks 1 and 2 are the bounds that make it brief.
- **Residual, for the owner, not planned.** Starlette's spool to disk has no size limit of its own, so a large upload still costs temporary disk until the route refuses it; D-10 bounds what the route reads, not what the multipart parser spools.
- **`..` reading.** D-11 says "contains `..`", so a daemon-side preset named with two consecutive dots (HQPTuner's own name rule already refuses such a name) would be refused in an uploaded archive. Followed literally.
- Copy items 5, 6 and 7 are gathered with Plan 1's request (Plan 1 Notes). Shared with other plans: `.filepawl.toml`, `CHANGELOG.md`.
