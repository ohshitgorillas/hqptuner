# Maintenance — structural debt

Carried forward from `roadmap.md` (removed 2026-07-25 along with `outline.md`; phase history 0–6 is closed and lives in git log). Phases 0–6 are complete; this is the open work.

Items 1 (control-catalog gate), 2 (daemon-version canary), 5 (doc audit), 6 (tab-module tests) and 7 (component-name collision) are **done** — the decisions live in the commit messages and source docstrings rather than being restated here.

Sizing below came from greps, **not verified measurement** — the item-1 estimate was off by an order of magnitude (predicted "up to 27" violations, found 2) and item 3 was overstated until read properly. Re-measure before scoping.

## 3. `manager.py` does two jobs — open

492 lines, 43 methods, carrying both the connection lifecycle (run/poll/backoff/reconnect) *and* a service-locator context that every lane takes as its first argument and calls back into for the clock seam, `require_http()`, `control`, and the state cache.

Only ~15 methods are one-line forwarders; the rest carry real logic, so the original survey's "god facade, mostly delegation" wording was wrong. The honest refactor **extracts the context seam** — clock, HTTP client, control client, state cache — out of the loop object; deleting the forwarders is cosmetic by comparison.

Touches the live write path and the suite's clock virtualization. Highest risk of anything remaining, and it buys maintainability, not correctness.

## 4. `schema.js` at 904 lines is exempt from the length gate — open

The exemption is honest (control table, not logic), but the `grayWhen` closures in it *are* logic. Largely dissolved by a fix to item 1's underlying duplication, if that is ever taken up.
