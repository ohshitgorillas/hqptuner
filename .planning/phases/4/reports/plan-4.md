PLAN COMPLETE

Plan: .planning/phases/4/PLAN-4.md

Tasks: 5 of 5

| Task | Commit | Note |
|---|---|---|
| 1 /api/health drops license name and fingerprint | 2b163fd3 | red before the fix: name and fingerprint cases (2 failed, 1 passed); green after |
| 2 /api/status serves only the metadata the page reads | e046dafa | red before the fix: uri and other cases (2 failed, 1 passed); green after |
| 3 /api/log drops path | 2e9fd4bd | response shape `LogTailReport` in routes/status.py, `engineread.LogTail` untouched; docs/openapi.json regenerated with `--write` then prettier-formatted (only the LogTail schema changes); red before the fix: `test_log_tail_carries_no_log_file_path` (1 failed, 9 passed) against an 8088 fake serving the 6.0.4 config form, which names a log file |
| 4 export withholds credential files in copied directories | 6f040843 | `_dir_members` skips names in {CONNECTION_STORE.name, LOGIN_KEY_FILE, the configured record's name}; red before the fix: 9 of the 9 new cases (4 password, 4 secret, 1 record under another name) |
| 5 DISPOSITIONS.md | e2ccb49f | 9 entries, every hash resolves with `git cat-file -e`, titles match REPORT.md line for line, both rulings verbatim, md-softwrap --check exit 0, every named test exists. The seven CI jobs are human-verify: the owner pushes `dev` and reads the run. |

Deviations: none

Open items:
- tests/api held 30 files, the filepawl directory cap, so the new test files the plan names (test_status_metadata_kept.py, test_log_tail_fields.py) cannot exist there; `filepawl accept` takes no directory allowance. The status-metadata and log cases went into the leased tests/api/test_api_health.py instead, with its docstring widened.
- Declined: a fuller test fixture. The log case builds a small 8088 handler in the test file rather than adding a `log_file` row to tests/support/fake_http.py, which is outside the lease.
- The seven required CI jobs (`check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos`, `smoke-windows`) are the owner's: push `dev` at this plan's last commit and read the run. Not run here.
- Added beyond the plan's two names: the export also withholds a file named as the configured `connection_file` when that name is not `connection.json` (same cause, one case).
