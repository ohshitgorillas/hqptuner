# Phase 4: API exposure and authentication - Context

Gathered: 2026-11-07

Feeds: /cad-plan 4

## Scope boundary

In: dispositions for findings F-001, F-002, F-003, F-008, F-009, F-024, F-025, F-027 and F-028 of the security review of v1.20.1 (reviewed commit `a942cfca`); a per-browser login on every `/api` route except `/api/health`, through the existing Connection panel; refusal of cross-site state-changing requests; removal of the exposed license, metadata, log-path and export-credential fields; anti-framing and nosniff headers and a content policy; the FastAPI docs routes turned off; every test, smoke, lifecycle and dev script that calls the API updated to log in; the review tracked at `.planning/security/REPORT.md` and dispositions at `.planning/security/DISPOSITIONS.md`; owner-approved login copy, error copy and `CHANGELOG.md` entry.

Out: TLS or an HTTPS proxy (F-024 declined); the single-instance probe (F-028 declined); a Host allowlist; changing the packaged `0.0.0.0` bind, the `HKCU\Environment` write or `/LAUNCH`; re-editing `README.md:192` and `README.md:204`; findings owned by phases 5 to 9 (F-004 Digest to a caller-named host and F-023 plaintext `connection.json` are phase 5).

Deferred: None

Plan shape: multiple plans, same phase (/cad-plan splits it; for example the login gate and its callers first, then cross-site checks and headers, then field stripping and dispositions)

## Durable decisions

- D-01 (Login): every browser, the one on HQPTuner's own computer included, logs in with the HQPlayer management username and password through the existing Connection panel, checked against hqplayerd. A correct pair logs in that browser only. "Save password" keeps that browser logged in across restarts, and "log in every time" ends its login when the browser session closes. A browser that has not logged in gets only the login screen, and the server uses its saved pair only for browsers that are logged in. Rejected: a per-install secret link, a separate HQPTuner password, exempting loopback. Today the record is one per app and the in-process pair serves every caller. Evidence: `hqptuner/core/connection.py:7`, `hqptuner/api/routes/connection.py:31-32`, `hqptuner/static/store/setup.js:250-275`, `/tmp/secreview/REPORT.md` F-001.
- D-02 (Bind): packaged builds stay reachable from other devices on `0.0.0.0`, and the code default stays `127.0.0.1`, keeping phase 2 D-01. Rejected: a loopback default with an opt-in network setting, and a desktop-only loopback default. Evidence: `hqptuner/config.py:127`, `Dockerfile:25`, `packaging/linux/hqptuner.service:13`, `packaging/windows/hqptuner.iss:15,53,91`, `hqptuner.spec:115`, `.planning/PROJECT.md:71`.
- D-03 (F-003): DNS rebinding is closed by the login with no loopback exemption, since a rebound origin holds no login cookie for HQPTuner. No Host allowlist is added, because a container cannot know the LAN address it is reached at. Rejected: `TrustedHostMiddleware` with a configured host list. Evidence: `Dockerfile:14-17`, `compose.yaml:21-24`, `README.md:150,180`, `packaging/linux/deb/postinst`.

## Decisions

