---
phase: 4
plan: 2
# Phase 4 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against the findings in its goal, the Success Criteria and CONTEXT AC1-AC6.
requirements: []
files:
  - .filepawl.toml
  - hqptuner/static/lib/api.js
  - hqptuner/static/store/setup.js
  - hqptuner/static/store/sync.js
  - hqptuner/static/app.js
  - hqptuner/static/components/Setup.js
  - hqptuner/static/components/App.js
  - tests/js/lib/api.test.js
  - tests/js/store/setup.test.js
  - tests/js/store/setup-verdict.test.js
  - tests/js/store/login.test.js
  - tests/js/components/chrome/setup.test.js
  - tests/js/components/chrome/app.test.js
  - CHANGELOG.md
  - tests/e2e/test_login.py
  - scripts/daemon_standin.py
  - packaging/linux/lifecycle.sh
  - .github/workflows/release.yml
  - packaging/windows/smoke.sh
  - scripts/apilogin.py
  - scripts/fuzz/fuzz.py
  - scripts/authority.py
  - scripts/sweep.py
  - tests/test_fuzz.py
  - scripts/abuse.sh
  - scripts/eqstage/post.js
  - scripts/eqstage/eqstage.js
  - scripts/eqstage/README.md
  - tests/js/eqstage/eqstage.test.js
---

# Phase 4: API exposure and authentication - Plan 2: The login screen and every remaining caller

## Goal

Findings F-001, F-002, F-003, F-008, F-009, F-024, F-025, F-027 and F-028 are each fixed or carry an owner ruling. This plan finishes D-01 in the browser (a browser that has not logged in gets only the login screen, through the existing Connection panel) and logs in every remaining caller D-13 names, so the packaged smokes and the dev scripts keep working behind Plan 1's gate.

## Must be true when done

- A browser that has not logged in sees only the Connection panel, which it cannot close, and no page behind it; logging in through the panel with the right pair loads the whole UI, and a wrong pair shows the panel's existing "refused" verdict (D-01).
- A logged-in browser loads the whole UI, including the meter feed and both downloads, over plain HTTP (AC5, the browser half; `e2e`).
- `lifecycle-deb`, `lifecycle-rpm` and `smoke-windows` log in before their gated calls and pass; the favorite-on-disk check still proves the favorite and not the login (D-13).
- `scripts/abuse.sh`, `scripts/fuzz/fuzz.py`, `scripts/eqstage/post.js`, `scripts/authority.py` and `scripts/sweep.py` log in with the `hqpcreds` pair before their first gated request, and stop with a login failure when the login is refused or unanswered (D-13).
- `scripts/gate.sh make check` prints `exit=0` and `make test-e2e` passes on this plan's last commit.

## Context

