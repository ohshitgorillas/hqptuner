---
phase: 4
plan: 3
# Phase 4 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against the findings in its goal, the Success Criteria and CONTEXT AC1-AC6.
requirements: []
files:
  - .filepawl.toml
  - hqptuner/api/crosssite.py
  - hqptuner/api/factory.py
  - hqptuner/api/errors.py
  - hqptuner/api/spa.py
  - docs/architecture.md
  - tests/api/surface/test_cross_site_refused.py
  - tests/api/surface/test_page_headers.py
  - tests/api/surface/test_docs_routes_off.py
  - tests/api/surface/__init__.py
  - tests/e2e/test_abuse_bracket.py
  - tests/e2e/test_content_policy.py
---

# Phase 4: API exposure and authentication - Plan 3: Cross-site requests, framing and the docs pages

## Goal

Findings F-001, F-002, F-003, F-008, F-009, F-024, F-025, F-027 and F-028 are each fixed or carry an owner ruling. This plan fixes the rest of F-002 (D-06: a state-changing request from another site is refused) and F-027 (D-11: anti-framing, nosniff and a content policy on the page, and no FastAPI docs pages).

## Must be true when done

- A logged-in state-changing request sent with another site's `Origin`, or with `Sec-Fetch-Site: cross-site`, is refused with 403 and its own code; the SPA's own writes, and scripts that send neither header, still pass (AC3, D-06).
- Every response from the SPA mount carries a `Content-Security-Policy` with `frame-ancestors 'none'` and `X-Content-Type-Options: nosniff`, and the page still loads, its inline import map allowed by hash, with no content-policy violation in the browser (AC5, D-11).
- `/docs`, `/redoc` and `/openapi.json` answer 404, and `docs/openapi.json` and its gate are unchanged (AC5, D-11).
- `scripts/gate.sh make check` prints `exit=0` and `make test-e2e` passes on this plan's last commit.

## Context

