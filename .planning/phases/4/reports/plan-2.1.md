PLAN CHECKPOINT: structural

Plan: .planning/phases/4/PLAN-2.md

Tasks: 3 of 7

| Task | Commit | Note |
|---|---|---|
| 1 | 49ac1d74 | `loggedOut` signal and `onLoginRequired` hook (api.js `failure`, 401 + `login_required`); `api.login`; `submitConnection` logs in while logged out (blank password always sent, host only if typed, reload on 200); verdict `not-answered` added; sync.js fast tick returns after health and the config tick skips while logged out; app.js meter feed opens only when logged in. 15 cases appended to tests/js/store/setup.test.js. Bite: red runs by mutation (sync gate removed, api hook removed, 401-any-code, logged-out login path off) fail the matching cases. `scripts/gate.sh make check` exit=0. |
| 2 | 23244ee9 | App renders only `Setup` while logged out; Setup hides Close, Detect, Connect (data-testids added: setup-close, setup-detect, setup-connect, setup-panel, app); `not-answered` verdict sentence "HQPlayer did not answer." verbatim; `closeSetup` is a no-op while logged out (Escape and scrim click both call it); CHANGELOG `### Security` entry verbatim. Radio labels untouched (diff checked). Bite: mutation of the logged-out branches fails the logged-out cases; the logged-in "has" cases are red against the previous commit (testids absent). `check_changelog.py` and `make check` exit=0. |
| 3 | a48f8ad5 | tests/e2e/test_login.py: 6 browser cases (logged-out panel only; login through the panel then a gated `fetch` answers 200; logged-in load with no gated 401; feed request answered; backup and state-export links deliver a zip). Setup.js gains data-testid on the three rows and Save (Task 2's file). Bite: against d2d55a38 (Plan 1's last commit, in a throwaway worktree, removed after) the logged-out case times out waiting for the panel. `make test-e2e` 101 passed (HQPTUNER_CHROMIUM set); `make check` exit=0. |

Deviations:
- [deviation] Task 3 Verify expects the meter feed's request "answered 200 with events"; observed 204 and no events. `config.ADVISOR_ENABLED = False` in every build, so `manager.metering` is None and `/api/meter/feed` answers 204; the stack's metering socket also serves no frames. The case asserts the status is 200 or 204 (the refusal it catches is 401, and the cookie decides it); events are not asserted. Making the feed carry events needs the advisor on, which is not this plan's to change.

Open items:
- Task 1: the new cases live in tests/js/store/setup.test.js, not tests/js/store/login.test.js: tests/js/store is at the filepawl cap of 30 files, and a file at tests/js/store/setup/login.test.js is outside the lease (lease-check refused it).
- A login refused with a code other than login_refused or login_not_answered (for example login_values_pinned, or a network failure) rethrows from `submitConnection`, as `saveConnection` failures do today; no verdict member covers it (the plan names two).
- Task 2: Escape and a scrim click are covered at the store lane (`closeSetup` is what both call); SSR cannot fire the document keydown or the scrim click.
- Task 4 is built and NOT committed (staged: scripts/daemon_standin.py, packaging/linux/lifecycle.sh, .github/workflows/release.yml). The stand-in was checked by hand on an ephemeral port: no credentials 401 with `WWW-Authenticate: Digest`, `curl --digest -u u:p` 200, stopped by PID and confirmed with `ps -p`; `bash -n` and `shellcheck -S warning` on lifecycle.sh exit 0; `scripts/gate.sh make check` exit=0 while the new file was untracked. The commit's pre-commit `filepawl tree gate` fails once it is tracked: `scripts: 16 files, cap 15` (the .py files directly in scripts/ are at the cap). The lease names `scripts/daemon_standin.py`, and Task 6's optional `scripts/apilogin.py` would be a 17th. Re-homing needs a path outside the lease. CHECKPOINT: structural.
