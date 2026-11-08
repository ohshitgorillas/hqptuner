---
phase: 4
status: complete
completed: 2026-11-08
---

# Phase 4: API exposure and authentication - Summary

Every `/api` route sits behind a login checked against the daemon's own management pair (`LoginGate`, a `SameSite=Strict` cookie), every caller logs in (the SPA login screen, `abuse.sh`, `eqstage`, the CI smokes and probes), a cross-site state-changing request is refused 403, the page carries a content policy with `frame-ancestors 'none'` and `nosniff`, the FastAPI docs pages are off, the API stops serving license, metadata and log-path fields the UI does not read, the state export withholds credential files, and `.planning/security/DISPOSITIONS.md` records all 9 findings.

## What shipped

- Login and gate: `hqptuner/conf/httpauth.py` `check_pair`, `hqptuner/core/login.py`, `hqptuner/api/login.py`, `hqptuner/api/gate.py` `LoginGate`; a login differing from a pinned `HQPTUNER_HQP_*` value is refused 403 `login_values_pinned`.
- Callers: SPA login screen (`setup.js`, `Setup.js`, `api.js`), `packaging/linux/lifecycle.sh`, `packaging/windows/smoke.sh`, `scripts/ci/daemon_standin.py`, `scripts/ci/apilogin.py`, `fuzz.py`, `authority.py`, `sweep.py`, `sweepslide.py`, `scripts/abuse.sh`, `scripts/eqstage/post.js`.
- Cross-site refusal: `hqptuner/api/crosssite.py` `CrossSiteGuard`, outermost in `create_app`.
- Page headers: `hqptuner/api/spa.py` `page_policy()`, CSP with the import map allowed by hash, `nosniff`, pinned `.js`/`.css` types.
- Docs routes off: `factory.py` `docs_url=None, redoc_url=None, openapi_url=None`; `docs/openapi.json` unchanged.
- API fields: `/api/health` without license `name`/`fingerprint`, `/api/status` metadata limited to the six keys the page reads, `/api/log` without `path` (`hqptuner/api/routes/status.py`).
- Export: `hqptuner/presets/store/export.py` `_dir_members` skips `connection.json`, the login secret file and the configured record's name.
- Dispositions: `.planning/security/DISPOSITIONS.md`, 9 entries.

## Commits

| Plan | Task | Commit | Description |
|---|---|---|---|
| 1 | 1 | a37d6636 | REPORT.md tracked under `.planning/security/` |
| 1 | 2 | 93468ee5 | `check_pair` and `PairVerdict` |
| 1 | 3 | 59ccd611 | login token, `LoginSecret`, `LOGIN_KEY_FILE` |
| 1 | 4 | dcc76891 | `/api/login` route and cookie helper |
| 1 | 5 | cf611224 | offline test apps log in over the wire |
| 1 | 6 | 402420cf | e2e stack logs in once |
| 1 | 7, 8 | a666a057 | `LoginGate`; `write_connection` re-issues the cookie |
| 1 | fix | d2d55a38 | pinned values refuse a differing login (risk_surface high) |
| 2 | 1 | 49ac1d74 | store: logged-out signal, `api.login` |
| 2 | 2 | 23244ee9 | login screen; CHANGELOG `### Security` entry |
| 2 | 3 | a48f8ad5 | `tests/e2e/test_login.py` |
| 2 | 4 | 3c55fdb0 | daemon stand-in moved to `scripts/ci/`; lifecycle smokes log in |
| 2 | 4b | 1f585b05 | login screen shows `login_values_pinned` |
| 2 | 5 | 8e862cf6 | Windows smoke stand-in and login |
| 2 | 5b | 6a59d625 | Windows stand-in diagnostics (owner-approved) |
| 2 | 5c | f3fe8c95 | Windows stand-in starts before the app, 120 s wait |
| 2 | 6 | c25d3aaa | `apilogin.py`; `fuzz.py` and `authority.py` log in |
| 2 | 6 | 356dcefe | `sweep.py` and `sweepslide.py` log in |
| 2 | 7 | 8850b6ff | `abuse.sh` and `eqstage` log in |
| 2 | fix | c0cd0f68 | `eqstage` names the login when it gets no answer (risk_surface medium) |
| 3 | fix | a54f694e | abuse-bracket e2e passes the stack's login pair |
| 3 | 1 | f15feb97 | cross-site state-changing request refused 403 |
| 3 | 2 | dfd5eb54 | CSP, `nosniff`, anti-framing on the page |
| 3 | 3 | c4967603 | FastAPI docs pages off |
| 4 | 1 | 2b163fd3 | `/api/health` drops license name and fingerprint |
| 4 | 2 | e046dafa | `/api/status` metadata limited to the page's keys |
| 4 | 3 | 2e9fd4bd | `/api/log` drops `path` |
| 4 | 4 | 6f040843 | export withholds credential files in copied directories |
| 4 | 5 | e2ccb49f | DISPOSITIONS.md |

