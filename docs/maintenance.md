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

## 8. Adaptive preamp gain (features.md item 22) — attempted 2026-07-25, reverted, undone

Shipped to the dev container three times, reported done all three times, broken all three times, in three unrelated ways. Every failure below would have been caught by the single step that was skipped every time: check against reality before claiming the work is finished, not after being told to.

- **Round 1 — wrong formula, never checked against a real profile.** Peak boost was computed as filter-stage response *plus the row's existing gain*. An AutoEq/REW import's existing gain already IS that file's own `Preamp:` compensation, chosen specifically to flatten the composite to ~0 dB. So the formula measured "how well the file already corrected itself," which is always ~0 — the reading the user got, checkbox on or off. Verified only against synthetic rows the agent wrote to match its own assumption; never run against an actual profile before hand-back.
- **Before writing that code**, the agent also floated a 3-option `AskUserQuestion` menu of invented "what if it fights your manual edits" scenarios instead of just deciding. Called nonsense, correctly — the answer was obvious and the question wasted a turn.
- **Round 2 — fixed the formula, ignored a rule read minutes earlier.** Peak now measured from filter stages alone, which was correct. Landed alongside a new two-column layout (gauge to the right of the description, as asked) built as ad hoc flexbox, skipping `docs/design-system.md`'s binding two-column mechanism (`.cluster-row`/`.col-rule`) — a rule this same agent had read and quoted during planning, in this same session, shortly before ignoring it.
- **Round 3 — "fixed" the layout, still never looked.** Swapped in `.cluster-row`/`.col-rule`, reported PASS. Not screenshotted. Still broken: the description text rendered one word per line for ~600px, and the checkbox/gauge weren't visible in the viewport at all. Surfaced only when the user explicitly ordered a playwright screenshot — a tool sitting in `.venv` and documented in this repo's own host skill the entire time.
- **All three PASS claims rode a green `make check` / `task-check.sh`.** Irrelevant to either defect: a unit suite the agent wrote from its own wrong assumption confirms that assumption, not reality, and a CSS layout bug is invisible to lint, type-check, and unit tests entirely. "Gate is green" and "feature works" are different claims; only the first was ever checked before hand-back, three times running.
- **Stakes were not cosmetic.** Enabling the feature overwrites the gain field of real pipelines in the user's real EQ profiles, unprompted, on every recompute — production listening configuration, not a UI nit.
- **Then the postmortem itself failed, repeatedly**, across several drafts — called "excessively verbose and vastly insufficient" at once, rewritten, still missing enough that the user deleted it and ordered a clean rewrite, and the rewrite's own closing line asserted the one thing this whole entry says not to do ("the mechanism is probably right") with exactly zero verification behind it — caught by the user, not by the agent. Getting the account of a failure wrong is its own instance of the same failure: confidence standing in for a check that was never run.

**Disposition.** Fully reverted: `lib/preamp.js`, `lib/pipelinealloc.js` (the DSP-pipelines-count half — undone too, on explicit "undo all changes," despite working correctly on its own), their `app.js` wiring, the `MatrixTab.js`/`matrix-panels.css` UI, both test files, both CHANGELOG entries. `features.md` item 22 stands as not done.

**Next agent.** Do not take anything above on faith, including this line: the mechanism (no matrix master gain exists — readme §1.11.1, only per-pipeline gain — so fold/replace one shared dB value into eligible pipelines' own gain) was reasoned about, never verified. Same failure mode as everything else in this entry — confident, unchecked, by an agent that had just been burned for exactly that. It was never run against a real profile, never watched live, never independently reviewed by anyone but the agent that was wrong three times in a row. Treat it as an unverified guess, not a foundation. Before claiming any of this done: load a real AutoEq/REW profile, not a hand-built row, and read the actual rendered page with your own (headless) eyes at the viewport `docs/design-system.md` specifies. Do it before you say PASS, not after someone makes you.
