PLAN CHECKPOINT: human-verify

Plan: .planning/phases/4/PLAN-2.md

Tasks: 4 of 7

| Task | Commit | Note |
|---|---|---|
| 1 | 49ac1d74 | `loggedOut` signal and `onLoginRequired` hook (api.js `failure`, 401 + `login_required`); `api.login`; `submitConnection` logs in while logged out (blank password always sent, host only if typed, reload on 200); verdict `not-answered` added; sync.js fast tick returns after health and the config tick skips while logged out; app.js meter feed opens only when logged in. 15 cases appended to tests/js/store/setup.test.js. `scripts/gate.sh make check` exit=0. |
| 2 | 23244ee9 | App renders only `Setup` while logged out; Setup hides Close, Detect, Connect; `not-answered` verdict sentence verbatim; `closeSetup` no-op while logged out; CHANGELOG `### Security` entry verbatim. `make check` exit=0. |
| 3 | a48f8ad5 | tests/e2e/test_login.py, 6 browser cases. `make test-e2e` 101 passed; `make check` exit=0. |
| 4 | 3c55fdb0 | `scripts/ci/daemon_standin.py` (git mv from scripts/, per the checkpoint ruling; docstring, lifecycle.sh comment and both release.yml calls point at the new path), `packaging/linux/lifecycle.sh` logs in after step 1 and again after the reinstall (session login, cookie jar under a temp dir removed on exit), `release.yml` starts/stops the stand-in in `lifecycle-deb` and `lifecycle-rpm` (`--network host` on the Alma container). Checked by hand from the new path on an ephemeral port: no credentials 401 with `WWW-Authenticate: Digest`, `curl --digest -u u:p` 200, stopped by PID, `ps -p` gone. `bash -n` and `shellcheck -S warning` exit 0. `make check` exit=0; lease-check ok. Amended once before any further work: the first commit staged the stand-in before the docstring path was fixed. |
| 4b (checkpoint item 3) | 1f585b05 | The login screen shows the `login_values_pinned` refusal: new verdict member `pinned` and exported signal `loginSentence` (setup.js); `logIn` maps the code and keeps the backend's sentence (`ApiFailure.message`) verbatim; `report()` in Setup.js renders it for that verdict. No new copy. Tests first (red: import of `loginSentence` failed on pre-change code): store cases (pinned sets the verdict, carries the wire's sentence unchanged, leaves the page logged out) and one rendered case. `make check` exit=0. |

Deviations:
- [deviation] Task 3 Verify expects the meter feed's request "answered 200 with events"; observed 204 and no events. `config.ADVISOR_ENABLED = False` in every build, so `manager.metering` is None and `/api/meter/feed` answers 204. The case asserts 200 or 204 (the refusal it catches is 401). Making the feed carry events needs the advisor on, which is not this plan's to change.
- [deviation] Plan 1's `login_values_pinned` refusal (d2d55a38) was rethrown by `submitConnection` with no verdict, so its sentence never reached the login screen. Plan 2 Task 1's two-code mapping (`login_refused`, `login_not_answered`) did not cover it. Owner-directed at the Task 4 checkpoint: added the `pinned` verdict and `loginSentence` signal (commit 1f585b05). Not in the plan's task list; inside the lease (setup.js, Setup.js and their tests are listed).

Open items:
- Task 1: the new cases live in tests/js/store/setup.test.js, not tests/js/store/login.test.js: tests/js/store is at the filepawl cap of 30 files.
- A login refused with a code other than the three mapped ones (a network failure, for example) still rethrows from `submitConnection`, as `saveConnection` failures do today.
- Task 2: Escape and a scrim click are covered at the store lane (`closeSetup`); SSR cannot fire the document keydown or the scrim click.
- 1f585b05 adds no CHANGELOG line: the user-facing text it shows is the server's already-approved sentence, and a changelog entry needs owner-approved wording. Owner to say whether one is wanted.
- Task 6 helper `scripts/ci/apilogin.py` is not yet written; `fuzz.py` loads its siblings from `scripts/fuzz/`, which bounds what it can import. If it cannot import the helper, that is reported, not worked around.
- The Task 4 required jobs (`lifecycle-deb`, `lifecycle-rpm`, both architectures) have not run; they are CI-only and human-verify.
