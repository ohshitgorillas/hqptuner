PLAN COMPLETE

Plan: .planning/phases/4/PLAN-3.md

Tasks: 3 of 3

| Task | Commit | Note |
|---|---|---|
| fix | a54f694e | e2e regression fix, owner decision 2: `_abuse()` in `tests/e2e/test_abuse_bracket.py` passes `APP_PAIR` as `HQPTUNER_HQP_USERNAME`/`HQPTUNER_HQP_PASSWORD`. `test_abuse_bracket.py`: 7 passed (were 7 failing). |
| 1 | f15feb97 | `hqptuner/api/crosssite.py` (`decide` + `CrossSiteGuard`, code `cross_site_refused`, 403), `errors.py` STATUS row, `factory.py` (guard outermost, after `LoginGate`), `docs/architecture.md` §8.1 row and rule, `tests/api/surface/test_cross_site_refused.py` + `__init__.py` (moved from `tests/api/`, owner decision 1). Bite: 21 of 32 red without the factory line, 32 green with it. `make check` exit=0. |
| 2 | dfd5eb54 | `hqptuner/api/spa.py`: `page_policy()` builds the CSP from the served `index.html` (SHA-256 of the exact import-map text, CRLF normalised), `NoCacheStaticFiles` stamps `X-Content-Type-Options: nosniff` and the CSP on every response including 404 (via `HTTPException.headers`) and 304, and pins `.js`/`.css` types. `tests/api/surface/test_page_headers.py` (12 cases), `tests/e2e/test_content_policy.py` (5 cases). Bite: REST 11 of 12 red on the old `spa.py` (the "API JSON carries no page policy" guard is green both ways); browser: the inline-script-refused case red on old `spa.py`; with a corrupted hash the 4 tab cases and the refusal case go red (page blanks). `make check` exit=0. |
| 3 | c4967603 | `factory.py`: `docs_url=None, redoc_url=None, openapi_url=None`. `tests/api/surface/test_docs_routes_off.py` (`/docs`, `/redoc`, `/openapi.json`, `/docs/oauth2-redirect` each 404): 4 red before, 4 green after. `check_openapi.py` exit=0, `git diff --exit-code docs/openapi.json` exit 0. |

Policy load list (Task 2, everything under `hqptuner/static` a policy governs):
- Scripts: one `<script type="module" src="/app.js">` and ES module imports, all same origin (`script-src 'self'`); one inline `<script type="importmap">`, allowed by hash. No `eval`, `new Function`, `javascript:` URL, inline handler, worker or `importScripts` outside `vendor/eqlab/tests` (not served to the page); `vendor/eqlab/src/expr.js` mentions `new Function` only in a comment saying it avoids it; `vendor/eqlab/src/plot.js` holds a `<style>` in an SVG string, but the SPA imports only `vendor/eqlab/core/*` and `lib`, never `src/plot.js`.
- Styles: 36 same-origin `<link rel="stylesheet">` (`style-src 'self'`); no `<style>` element, no `@import`. Inline `style=` in `htm` templates (EngineHealth, SystemHardware, Combobox, ApodStrip) reach the DOM through Preact's `style.cssText` / `style[prop]`, which is CSSOM and not governed; the browser run confirms no violation.
- Fonts: 6 same-origin `woff2` via `@font-face` (`font-src 'self'`).
- Images: `data:` SVG favicon in `index.html` and in `store/ui/favicon.js`, and `data:` SVG `mask-image`/custom properties in `css/features/volume.css` (`img-src 'self' data:`). No `<img>`; the spectrogram is a `<canvas>`.
- Network: `fetch` and `EventSource` to the page's own origin (`connect-src 'self'`). No WebSocket.
- `blob:`: `components/matrix/FlowRow.js` `downloadText` builds a `blob:` URL for an `<a download>` click. That is a download navigation, which fetch directives do not govern, so no `blob:` source is allowed; no `securitypolicyviolation` was observed on any tab, but no e2e case clicks that export.
- Other: external links (`target=_blank`) are navigations; no `<form>`, `<iframe>`, `<object>`, `<embed>`, media, `<base>`, manifest or service worker. Policy therefore sets `default-src 'none'`, `base-uri 'none'`, `form-action 'none'`.

Served types (Task 2): Starlette on this host gives `text/javascript` for `.js`, `text/css` for `.css`, `font/woff2`, `text/html`, and `application/json` for `.gz`. `.js` and `.css` are pinned in `NoCacheStaticFiles` because `nosniff` makes a browser refuse them under any other type and Windows `mimetypes` reads the registry. The pin has no red test: reaching it needs a patched registry, and the `filepawl` gate refuses a patch. Its test holds the served types and is green with or without the pin.

Deviations:
- [deviation] Plan put test files flat in `tests/api/` (30-file filepawl dircount cap). Resolved by owner: `tests/api/surface/`; lease amended.
- [deviation] `make test-e2e` was not green before this plan (7 failures in `test_abuse_bracket.py`). Resolved by owner decision 2 as its own commit a54f694e, landed before Task 1.

Suite: `scripts/gate.sh make check` exit=0; `make test-e2e` 106 passed (one run each, after the last commit).

Open items:
- Lean choice: `decide` compares `Origin`'s host and port with `Host` and ignores scheme, per D-03/D-06 wording; no scheme allowance built.
- No e2e case exercises the Matrix export (`downloadText`, `blob:` download); the reasoning above is the only support for "downloads are not governed".
- 404 responses from the mount now carry `nosniff` and the CSP but not `Cache-Control`, which was never stamped on them.