- Builds on Plans 1 and 2: the gate (`hqptuner/api/gate.py`) and the login cookie, already `SameSite=Strict`, which is the cookie half of D-06; this plan adds the header half.
- Read in this tree: `hqptuner/api/factory.py` builds `FastAPI(title="HQPTuner", lifespan=...)` with FastAPI's default docs routes; `hqptuner/api/spa.py` `NoCacheStaticFiles.get_response` already stamps `Cache-Control` on every SPA response and `SpaMount` declines `/api`; `hqptuner/static/index.html` carries one inline `<script type="importmap">` and one `<script type="module" src="/app.js">`, a `data:` favicon and only same-origin stylesheets; no file under `hqptuner/static` uses `eval` or `new Function` (grep at planning).
- Checked at planning: FastAPI's `FastAPI.openapi()` builds the schema whatever `openapi_url` is, and only `FastAPI.setup()` reads `openapi_url` to add the route, so `scripts/gates/check_openapi.py`, which calls `app.openapi()`, keeps working with the route off (CONTEXT flagged assumption 4).
- Locked: D-06 (refuse a state-changing request whose `Origin` or `Sec-Fetch-Site` is not HQPTuner's own; `upload()` keeps sending no `Content-Type`), D-11 (page headers; docs routes off in every build; `docs/openapi.json` stays the API reference), D-03 (no Host allowlist, so the check compares a request with itself, never with a configured host list).

## Tasks

### Task 1: State-changing requests from another site are refused

- **Files:** hqptuner/api/crosssite.py, hqptuner/api/factory.py, hqptuner/api/errors.py, docs/architecture.md, tests/api/surface/test_cross_site_refused.py, .filepawl.toml
- **Action:** Install a second ASGI-level check in `create_app`, outside the gate so a cross-site request is refused whatever cookie it carries. It covers every POST, PUT, PATCH and DELETE to `/api` or under it, the login route included. It refuses with 403 and a new code when `Sec-Fetch-Site` is present and is neither `same-origin` nor `none`, so `same-site` and `cross-site` are both refused. It also refuses when `Origin` is present and is `null` or names a host and port other than the request's own `Host` header. A request that carries neither header (curl, the dev scripts, the packaged smokes) passes this check and still meets the gate. Comparing the request with its own `Host` needs no configured host list (D-03), and a DNS-rebound page passes it but holds no login cookie, which is what closes F-003 (D-03). GET and HEAD are not checked: none of them changes state. One function returns the decision and the wrapper executes it (`docs/testing.md` rule 17). Add the code to `STATUS` and to the `docs/architecture.md` §8.1 table, and state the rule beside the gate's. The 403 `detail` ships only in the owner-approved wording from this plan's Notes; if that is not in hand, stop at that point and ask (D-15). Do not add a token header or change `upload()` in `hqptuner/static/lib/api.js`: it keeps sending no `Content-Type` of its own (D-06; `tests/js/lib/api.test.js` already pins it).
- **Verify:** Testing scope, REST lane, with a logged-in client: a POST, a PUT and a DELETE each refused with 403 and the new code when sent with `Origin: http://elsewhere.example`; the same for `Sec-Fetch-Site: cross-site`, for `Sec-Fetch-Site: same-site` and for `Origin: null`; not refused when `Origin` names the request's own host and port, when `Sec-Fetch-Site` is `same-origin`, or when neither header is sent; a GET with a foreign `Origin` not refused; a cross-site POST without a cookie refused with 403, not 401. The SPA's own writes are covered by `make test-e2e`, which must stay green. Bite: red against the commit before this one on every refusal case. `scripts/gate.sh make check` prints `exit=0`; `make test-e2e` passes (Chromium plus one app subprocess, disclosed before running).

### Task 2: The page cannot be framed, sniffed or fed a script it did not ship

- **Files:** hqptuner/api/spa.py, tests/api/surface/test_page_headers.py, tests/e2e/test_content_policy.py
- **Action:** Every response the SPA mount serves (`NoCacheStaticFiles.get_response`, beside its `Cache-Control` stamp) carries `X-Content-Type-Options: nosniff` and a `Content-Security-Policy` that includes `frame-ancestors 'none'`, allows scripts from the page's own origin plus the inline import map by its SHA-256 hash, and allows what the SPA actually loads and nothing more: its own stylesheets, fonts and modules, the `data:` favicon, `fetch` and `EventSource` to its own origin. Compute the import map's hash from the `index.html` the mount serves, when the mount is built, from the exact bytes between the `<script type="importmap">` tags, so an edit to the import map cannot silently blank the page (CONTEXT flagged assumption 5). Before writing the policy, list every load under `hqptuner/static` (outside `vendor/` too) that a policy governs: `data:` and `blob:` URLs, inline handlers, `<style>` elements, `style` attributes set from markup, workers. Then make the policy allow each one, and record the list in the executor report. Preact sets `style` through the CSSOM, which a policy does not block. `nosniff` makes a browser refuse a stylesheet served with a non-CSS type, and Starlette takes types from `mimetypes`, which on Windows reads the registry; check the type the mount serves for each extension under `hqptuner/static` and pin the ones that matter if any could come out wrong. Headers go on the SPA mount, not on the API's JSON, which is what D-11 names.
- **Verify:** Testing scope: at the REST lane, `GET /` and one static asset each carry `nosniff` and a policy containing `frame-ancestors 'none'`, and the policy names the SHA-256 of the import map as the test reads it from the served `index.html` (wire data, rule 9). In the browser, the lowest lane where a policy is enforced: a logged-in page loads the app and visits every tab with no `securitypolicyviolation` event raised. Bite: both red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`; `make test-e2e` passes.

### Task 3: FastAPI's docs pages are off in every build

- **Files:** hqptuner/api/factory.py, tests/api/surface/test_docs_routes_off.py
- **Action:** Build the app with `docs_url`, `redoc_url` and `openapi_url` all off, in every build (D-11), which also removes the Swagger OAuth redirect page that hangs off `docs_url`. `/docs`, `/redoc` and `/openapi.json` are outside `/api`, so with their routes gone they fall to `SpaMount`, whose static server answers 404 for a file it does not have. `docs/openapi.json` stays the API reference, rendered by `scripts/gates/check_openapi.py` from `app.openapi()`, which does not read `openapi_url` (Context).
- **Verify:** Testing scope, REST lane: `/docs`, `/redoc` and `/openapi.json` each answer 404. Bite: red against the commit before this one. `scripts/gate.sh .venv/bin/python scripts/gates/check_openapi.py` prints `exit=0` and `git diff --exit-code docs/openapi.json` exits 0. `scripts/gate.sh make check` prints `exit=0`.

## Notes

- **Copy (D-15, owner-approved).** Cross-site refusal (`detail`, 403): "HQPTuner refused a change sent from another website."
- A reverse proxy that rewrites `Host` without rewriting `Origin` would have its browser's writes refused by Task 1. Nothing in the repo ships such a proxy (F-024 declined TLS), so no allowance is planned.