## Deviations

- [deviation] Plan 1: Tasks 7 and 8 landed as one commit, a666a057, because the gate alone turns `test_posted_credentials_open_the_config_route_with_no_restart` red.
- [deviation] Plan 1: `tests/live/test_live_chain.py` carries no `live` marker and runs offline; its builder now uses `unserved_login` (cf611224).
- [deviation] Plan 1: `tests/api/test_meter_feed_route.py` also calls the ASGI app directly and now sends the login cookie (cf611224).
- [deviation] Plan 1: `test_abuse_bracket.py` pointed `CURL_HOME` at a `.curlrc` carrying the cookie so `abuse.sh` ran unchanged (402420cf).
- [deviation] Plan 2: the meter feed case accepts 204 as well as 200, since `ADVISOR_ENABLED = False` makes `/api/meter/feed` answer 204 (a48f8ad5).
- [deviation] Plan 2: the `pinned` verdict and `loginSentence` signal were added at the owner's direction so the `login_values_pinned` refusal reaches the login screen (1f585b05).
- [deviation] Plan 2: the Windows stand-in listens on `127.0.0.2:8088` and the login names no host, because `smoke.sh` pins `HQPTUNER_HQP_HOST=127.0.0.2` (8e862cf6).
- [deviation] Plan 3: the three new API test files went to `tests/api/surface/`, owner decision, because `tests/api` is at the filepawl cap of 30 files; lease amended.
- [deviation] Plan 3: `make test-e2e` was red before the plan (7 failures in `test_abuse_bracket.py`, since 8850b6ff made `abuse.sh` read the login pair from an environment the session fixture scrubs); fixed as a54f694e, owner decision.

## Open items

- The seven required CI jobs (`check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos`, `smoke-windows`) have not run on e2ccb49f; ROADMAP criterion 4 needs the owner to push `dev` and read the run.
- `windows-11-arm` `smoke-windows` legs need reading on the next run after f3fe8c95; a stand-in answering 401 during step 3 may change what the app sees at startup.
- Plan 4: `test_status_metadata_kept.py` and `test_log_tail_fields.py` could not exist under `tests/api` (30-file cap); their cases are in `tests/api/test_api_health.py`.
- Plan 4: the log-path case builds its own 8088 handler instead of adding a `log_file` row to `tests/support/fake_http.py`, which was outside the lease.
- Plan 4: the export also withholds a file named as the configured `connection_file` when that name is not `connection.json`.
- Plan 3: `decide` compares `Origin`'s host and port with `Host` and ignores scheme.
- Plan 3: no e2e case clicks the Matrix export (`blob:` download); that downloads are not governed by the CSP rests on reasoning only.
- Plan 3: 404 responses from the SPA mount carry `nosniff` and the CSP but no `Cache-Control`.
- Plan 3: the `.js`/`.css` type pin has no red test.
- Plan 2: 1f585b05 adds no CHANGELOG line; owner to say whether one is wanted.
- Plan 2: a login refused with a code other than the three mapped ones still rethrows from `submitConnection`.
- Plan 2: `apilogin.py`'s refused-login path (a 401 from the app) is not exercised; `abuse.sh close` and an `eqstage` stage POST were not run against a real daemon.
- Plan 1: the e2e run needs `HQPTUNER_CHROMIUM` set; `make test-e2e` alone fails every browser test on this host.

## Goal check

The sum of the commits plausibly delivers the goal: `.planning/security/DISPOSITIONS.md` holds one entry for each of the 9 findings (headings at lines 5, 11, 17, 23, 29, 35, 40, 46, 52), and plan 4's report states every named commit resolves with `git cat-file -e` and both owner rulings are verbatim. The fixing work is on `dev` in 29 phase commits: the gate and login (a666a057, d2d55a38), the cross-site refusal (f15feb97), page headers and docs routes off (dfd5eb54, c4967603), the field cuts (2b163fd3, e046dafa, 2e9fd4bd) and the export (6f040843). All four plan-level `risk_surface` reviews were adjudicated, and plans 3 and 4 raised 0 findings. `scripts/gate.sh make check` printed `exit=0` and `make test-e2e` passed 106 after plan 3 (plan 3 report). Missing: ROADMAP criterion 4, the seven CI jobs on the phase's last commit, has not run, and the `windows-11-arm` smoke legs after f3fe8c95 are unread.

complete locally, not CI-verified