- Builds on Plan 1: the login route (any host the login names is checked against that host; no host rule, owner ruling in Plan 1 Notes), the cookie, the gate and its 401 code. The routes `GET /api/connection` and `GET /api/discover` sit behind the gate, so the panel's Detect and Connect cannot work before a login; Save can, through the login route.
- Read in this tree: `hqptuner/static/components/Setup.js` renders the panel (Close button, Escape and scrim click call `closeSetup`); `hqptuner/static/components/App.js` renders `.app` with `inert` while `setupOpen` is set, and `Setup` beside it; `hqptuner/static/store/setup.js` holds `form`, `verdict` (eight members, `data-verdict` on the panel), `submitConnection`, `openSetup`; `hqptuner/static/lib/api.js` `failure` builds an `ApiFailure` with `status` and `code`, `upload` sends no `Content-Type` of its own (keep it, D-06); `hqptuner/static/app.js` boots health, setup, the meter feed `effect` and `startPolling`.
- CI facts: `release.yml` `lifecycle-deb` runs `packaging/linux/lifecycle.sh` on the runner, `lifecycle-rpm` runs it inside an `almalinux/8-init` container started by `docker run` with no network flag; `smoke-windows` runs `packaging/windows/smoke.sh` in Git Bash with no Python set up, and that script already drives inline PowerShell. No hqplayerd exists in any of these jobs, so a login needs a stand-in that answers Digest on 8088. Installed packages dial `127.0.0.1` by default (`hqptuner/config.py` `hqp_host`), and the Windows installer sets only `HQPTUNER_LISTEN_HOST`. Recalled: smoke-windows' fresh-install steps answer `/api/health` from an empty LOCALAPPDATA (phases/2/UAT.md, phase 2); those steps stay as they are.
- The local caller harness, used by Tasks 6 and 7 on this host, where hqplayerd is live production: start `scripts/daemon_standin.py` (Task 4) on an ephemeral loopback port, and `.venv/bin/python -m hqptuner` on another, with `HQPTUNER_HQP_HOST=127.0.0.1`, `HQPTUNER_HQP_HTTP_PORT` at the stand-in, `HQPTUNER_HQP_CONTROL_PORT` and `HQPTUNER_HQP_METERING_PORT` at ports nothing listens on, `HQPTUNER_CONTAINER_HOST_ALIAS=127.0.0.254`, and every store variable `tests/conftest.py` `_REPO_PATH_ENVS` names pointed into a fresh temp directory, so nothing reaches the real daemon or the repo's `state/`. Record both PIDs, stop them by PID and confirm with `ps -p` (`~/dev/CLAUDE.md` 4.1).

## Tasks

### Task 1: The page knows when it is logged out, and Save logs it in

- **Files:** hqptuner/static/lib/api.js, hqptuner/static/store/setup.js, hqptuner/static/store/sync.js, hqptuner/static/app.js, tests/js/lib/api.test.js, tests/js/store/setup.test.js, tests/js/store/setup-verdict.test.js, tests/js/store/login.test.js
- **Action:** Give the page a logged-out state, entered whenever any request is refused with the gate's 401 code (Plan 1 Task 7), read from `ApiFailure.code`, never from the sentence (`docs/architecture.md` §8.1). Entering it opens the Connection panel. While logged out the page sends no gated request on a timer: the health poll stays, since `/api/health` is open and the panel's reachability readings come from it, and the gated polls and the meter feed wait until the page is logged in again, so a page sitting at the login screen does not draw a 401 every poll. Add the login to `api` in `hqptuner/static/lib/api.js`. While logged out, `submitConnection` sends the login instead of `saveConnection`: the username, the password (always sent, blank included, since the server checks a blank as blank, Plan 1 Task 4), `remember`, and the host only when the user typed one. A login answered 200 leaves the logged-out state and loads the page's data as a fresh page load would. The executor chooses how; a full reload is acceptable. A refusal maps onto `verdict`: the login-refused code to the existing `"refused"` member, the not-answered code to one new member, so the `data-verdict` attribute keeps naming the outcome for tests (rule 9). Logged in, every path behaves as today, `saveConnection` included. Keep `upload` sending no `Content-Type` of its own (D-06).
- **Verify:** Testing scope, store and lib lanes with the injected fetch the existing JS tests use (rule 15): a gated request answered 401 with the gate's code enters the logged-out state and opens the panel; a 401 without that code does not; while logged out the timed polls send no gated request; Save while logged out sends the login with the blank password included and no host unless typed, and never calls `saveConnection`; a 200 login leaves the logged-out state; each of the two refusal codes sets its `verdict` member; Save while logged in still calls `saveConnection` with today's body (the existing `submitConnection` tests stay green unchanged). Bite: red against the commit before this one on every case but the last. `scripts/gate.sh npm test` and `scripts/gate.sh make check` print `exit=0` (eslint, tsc `--checkJs`, knip and jscpd included).

### Task 2: The login screen is the Connection panel, and nothing else shows

