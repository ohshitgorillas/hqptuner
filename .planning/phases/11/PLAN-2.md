---
phase: 11
plan: 2
# Phase 11 maps no requirement ID (ROADMAP: "Requirements: None"); this plan fixes F-044's url and redirect clauses (CONTEXT AC2).
requirements: []
files:
  - scripts/eqstage/eqstage.js
  - scripts/eqstage/post.js
  - scripts/eqstage/rows.js
  - scripts/eqstage/README.md
  - tests/js/eqstage/eqstage-url.test.js
  - tests/js/eqstage/eqstage-redirect.test.js
---

# Phase 11: Agent tooling and repo guards - Plan 2: eqstage stays on loopback and follows no redirect

## Goal

Findings F-043, F-044, F-045, F-046, F-047 and F-048 are each fixed or carry an owner decision. This plan fixes F-044's tree half: eqstage talks only to a loopback HQPTuner and never follows a redirect.

## Must be true when done

- A job whose `url` is not `http` on host `127.0.0.1`, `localhost` or `[::1]` makes eqstage stop with a non-zero exit before any request, the login POST included; any port on those three hosts is accepted (D-07, AC2).
- Every eqstage request (the baseline GETs, the stage POST, the pending GET, the login POST) refuses a redirect: a 307 from the server fails the run and the redirect target receives nothing (D-14, AC2).
- Both behaviors have tests that fail by assertion against the pre-fix eqstage (AC2).
- The EQ Assistant agent text is untouched (D-06).

## Context

- Locked: D-06 (fix `url` only; `docs/eq-assistant/agent/eq-assistant.md` is not touched and no write-path hook is added), D-07 (loopback allowlist, any port, checked before the login POST), D-14 (`redirect: 'error'` on every `fetch`, not `'manual'`; the cookie wrapper in `loggedInFetch` passes the caller's option through).
- The job `url` becomes the base through `baseOf` in `eqstage.js`; `main` hands that base to `loggedInFetch` before `runJob` runs. The requests are `getJson` in `rows.js`, and `postStage`, `verifyPending` and `loggedInFetch` in `post.js`.
- Tests follow `tests/js/eqstage/eqstage.test.js` (wire fake on the real REST paths, one assertion per test, `node --test` via `npm test`); `docs/testing.md` Frontend section binds them.
- Out of scope: `scripts/eqtools_mcp.py`, the `eqlab` submodule, and any `CHANGELOG.md` entry (D-09).

## Tasks

### Task 1: eqstage refuses a non-loopback job url before its first request

- **Files:** scripts/eqstage/eqstage.js, scripts/eqstage/post.js, scripts/eqstage/README.md, tests/js/eqstage/eqstage-url.test.js
- **Reads:** scripts/eqstage/eqstage.js#baseOf, scripts/eqstage/eqstage.js#main, scripts/eqstage/eqstage.js#runJob, scripts/eqstage/post.js#loggedInFetch, tests/js/eqstage/eqstage.test.js#gatedWire
- **Decisions:** D-07, D-06
- **Pins:** tests/js/eqstage/eqstage.test.js
- **Action:** Write the tests first and run them red against the current code. Then make the job's base URL pass a check before anything uses it: parsed as a URL, its scheme is `http` and its host is exactly `127.0.0.1`, `localhost` or `[::1]`, with any port; anything else, an unparsable url included, rejects with an error naming the url, so `main` exits 1 and neither `loggedInFetch` nor `runJob` sends a request. Place the check where the job's url becomes the base, so the CLI's login and an imported `runJob` both pass through it; the placement is your choice, and the Verify is the authority. `DEFAULT_URL` stays `http://127.0.0.1:8090`. Add one line to the `url` part of `scripts/eqstage/README.md` saying which schemes and hosts a job may name. Do not touch `docs/eq-assistant/agent/eq-assistant.md` (D-06).
- **Verify:** Testing scope: the outcomes are refusal with no request for a bad url and an unchanged run for an allowed one. The existing suite covers allowed runs on `http://127.0.0.1:8090` only. Add the smallest set: refusal with zero requests for a non-`http` scheme on an allowed host, for a host outside the three (another `127.x` address counts), and for an unparsable url; acceptance of `localhost` and `[::1]` on a port other than 8090. Stop there. The refusal tests fail by assertion against the pre-fix code (the wire fake records requests where it should record none); record that red run in the commit message. `scripts/gate.sh npm test` passes. With nothing listening on port 1, `printf '%s' '{"url":"https://127.0.0.1:1","eq":{"bands":[]}}' | HQPTUNER_HQP_USERNAME=x HQPTUNER_HQP_PASSWORD=y node scripts/eqstage/eqstage.js; echo "rc=$?"` prints an error naming the url's scheme or host and `rc=1`, and no `login at ... failed` line. `scripts/gate.sh make check` exits 0.

### Task 2: Every eqstage request fails on a redirect instead of following it

- **Files:** scripts/eqstage/rows.js, scripts/eqstage/post.js, tests/js/eqstage/eqstage-redirect.test.js
- **Reads:** scripts/eqstage/rows.js#getJson, scripts/eqstage/rows.js#readBaseline, scripts/eqstage/post.js#postStage, scripts/eqstage/post.js#verifyPending, scripts/eqstage/post.js#loggedInFetch
- **Decisions:** D-14
- **Pins:** tests/js/eqstage/eqstage.test.js
- **Action:** Write the tests first and run them red against the current code. Then set `redirect: 'error'` on every `fetch` call eqstage makes: `getJson` in `rows.js`, and `postStage`, `verifyPending` and the login POST in `loggedInFetch` in `post.js`. Keep the cookie wrapper `loggedInFetch` returns passing the caller's init through, `redirect` included (D-14). Use `'error'`, never `'manual'` (D-14). `readBaseline` already falls back from `/api/config` to `/api/matrix` on any failure; leave that fallback as it is, so a redirect on `/api/config` makes the run read `/api/matrix` without following.
- **Verify:** Testing scope: the outcome is that a 307 at any of the four request sites fails that request and the redirect target receives no request. Nothing covers it today. Add one case per request site; the stage POST and the login POST matter most, since they carry the payload and the credentials. The property must be observed through redirect behavior, not by checking that an option is present. Use either Node's own `fetch` against a server the test starts on an ephemeral loopback port, or a wire fake of `fetch` that answers each redirect mode from a table. Read `docs/testing.md` before choosing, and use no fixed port (rule 16). Stop there. Each case fails by assertion against the pre-fix code, where the target receives the redirected request; record that red run in the commit message. `scripts/gate.sh npm test` passes. `grep -n "fetchImpl(" scripts/eqstage/rows.js scripts/eqstage/post.js` lists only calls whose init carries `redirect: "error"` (the cookie wrapper's call passes its caller's init). `scripts/gate.sh make check` exits 0.

## Notes

- Plan shape: CONTEXT names eqstage as its own slice.
- CONTEXT flags as unverified whether Node 22's `fetch` drops a manually set `Cookie` header on a cross-origin redirect. With `redirect: 'error'` eqstage no longer follows, so the F-044 entry in Plan 6 states that the chain is closed by the refusal and that the Cookie behavior was not tested, unless Task 2's tests show it.
