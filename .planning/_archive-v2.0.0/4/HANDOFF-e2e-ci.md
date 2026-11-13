# Handoff: phase 4 CI e2e failure

Facts only. No cause or fix is proposed here, and none was established.

## Where things stand

- Session: `5a5e6960-7ae2-4ffb-8820-b3e823cf75df`. Recall: `~/.claude/skills/terminus/scripts/recall-session 5a5e6960-7ae2-4ffb-8820-b3e823cf75df`.
- Repo `/home/atom/dev/hqptuner2`, branch `v2`, HEAD `0c2ff910` (`ci: drop the per-job timeouts main brought into v2`), equal to `origin/v2`.
- Uncommitted: `.planning/phases/4/UAT.md` (items 1 and 7 re-recorded `fail` after the CI run below). Untracked and not this work's: `.planning/phases/2/baseline/failures.log`, `fuckedspecrogram.jpg`, `spectstutter.json`.
- `/cad-milestone` for v2.0.0 stopped at its audit gate: INTG-04 and INTG-05 (phase 4) are `not-verified`. `/cad-verify 4` is in progress.
- Phase 4 UAT (`.planning/phases/4/UAT.md`): items 2, 3, 4, 5, 6, 8 pass. Item 1 (clean-start boot in CI, `e2e` job) and item 7 (`check` and `e2e` green on the owner's pull request from `v2`) fail. Item 9 (owner's look at http://10.0.0.238:8090) fails, waiting on the owner.
- Pull request: https://github.com/ohshitgorillas/hqptuner/pull/5, `v2` into `main`, `MERGEABLE` after `26e68c41` (`merge: main into v2`).

## The failure

CI run `42589075729` at `0c2ff910c3cbd31352aa8b7797a34383a5b15fe3`, workflow `.github/workflows/check.yml`:

- `check`: success, 08:52:20Z to 09:01:13Z.
- `e2e`: failure, 08:52:20Z to 09:34:49Z. `make test-e2e` printed `9 failed, 140 passed, 3655 deselected, 1 warning in 2475.07s (0:41:15)` and `make: *** [Makefile:121: test-e2e] Error 1`.

All 9 failures are in `tests/e2e/test_spectrogram_scrolls_smoothly_through_bursty_feeds.py` (added in phase 5):

- `test_the_spectrogram_never_stands_still_for_longer_than_one_column_takes[the_capture]`, `[a_short_delay]`, `[a_long_delay]`, `[the_captures_delay]`
- `test_the_spectrogram_scroll_never_changes_by_more_than_one_column_between_paints[the_capture]`, `[a_short_delay]`, `[a_long_delay]`, `[the_captures_delay]`
- `test_no_paint_scrolls_the_captures_spectrogram_further_than_its_wall_time_covers`

Each raises from `tests/e2e/test_spectrogram_scrolls_smoothly_through_bursty_feeds.py:288`, for example:

```
e2e.test_spectrogram_scrolls_smoothly_through_bursty_feeds.ShortReplayError: the_capture was read over 0 paints, fewer than the 100 that count as evidence
```

The same `0 paints` count appears for `a_long_delay` and `the_captures_delay` in the log. A search of the failed-job log for `console`, `pageerror`, `TypeError`, `null`, `webgl`, `chromium` and `headless` found only pytest and Starlette deprecation warnings.

Earlier run `42585979559` at `26e68c41` was canceled by the then-present `timeout-minutes: 20` on the `e2e` job, at `[ 48%]`. That cap was removed in `0c2ff910`.

This module had never run on CI before run `42585979559`: no CI ran on `v2` before PR #5.

## Local result, same module

```
HQPTUNER_CHROMIUM=/usr/lib64/chromium-browser/headless_shell nice -n 19 scripts/gate.sh .venv/bin/pytest -m e2e -p no:cacheprovider tests/e2e/test_spectrogram_scrolls_smoothly_through_bursty_feeds.py -q
exit=0 log=/tmp/gate-pytest-7TWVTtG9.log
9 passed, 1 warning in 51.68s
```

Run in `/home/atom/dev/hqptuner2` on `v2` at `0c2ff910`'s tree.

The full local e2e suite on integrate tip `5c2e3007` (before phase 5 and the main merge): `exit=0 log=/tmp/gate-make-FqzVfA1u.log`, `138 passed, 3657 deselected, 1 warning in 605.40s`. That tree does not contain the spectrogram module.

## Environments

| | Local (Opal) | CI |
|---|---|---|
| OS | Fedora, kernel `7.2.15-200.fc44.x86_64`, 18 cores | `ubuntu-24.04` (`ubuntu-latest`) |
| Python | `.venv` | 3.14 (`actions/setup-python@v6`) |
| playwright (pip) | 1.64.1 | 1.64.1 |
| Browser | `/usr/lib64/chromium-browser/headless_shell`, `Chromium 156.0.8078.79`, system `chromium-headless` RPM, via `HQPTUNER_CHROMIUM` | `playwright install --with-deps chromium`: Chrome for Testing `156.0.8078.4` (chromium v1248) and Chrome Headless Shell `156.0.8078.4` (chromium-headless-shell v1248); `HQPTUNER_CHROMIUM` unset |

- Browser launch: `tests/e2e/conftest.py:260-268` fixture `browser`, docstring "Headless chromium with software WebGL2, preferring the binary named by HQPTUNER_CHROMIUM", calls `launch(pw)` from `scripts/chromium.py`.
- CI job steps: `.github/workflows/check.yml`, job `e2e`: checkout with submodules, Python 3.14, Node 22, `pip install -e ".[dev]"`, `npm ci`, `playwright install --with-deps chromium`, `make test-e2e`. `Makefile:120-121`: `$(VENV)/pytest -m $(E2E_MARKERS) --no-cov -q`.

## How the module reads paints

From the module's own source:

- `Replays._replay` (around line 250): fresh browser context; `add_init_script(READER_JS)`, `add_init_script(FEED_JS ...)`; `page.clock.install(time=0)`; goto base URL; click `nav.rail button[data-stage='source']`; wait for `window.__feedOpened === true`; `page.clock.pause_at(Date.now() + 16)`; `window.__feedGo()`.
- `Replays._paints` (lines 272-289): per paint, `page.clock.run_for(16)`, then `_read(page)` = `page.evaluate("window.__scroll()")`. A `None` read is skipped. A paint counts only after an earlier read had `distinct >= TEXTURED_COLUMNS` (`PROBE_COLUMNS // 3` = 13). Fewer than `MIN_PAINTS` (100) counted paints raises `ShortReplayError`.
- `READER_JS`: `window.__scroll()` returns null when no `canvas.spec` exists and on its first read; else reads `canvas.getContext("2d").getImageData(...)` on a strip near the right edge, hashes columns, returns `[columns, distinct]`.
- `FEED_JS` replaces `window.EventSource` for `/api/meter/feed` only and delivers the feed's events with `setTimeout` on the page clock.
- Spectrogram painting code: `hqptuner/static/components/faceplate/page/SourceMeter.js:268` (`getContext("2d")`), `hqptuner/static/lib/spectroraster.js`. `hqptuner/static/components/faceplate/page/aurora.js:134` calls `getContext("webgl2")`.

Other e2e modules that passed on CI in run `42589075729` include `test_spectrogram_header_no_scroll_bar_at_quarter_span.py` and `test_playing_readings_keep_flowing.py`.

## Phase 1: diagnostic

Goal: observe what the module sees on CI, paint by paint, for one feed, next to the same observation locally.

Constraints:

- Never run `playwright install` on Opal (host skill `opal-hqptuner`); the RPM `headless_shell` is the only local browser.
- Every push, branch or pull request needs the owner's word in that turn (`~/dev/CLAUDE.md` 11.2). The owner has not yet approved a diagnostic branch or run.
- Tests are never edited to pass. A diagnostic change to a test or workflow stays off `v2` and `main`.
- Gates run through `scripts/gate.sh`, never piped into `head`, `tail` or `grep`.
- Footprint: name any run reaching a full core for 10 s or 1 GB before it starts. Record every PID started, kill by PID, verify with `ps -p`.
- Read `docs/spec/testing.md` before touching a test.

## Phase 2: research

Brief for the `researcher` agent: the observed facts above and whatever phase 1 records (exact error text, run ids, environment rows, call sites, what was tried and its raw result). No hypothesis or lead goes in the brief.

## After both

- Fix through `route_failures` in `/cad-verify 4`: the owner approves the fix, `risk-check run --phase 4 --base HEAD --staged` before the commit, `make check` green.
- Re-run CI on PR #5, record items 1 and 7 through `ci-status`.
- Item 9 needs the owner's look and answer.
- Then `phase-done --n 4`, `cursor set`, the docs commit, and `/cad-milestone` again.
