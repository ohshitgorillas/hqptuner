PLAN COMPLETE

Plan: .planning/phases/8/PLAN-2.md

Tasks: 5 of 5

Final suite: `scripts/gate.sh make test` (the Makefile `test` target; `workflow.test_command` is null) printed `exit=0`, suite 98.2s against last green 100.2s, coverage floor, idle and clock-wait gates ok.

| Task | Commit | Note |
|---|---|---|
| 1 - An oversized restore upload is refused before it is read | 9803eddd | `presetzip.DESCRIPTIONS_CEILING` and `RESTORE_UPLOAD_CEILING`; `_read_upload` in `routes/config.py`. Bite: both tests red before (`KeyError: 'code'`, `assert 1 == 0`). No changelog bullet (phase ships one, landed by Plan 1); `check_changelog.py` exit=0. |
| 2 - An archive's declared member sizes are checked before any member is read | 56b41122 | `presetzip.list_members`, `SizeCheck`, `check_sizes`, `ARCHIVE_FAULTS`, `MEMBER_CEILING` 64 MiB, `TOTAL_CEILING` 128 MiB. Bite: one-member-over and total-over red (`KeyError: 'code'`, `assert 2 == 1`), corrupt member red (`assert (500 // 100) == 4`). See deviation. |
| 3 - The first-connect archive read carries the same ceilings | 762e8034 | `snapshot_members` checks sizes first and raises `ArchiveOverCeilingError`; reads raise `UnreadableArchiveError`; `loader._load_http_lane` handler names both in place of `BadZipFile`. Bite: over-ceiling function case `DID NOT RAISE`, corrupt function case `zlib.error` escaped, over-ceiling wiring case imported `x`, corrupt wiring case `FixtureError: app never became ready` (the connect was undone). |
| 4 - An archive member name outside the observed set is refused | ddc4bbde | `presetzip.check_names`, `NameCheck`; `_refuse_unfit_archive` in `routes/config.py`; `filepawl accept` on `routes/config.py` (406 lines, `.filepawl.toml`). Bite: six refusal cases red on code and on the restore count; the two accepted shapes are characterization (green before and after). No existing test went red. |
| 5 - Description entries an archive carries meet the PUT limits | 05d1fdf6 | `descriptions._storable` called from `merge`; entries dropped with a warning. Bite: the three dropped cases red, the valid entry green. |

Deviations:

- [deviation] Task 2 asserted `UnreadableArchiveError` "the route already maps to a 4xx"; `docs/architecture.md` §8.1 and `errors.STATUS` map `archive_unreadable` to 500, so a corrupt member answered 500 even after widening the catch. The Must-be-true (a malformed upload answers a 4xx, D-16) holds only if the route's answer changes: `ArchiveUnreadableError` in `routes/config.py` now carries code `invalid_input` (422). `archive_unreadable` stays for the daemon-archive paths (`engineattrs`, `restore.py`). `docs/architecture.md` row 284 (`archive_unreadable | 500 | an uploaded backup archive that is not a readable zip, or whose descriptions will not parse`) is now stale and is outside this plan's lease: the owner or the docs commit should reword it to an archive the daemon served that is not a readable zip.

Open items:

- Descriptions headroom uses 12 bytes a character (the worst `json.dumps` spelling of the store's own export), not the brief's 4, so the ceiling is the largest member this store can write: 6.7 MB.
- The filepawl `claims` gate refused a test asserting only `_restore_attempts == 0`; the tests assert the count after a refused upload and a normal one (1).
- Member ceilings are constants (64 MiB member, 128 MiB total) and do not follow a raised `Config.filter_max_bytes`; a configured filter limit above 64 MiB would have its own backup refused on restore. Declined as the fuller shape: nothing in the plan sets one.
- D-11 is applied as written: any name containing `..` is refused, so a member such as `data/cfgs/a..b.xml` (a preset named with two dots) would be refused, where only a `..` path component is a traversal. Tighten to components if the owner wants preset names with `..` to survive a restore.
- No test added for a broken central directory at the restore route: the brief names an existing test pinning it, none exists at the route (`tests/presets/test_archive_resolution.py` covers `engineconf` only); the corrupt-member case exercises the same refusal path.
- A corrupt-descriptions "no restore sent" case was dropped: it was green before the change (the 500 stopped it), so it constrained nothing; the 4xx case carries it. The over-ceiling connect case "health answers 200" was dropped for the same reason (green before; `ready_app` already fails if the connect is undone).
- `CHANGELOG.md` is unchanged by this plan, as the Plan 1 owner ruling directs (one phase bullet, landed by Plan 1); `check_changelog.py` printed `exit=0` at each marked task.
- New user-facing strings, all `invalid_input` 422 from `POST /api/restore` (the UI display is not verified here): `RestoreUploadTooLargeError` "The settings file is too large to restore.", `ArchiveTooLargeError` "The settings file holds more data than a settings file can.", `ArchiveMemberNameError` "The settings file holds a file that does not belong in a settings backup." (all `hqptuner/api/routes/config.py`); `ArchiveUnreadableError` keeps its own message (`N bytes, not readable`) under the new code.
- The pre-commit hook runs the offline suite twice per commit (the pre-commit stage, then a second stash-and-run stage); a commit takes about five minutes.
- The first tree-gate run refused two comment lines for narrating measurements (comment-trivia judge); the comments now state the constraint, and the measurements live in the Task 2 commit message.