- D-04 (Gate placement): one app-level gate in `create_app` covers every `/api` route, so a route added later is gated by default; `/api/health` stays open for the desktop single-instance probe, the Docker HEALTHCHECK and the smoke checks, with the body D-08 leaves. Evidence: `hqptuner/api/factory.py:65-103`, `hqptuner/api/spa.py`, `hqptuner/desktop.py:161-173`, `Dockerfile:33-34`.
- D-05 (Login carrier): the login rides a cookie, because the meter feed (`EventSource`) and the backup and state-export download links cannot send a custom header. Evidence: `hqptuner/static/store/meter/feed.js:47`, `hqptuner/static/components/system/SystemHardware.js:352`, `hqptuner/static/components/tabs/SystemTab.js:210`, `hqptuner/static/lib/api.js:149-190`.
- D-06 (F-002): the login cookie is not sent on cross-site requests, and a state-changing request whose `Origin` or `Sec-Fetch-Site` is not HQPTuner's own is refused; `upload()` keeps sending no `Content-Type` of its own. Evidence: `hqptuner/static/lib/api.js:167-190`, `tests/js/lib/api.test.js:82-87`, `/tmp/secreview/REPORT.md` F-002.
- D-07 (F-008): `/api/backup` and `/api/state-export` sit behind the login, and the export strips any `connection.json` found in the directories it copies, in the `presets` layer. Evidence: `hqptuner/presets/store/export.py:31-96`, `hqptuner/api/routes/config.py:242-277`.
- D-08 (F-025): `/api/health` drops license `name` and `fingerprint`, `/api/status` drops metadata the UI does not read (`uri` among it), and `/api/log` drops `path`, filtered at the API response so `engine/trackcontext.py` keeps the full reading. The SPA reads only `license.valid`, the metadata keys `samplerate`, `bits`, `sdm`, `filters`, `shapers`, `song`, and the log `lines`. Evidence: `hqptuner/api/routes/status.py:28-92,181-194`, `hqptuner/static/components/tabs/SystemTab.js:38-50`, `hqptuner/static/components/SignalPath.js:262`, `hqptuner/static/store/logtail.js:20-21`, `hqptuner/engine/trackcontext.py:48`.
- D-09 (F-009): fixed, naming `fc9803f5` and `307c3e41` (phase 2 README corrections at `README.md:192,204`) plus D-01; the `HKCU\Environment` write stays. Evidence: `README.md:192,204,238`, `packaging/windows/hqptuner.iss:53`.
- D-10 (F-024): declined. Owner ruling, quoted: "asinine".
- D-11 (F-027): page responses carry `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` and a content policy that still allows the inline import map; `/docs`, `/redoc` and `/openapi.json` are off in every build, and `docs/openapi.json` stays the API reference. Evidence: `hqptuner/api/factory.py:65`, `hqptuner/api/spa.py:20-24`, `hqptuner/static/index.html:50-58`, `scripts/gates/check_openapi.py:42-60`.
- D-12 (F-028): declined: exploiting it requires code already running on the machine. Owner's response on hearing the finding, quoted: "why the fuck would it ever do that"; the decline was confirmed in the D-01 to D-15 lock.
- D-13 (Callers): every test and script that calls the API logs in first or uses only `/api/health`: the `tests/api` app fixture, `tests/e2e/support/stack.py`, `tests/e2e/conftest.py`, `tests/e2e/test_abuse_bracket.py`, `packaging/linux/smoke.sh`, `packaging/linux/lifecycle.sh` (favorites calls), `packaging/macos/smoke.sh`, `packaging/windows/smoke.sh` (`/api/discover`), `scripts/abuse.sh`, `scripts/fuzz/fuzz.py`, `scripts/eqstage/post.js`, `scripts/authority.py`, `scripts/sweep.py`. Evidence: those files.
- D-14 (Record): the review is tracked at `.planning/security/REPORT.md`, copied from `/tmp/secreview/REPORT.md`, and each finding's disposition goes in `.planning/security/DISPOSITIONS.md`, which phases 5 to 9 reuse.
- D-15 (User-facing text): the login screen text, error copy and the `CHANGELOG.md` `[Unreleased]` entry ship only in owner-approved wording. Evidence: `CLAUDE.md` copy rule.

## Acceptance criteria

- [ ] AC1: without a login cookie, every `/api` route except `/api/health` answers 401; with the cookie from a successful login, each answers as it does today
- [ ] AC2: a login with a wrong HQPlayer pair answers 401 and sets no cookie; a correct pair sets one; with "log in every time" the cookie carries no expiry, and with "save password" it does
- [ ] AC3: a logged-in state-changing request sent with another site's `Origin` or with `Sec-Fetch-Site: cross-site` is refused with 403
- [ ] AC4: `/api/health` carries no license `name` or `fingerprint`, `/api/status` metadata carries no `uri`, `/api/log` carries no `path`, and a state export holds no password from a `connection.json` placed under the preset or backup directory
- [ ] AC5: page responses carry `frame-ancestors 'none'` and `X-Content-Type-Options: nosniff`, `/docs`, `/redoc` and `/openapi.json` answer 404, and a logged-in browser loads the whole UI, including the meter feed and both downloads (ci: e2e)
- [ ] AC6: `.planning/security/DISPOSITIONS.md` lists all 9 findings, each naming its fixing commit or quoting the owner's ruling, and `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows` pass on the phase's last `dev` commit (ci: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos, smoke-windows)

## Flagged assumptions

- A daemon still on the stock pair, published in HQPlayer's docs, lets anyone log in - Confident; if wrong: none, this is the known gap left open by D-01.
- The review exists only in `/tmp/secreview/REPORT.md` until D-14's copy lands - Confident; if wrong: a reboot clears `/tmp` and the dispositions lose their source.
- Checking the typed pair against hqplayerd needs a Digest round trip to 8088 per login, and phase 5's F-004 and F-021 work on the same connection route - Likely; if wrong: the login and phase 5 collide in `hqptuner/api/routes/connection.py`.
- Whether `openapi_url=None` changes what `app.openapi()` renders for `scripts/gates/check_openapi.py` - Unclear (research); if wrong: D-11 reds the openapi snapshot gate.
- A content policy can allow the inline `<script type="importmap">` by hash - Likely (research); if wrong: the SPA renders blank.
- Browsers send a SameSite cookie on `EventSource` and `<a download>` over a plain-HTTP LAN origin - Likely (research); if wrong: the meter feed and the downloads answer 401.
- Whether the daemon's backup archive includes `hqplayerd-auth.xml` (the Digest HA1) is unconfirmed - Unclear; if wrong: D-07 misses a credential-bearing member.