- **Files:** hqptuner/static/components/Setup.js, hqptuner/static/components/App.js, tests/js/components/chrome/setup.test.js, tests/js/components/chrome/app.test.js, CHANGELOG.md, .filepawl.toml
- **Action:** While logged out, `App` renders the Connection panel and none of `.app` (D-01: "a browser that has not logged in gets only the login screen"; `inert` alone would still render the page's controls and data). The panel in that state cannot be closed: no Close button, and Escape and a scrim click do nothing, since there is nothing to close to. It hides Detect and Connect, whose routes are behind the gate, and keeps the host, username and password rows, the remember radios, the help text and Save. Logged in, the panel is exactly as today. The new `verdict` member from Task 1 renders, in `VERDICTS`, the approved sentence "HQPlayer did not answer." verbatim (`hqptuner/static/lib/api.js` `unexplained`, owner ruling e); the existing `"refused"` sentence is reused unchanged. The remember radios keep their labels exactly as they are ("Let HQPTuner store my password", "Ask every time HQPTuner starts"; owner ruling e). No other panel text changes. No new CSS: the state is a different render, not a hidden one. Land the `CHANGELOG.md` `[Unreleased]` entry in this commit, under a new `### Security` heading, in the approved wording from the Notes; if that approval is not in hand when this task runs, stop at that point and ask (D-15). This is the commit that completes what every user meets (`CLAUDE.md` changelog rule; `scripts/gates/check_changelog.py` checks its style).
- **Verify:** Testing scope, rendered-component lane: logged out, the app renders the panel and no `.app` element; the panel has no Close button, and Escape and a scrim click leave it open; Detect and Connect are absent; the new verdict renders under its `data-verdict` value; both remember radios are present in both states, and `git diff` of `hqptuner/static/components/Setup.js` changes neither radio label; logged in, Close, Detect and Connect are present as before. Assertions use state attributes and roles, never the sentences (rule 9). Bite: red against the commit before this one on the logged-out cases. `scripts/gate.sh npm test`, `scripts/gate.sh .venv/bin/python scripts/gates/check_changelog.py` and `scripts/gate.sh make check` print `exit=0`.

### Task 3: A browser logs in, and then the whole UI works over plain HTTP

- **Files:** tests/e2e/test_login.py
- **Action:** Add the browser checks for the outcomes only a browser can show (rule 15): whether it stores the cookie and sends it back on `fetch`, on `EventSource` and on a download link, over the plain-HTTP loopback origin the stack serves (CONTEXT flagged assumption 6). A fresh context with no login, opening the app, gets the panel and no tab bar; logging in through the panel with the stack's pair loads the app. A logged-in context loads the UI with no gated response answered 401, the meter feed's `EventSource` request answered 200 with events, and both the System tab's "Download backup" and "Download state" links delivering a zip archive rather than a refusal body. Find elements by `data-testid`, state attributes and wire paths (the two download links by their `href`, `/api/backup` and `/api/state-export`), not by copy (rule 9); a `data-testid` may be added only within Task 2's files. No sleeps (rule 7).
- **Verify:** Testing scope: two journeys, logged out then logging in, and logged in using the feed and both downloads; every other path is already in the e2e suite, which now runs logged in. Bite: the logged-out journey fails against Plan 1's last commit, where the page has no logged-out state. `make test-e2e` passes (Chromium plus one app subprocess, disclosed before running); `scripts/gate.sh make check` prints `exit=0`.

### Task 4: The Linux lifecycle jobs log in against a stand-in daemon

- **Files:** scripts/daemon_standin.py, packaging/linux/lifecycle.sh, .github/workflows/release.yml
- **Action:** Add a stdlib-only stand-in for hqplayerd's 8088 credential wire, for CI jobs that have no daemon: on a given host and port it answers a request with no `Authorization` header with 401 and a Digest challenge in the shape `tests/support/fake_http.py` `_DIGEST_CHALLENGE` uses, and any request carrying one with 200 and an empty body, on every path. That is all Plan 1's status-only pair check needs. It is a table, not an implementation of Digest (`docs/testing.md` rule 13 spirit), and it never verifies a digest, so it proves the callers log in, not that a pair is right. `lifecycle.sh` logs in once after step 1's health check, with the app's stock pair and without asking to stay logged in, keeps the cookie in a jar under a temp directory it removes on exit, and sends it on every gated call. It logs in again after the reinstall restarts the service in step 3, since a session login does not need to outlive a restart. A session login writes no file (Plan 1 Task 3), so step 2's disk check still proves the favorite landed. Keep it that way: never log in with "save password" here, which would write the record and the login secret into `/var/lib/hqptuner` and make that check pass on its own. In `release.yml`, `lifecycle-deb` starts the stand-in on `127.0.0.1:8088` before the lifecycle step and stops it after. `lifecycle-rpm` starts it on the runner the same way and gives the Alma container the runner's network (`--network host` on its `docker run`), so the app inside dials `127.0.0.1:8088` and reaches it. Running it inside `almalinux/8-init` instead would need a Python that image does not reliably carry. Add no third-party action (phase 8 owns the pinning of the ones there).
- **Verify:** Testing scope: the stand-in's two answers, checked by hand on this host on an ephemeral port (never 8088, which the production daemon holds): `curl -s -o /dev/null -w '%{http_code}'` without credentials prints 401 with a `WWW-Authenticate: Digest` header, and `curl --digest -u u:p` prints 200. Stop the stand-in by PID and confirm with `ps -p`. `bash -n` and `shellcheck -S warning` on `packaging/linux/lifecycle.sh` exit 0; `scripts/gate.sh make check` prints `exit=0` (ruff, black and mypy cover `scripts/`). Required jobs `lifecycle-deb` and `lifecycle-rpm`, human-verify after Task 5: the owner pushes `dev` and reads the run; both pass on both architectures. This script cannot run here: it refuses unless `GITHUB_ACTIONS=true` and installs packages.

### Task 5: smoke-windows logs in before it asks for discovery

- **Files:** packaging/windows/smoke.sh
- **Action:** Step 4's `GET /api/discover` is behind the gate. Before it, start a stand-in on `127.0.0.1:8088` with the same two answers as Task 4's, written in the inline PowerShell `smoke.sh` already uses (an `HttpListener`), because the `smoke-windows` job has no Python. Record its PID where `cleanup` stops it, so a death anywhere leaves no process behind. Log in to the app with its stock pair, without asking to stay logged in, and send the cookie on the discover request. Leave every other step, every health check and the bundle row's path as they are (recalled: phases/2/UAT.md, phase 2). The installed app dials `127.0.0.1` because the installer sets only `HQPTUNER_LISTEN_HOST`, so no host is named at login.
- **Verify:** Testing scope: one login before the one gated call this script makes. `bash -n packaging/windows/smoke.sh` and `shellcheck -S warning packaging/windows/smoke.sh` exit 0. Required jobs `smoke-windows`, `lifecycle-deb`, `lifecycle-rpm` and `e2e`, human-verify: the owner pushes `dev` after this task and reads the run; every row of each passes, step 4's discover answering 200. A failure is reported as found, with its failing line, and Task 6 does not start until the owner has seen it (`~/dev/CLAUDE.md` 6.3).

### Task 6: The Python dev scripts log in

- **Files:** scripts/apilogin.py, scripts/fuzz/fuzz.py, scripts/authority.py, scripts/sweep.py, tests/test_fuzz.py
- **Action:** `fuzz.py` (its `httpx.Client`), `authority.py` (`enum`'s `GET /api/enumerations`) and `sweep.py` (its Playwright browser) each log in before their first gated request, with the pair `hqpcreds` exports (`HQPTUNER_HQP_USERNAME`, `HQPTUNER_HQP_PASSWORD`; `sweep.py`'s docstring already sources it), without asking to stay logged in. Each stops with a message naming the refused or unanswered login, never carrying on into a stream of 401s. One shared helper in `scripts/` is allowed if two of the three can use it. `fuzz.py` loads its siblings from `scripts/fuzz/`, which bounds what it can import. `sweep.py` logs its browser context in before `page.goto`, so its screenshots are of the app and not of the login screen. Keep `tests/test_fuzz.py`'s cases as they are; add a case only for a login function `fuzz.py` gains.
- **Verify:** Testing scope: per script, one run against the local caller harness (Context) with the stand-in up, where the first gated request is answered with something other than 401 (a 503 `not_loaded` is expected with no control daemon), and one with the stand-in stopped, where the script stops naming the login. `sweep.py` runs with one `--tab` and the default viewport into a temp directory (it starts Chromium; disclose it first). `scripts/gate.sh make check` prints `exit=0`. Harness processes stopped by PID and confirmed gone with `ps -p`.

### Task 7: abuse.sh and eqstage log in

- **Files:** scripts/abuse.sh, scripts/eqstage/post.js, scripts/eqstage/eqstage.js, scripts/eqstage/README.md, tests/js/eqstage/eqstage.test.js
- **Action:** `abuse.sh` logs in once before `open`'s first gated read and `close`'s, with the `hqpcreds` pair, keeps the cookie in a jar under its scratch directory, removes the jar when it exits, and sends it with every `curl` (`get`, the DELETE, the restore upload, the refresh, the volume and matrix posts). It dies naming the login when the login is refused or unanswered. `post.js` gains the login. `eqstage.js` `main` logs in with the same pair from the environment and hands `runJob` a fetch that carries the cookie. `runJob`'s injected `fetch` stays the seam the JS tests use, so `readBaseline`, `postStage` and `verifyPending` change nowhere but in what they are handed. Document the two environment variables in `scripts/eqstage/README.md`.
- **Verify:** Testing scope: the eqstage login at the JS unit lane with an injected fetch: the login posts the pair, the next request carries the cookie it set, and a refused login rejects before any stage POST. Bite: red against the commit before this one. `abuse.sh`: `bash -n` and `shellcheck -S warning` exit 0, and `scripts/abuse.sh open` against the local caller harness passes the login and fails later at the state read with its own "daemon unreachable" message, never with a 401. `scripts/gate.sh npm test` and `scripts/gate.sh make check` print `exit=0`. Harness processes stopped by PID and confirmed gone.

## Notes

- **Copy (D-15; owner ruling e: approved copy is not changed, and is reused verbatim wherever it covers the case).** Searched `hqptuner/static`, the `hqptuner/api` refusal sentences and `docs/copy-before-after.md`. Reused, no approval needed: the "refused" verdict "HQPlayer refused that username and password." and, for the login that could not be checked, "HQPlayer did not answer." (`hqptuner/static/lib/api.js` `unexplained`). The panel's own `unreachable` and `no-answer` verdicts were not reused: both end "press Connect again", and the logged-out panel hides Connect (Task 2). The remember radio labels stay "Let HQPTuner store my password" and "Ask every time HQPTuner starts". Remaining proposal, needing owner approval before Task 2 runs (no em dashes): the `CHANGELOG.md` `[Unreleased]` entry under a new `### Security` heading, the case of telling users that every browser must now log in: "- **Every browser now logs in with HQPlayer's management username and password.** Until it does, it sees only the login screen." No existing string fits: the changelog entry announces a change that did not exist before, and no approved sentence describes it.
- The stand-ins accept any digest, so CI proves that callers log in and send the cookie, not that a pair is checked; the pair check is proved offline against `tests/support/fake_http.py` (Plan 1 Task 2).
- `scripts/abuse.sh` and `scripts/sweep.py` target the hand-back container, which this checkout does not have (`CLAUDE.local.md`); their local checks use the harness above, never `:8090`.
