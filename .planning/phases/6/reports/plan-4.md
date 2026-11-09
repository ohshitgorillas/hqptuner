PLAN COMPLETE

Plan: .planning/phases/6/PLAN-4.md

Tasks: 7 of 7

| Task | Commit | Note |
|---|---|---|
| 1 - total deadline on the 8088 client | 52689703 | Total = 6 x the request timeout (60 s default). `noanswer.under_total` + `HttpOptions.deadline`; `Network.http_options` and `build_http_client` take the manager clock. Bite proven by mutating `under_total` to ignore the deadline (assertion reds), not by a pre-change import error. Test deadline `TotalDeadline` lives in tests/support/fake_network.py (the only support file in the lease). |
| 2 - per-path size ceiling | 0f6745f2 | Response event hook `noanswer.reply_ceiling` on the client sees the 401 challenge body too; ceilings 256 KiB (pages, writes) and 32 MiB (`/backup/settings.zip`). Client sends `Accept-Encoding: identity` and refuses any other encoding. Owner sentence used verbatim. Bite: hook disabled, 5 reds. `fake_network._response` now answers with a stream (a content-built response is pre-read and bypasses any ceiling). |
| 3 - ungated readers | f3a4d5f3 | Live read-only GETs through the tested lane: /log 214 KB (3584 lines, daemon up 3 days, ~66 KB/day), /about 2.1 KB; also /config 30.6 KB, /matrix 23.4 KB, /speakers 4.6 KB, backup 8.74 MB, all served plain (no content-encoding) to the new client. Ceilings 32 MiB (log) and 64 KiB (about). Bite: hooks and deadline removed from both readers, 4 reds. |
| 4 - pair check | 8e352b34 | `check_pair` takes `deadline`, login passes `manager.clock`. `PAGE_CEILING` moved to `noanswer` (httpauth cannot import httpconf). Bite: 2 reds with hook and deadline removed. |
| 5 - replaced client closed | e2ae85d3 | `ConnectionManager.holding_http` + setter closes the replaced client at once or the last holder closes it; `_retired` gone. Holds at `api/deps` (`Mgr`, `HttpMgr` are async generator dependencies) and around `connect_and_load`/`poll` in `run`. Bite: idle, ten-replacement and closes-when-request-ends cases red against HEAD~; with the deps hold removed the held case reds. |
| 6 - Control API total deadline | 87e616ce | Total = 6 per-read waits, counted from the first chunk (the first read stays under the per-read wait alone: the manager's silent-daemon timing and `test_control_no_answer` rely on a silent daemon reporting the per-read seconds). Per-read expiry inside the accumulation is converted to `ControlTimeoutError(per-read)` so only the outer expiry reports the total. Bite: against HEAD~ the dripped document ends in `ConnectionClosedError`, not `ControlTimeoutError`. `.filepawl.toml` allowance for control.py recorded at 404. |
| 7 - per-chunk scan | 5b73a1e3 | Incremental UTF-8 decoder; parse attempted only after a chunk whose last non-space byte is `>`. Characterization (rule 8 exemption): existing bare-`&`, double-escaped, unparseable and never-ending cases stay green, plus a document cut inside a multibyte character. Mutating the decoder to per-chunk decode and the trigger to never fire each go red. control.py kept at 404 lines (the allowance) by compact docstrings, since `filepawl accept` cannot raise an allowance. |

Deviations: none

Open items:

- Plan 4 Task 1 says Plan 3 Task 5 removed `_adopt_alias`'s rebuild; in HEAD `_adopt_alias` still rebuilds the client (`manager.http_client = build_http_client(...)`, owner overrule D-04), so it was one of the three callers handed the manager's clock.
- A reply in a non-identity `Content-Encoding` is refused with the owner's "too large" sentence, since a compressed body has no size until decoded; no separate sentence was approved. A dedicated sentence needs owner copy.
- The decoded size of a compressed reply is never bounded because compressed replies are refused outright; had they been allowed, a gzip bomb would have passed a raw-byte ceiling.
- Task 1/4/6 tests use `TotalDeadline` (a racing `wait_for` on virtual time in `tests/support/fake_network.py`) rather than `VirtualClock.fall_silent`, because `VirtualClock.wait_for` hands the operation's own result until silenced and so cannot end an endless drip. It sits in `fake_network.py` because that was the only support file in the lease.
- `/log` past 32 MiB (about 500 days of daemon uptime at today's rate) is refused, so the System tab log tail then shows the "too large" error, as the plan specifies for every path.
- Per-task `make check` was not run on its own: each commit ran the repo's pre-commit gates (ruff, black, xenon, vulture, mypy, import-linter, assertion gates, offline pytest with coverage floor, filepawl, LLM judges) in full, and `make lint` was run before each; the one full `make check` is the final suite.
- Declined: a configurable total (`HttpOptions.total` field) and a Content-Length early refusal; the derived `6 x timeout` and the streaming cap met every Verify.
