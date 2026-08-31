# Testing policy — binding for all contributors, human or agent

Violations rejected in review even if tests pass.

## Core rules

1. **Test behavior and intent, never implementation.** Test asserts observable contract: given this input / wire traffic, public API yields this result. Refactor preserves behavior but breaks test = test defective. Module layout, private helpers, internal state, call sequences, log text — all off-limits.

2. **One assertion per test.** Each test asserts one condition (`assert` statement or one `pytest.raises` block). Failure names one broken behavior. Case sweeps use `@pytest.mark.parametrize` — one condition per generated case — never assert-in-a-loop or assertion stacks.

3. **Public API only.** Tests exercise same surface a caller would. No reaching into `_private` attributes, no monkeypatching internals.

4. **Fakes speak wire protocol; mocks of our own code forbidden.** To test 4321 client, run fake daemon speaking real XML over real socket (including documented protocol quirks: split frames, bare `&`, double-escaped entities). Never stub client's own methods to test client.

5. **Anchor on stable contract facts, not golden dumps.** Compare specific fields with known meaning (`channels min == 2`), never whole-structure equality against snapshot — snapshots re-assert implementation back at itself, break on harmless change.

6. **Test names state behavior**: `test_<behavior in plain words>` — `test_checked_checkbox_parses_true`, not `test_parse_2`.

7. **No test waits on wall clock.** Retry/verify/poll loop tested for how many passes it makes and what it concludes — never how long it takes. So production code paces itself through injectable clock, suite virtualizes it.
   - **Lanes pace on manager's seams**, `ConnectionManager.sleep` and `ConnectionManager.monotonic` — never `asyncio.sleep` or `time.monotonic` directly. Deadline is `mgr.monotonic() + mgr.alarm_threshold`; wait is `await mgr.sleep(...)`. New lane reaching for module-level clock = review flag.
   - **`tests/conftest.py` `virtual_clock` (autouse) virtualizes both**: `sleep` advances offset, `monotonic` reads it back. Both public methods, so seam, not rule-3 violation — patching private `_sleep` would be.
   - **Advance clock; never freeze one half.** No-op `sleep` with real `monotonic` turns every deadline loop into hot spin hammering fake for full wall-clock deadline — slower than sleeps it removed, and different code path than production.
   - **`ConnectionManager.run()` stays on real clock** by design. Paces on private stop-event wait, which `virtual_clock` does not touch, so manager started with `create_task(manager.run())` polls at real interval instead of spinning.
   - **Fake servers tear down promptly.** `http.server.HTTPServer.shutdown()` blocks on `serve_forever`'s `poll_interval`, 0.5 s default charged to every fixture teardown; `fake_http.spawn` passes `poll_interval=0.01`. Any new threaded fake does same.
   - **E2E exception, `e2e`-marked tests only.** The browser suite drives the app in a subprocess, so there is no seam to inject a clock through and nothing to virtualize. There the rule is narrower: fixed sleeps stay forbidden, bounded condition-polls are allowed — a `wait_for_selector` / `wait_for_function` / `Locator.wait_for` with a timeout, or an equivalent bounded poll for a non-DOM condition. The timeout is a ceiling on a condition, never a duration anything is expected to take. The offline suite is unaffected: it keeps the full rule and the virtual clock.

   Reason: suite once took 84 s, ~80 s of it real sleeps. Now 7 s. Test reintroducing wall-clock wait is defective even when it passes.

8. **New tests must bite.** A test written for new or changed behavior must fail against the pre-change code — a test that is green both with and without the change constrains nothing, however well-shaped it looks to the mechanical gates. The `/tests` chain enforces this with a bite check: implementation reverted to HEAD (tests kept), new tests re-run, red expected. Assertion failure is the strong result; a collection or import error only proves the test reaches the new surface. Tests with no pre-change state to fail against — characterization of existing behavior, tests accompanying a pure refactor — are exempt, and the exemption is stated in the hand-back rather than assumed silently; mutation testing (below) covers those over time.

9. **A test asserts only strings it put on the wire itself, wire identifiers, and numbers derived from wire data. Every string born inside `hqptuner/` is copy.** Source or `data/`, makes no difference: labels, headings, blurbs, hints, tooltips, status lines, error text, a picker's option list, a curated list's order and its count are owner-owned data, reworded at will. The test: to know this literal, would the writer have to read `hqptuner/`? Then it is copy, and it stays out of the assertion and out of the DOM selector. A device name the fixture handed in is wire data and may be asserted; the sentence the app wraps around it may not. Wire identifiers — engine names, option values, config attributes, JSON keys, CSS classes, error codes — are contract, and pinning those is correct. Consequences:
   - **Error text is copy.** Exceptions and API errors carry a code; tests match the type plus the code, never the message. `pytest.raises(match=...)` and `error.includes(...)` are legal only for a wire identifier (`match="alsa_dop"`), never a sentence.
   - **Rendered text is copy.** Assert classes, attributes, `data-*` state, disabled flags, values and numbers; text only where it is a wire identifier or a number.
   - **`data/*.json` never supplies an expected value.** Join and lookup mechanics are tested against fixtures under `tests/fixtures/`; a check that the owner's data is well-formed is a gate under `scripts/gates/`, not a behavior test.
   - **A curated count is copy, like a curated order.** The number of presets is data; the number of channels the engine reported is contract.
   - Where a selector would need a sentence, add a `data-testid`. If nothing meaningful survives removing the wording, delete the test instead of leaving a tautology. `scripts/gates/check_no_copy_assertions.py` and its eslint peer catch the mechanical shape; the principle is what review checks.

## Markers

- Default suite offline and deterministic; must pass on machine with no hqplayerd.
- Tests needing real daemon marked `@pytest.mark.live`, must be read-only against it. Everything write-shaped runs against fakes — permanently: live tests never write to production daemon.
- Browser end-to-end tests live in `tests/e2e/` and carry `e2e`, applied for them by that package's `conftest.py` — do not write `pytestmark`. They drive a real headless chromium against a real `python -m hqptuner` subprocess wired to the same wire fakes the offline suite uses, so they write freely: nothing they touch is the production daemon. Deselected from `make test`, `make test-live`, the pre-commit pytest hook and mutmut; run them with `make test-e2e`. `make check` does not include them. Rule 2 still holds, and the assertion gate counts `assert` statements only — playwright's `expect()` counts zero, so locators do the waiting and each test makes exactly one plain `assert`.

## Mutation testing

Periodic health check on the suite itself. **Not part of `make check`, not in pre-commit, never a merge gate** — it takes hours and its output is a reading exercise, not a pass/fail.

`mutmut` breaks the code on purpose, one edit at a time — flips a comparison, drops a call, swaps a constant — and reruns the offline suite against each break. A mutant the suite fails on is *killed*: some test noticed. A mutant that **survives** is a line no test constrains, so the code there could be wrong and everything would still be green. That is the one question the assertion-count gate cannot ask: those gates check that a test is shaped right, never that it could fail.

```
make mutate                              # whole package, hours
make mutate MUTATE=hqptuner.presets.store.presets  # one module, minutes
```

Scope and pytest arguments live in `pyproject.toml` under `[tool.mutmut]`: `hqptuner/` minus `static/` (the frontend is JS), suite run as `-m "not live"` so a mutation run never reaches the daemon. Working copies land in the gitignored `mutants/`. `mutmut browse` walks survivors interactively; `mutmut show <mutant>` prints one diff.

Reading the result: a survivor is a question, not a defect. Three honest answers — the behavior is untested and wants a test; the mutated line has no observable effect and the mutant is equivalent, so nothing is owed; or the line is dead and should go. Chasing a score is how a suite fills with tests written to kill mutants rather than to state behavior, which is rule 1 violated with extra steps. Run it when a module's coverage is in doubt, not on a schedule.

## Frontend

Seven core rules are language-independent, bind JS suite identically. Runner is node's built-in `node --test`, via `make test-js`.

- **One assertion per test enforced, not merely asked for.** `eslint-rules/one-assertion-per-test.js` is peer of `scripts/gates/check_test_assertions.py`. Does not look inside nested functions, so assertion wrapped in helper or `.then()` callback counts as **zero** and is flagged. Deliberate: gate you defeat by moving assert into function is not a gate. Keep assert at call site — if helper builds condition, have it return `[ok, message]` and spread into one `assert.ok(...)`.
- **Fakes go at wire, never over our own code.** Components and stores driven by assigning exported signals and faking `globalThis.fetch` on real REST paths (`hqptuner/static/lib/api.js`) with real response shapes. No store function ever stubbed.
- **Components render through `preact-render-to-string`.** Assertions on rendered output — classes, attributes, `data-*` state, and text only where it is a wire identifier or a number (rule 9) — never internal flags.

### Harness facts, learned the hard way

- **Module-level signals persist for life of test file.** Reset *every* source signal a test touches, not just ones that case cares about, or tests pass alone and fail in sequence. `staged` is private — clear with `await discardAll()`.
- **Writing same object reference to signal does not notify.** Every simulated poll must be fresh object.
- **SSR escapes HTML entities** (`"` becomes `&quot;`, `&` becomes `&amp;`) and emits empty-string attribute **bare** — empty `title` renders as ` title`, never empty quoted pair. Decode before asserting on user-visible text.
- **Substring-matching a class name needs delimiter** — `class="vr-tick-label"` matches naive `vr-tick` needle.
- **`node --test` rejects bare directory argument** here; pass explicit file list.
- **Cache-busting query suffix silently destroys a file's coverage.** Node keys coverage by URL, then groups by path with the query stripped and keeps the last entry per path. Test reaching second module instance through `?v=2`-style suffix therefore overwrites real instance's coverage with load-only one's, and file reports near-zero functions however well tested. Use `<name>.fresh-<tag>.js` convention `tests/js/support/vendor-resolve.js` provides instead.
- Uncontrolled inputs (`NumberBox`, `TextBox`) sync by ref in `useEffect`, which never runs under SSR, so their *value* not observable server-side. Their `min`/`max`/`step` are.

### Branches that cannot be reached

Several component branches gated behind module-private signals written only from event handlers, which SSR never fires. **Do not export a private signal to reach one, do not test through it.** Document gap in suite header instead — honest partial coverage beats coverage manufactured by widening public surface. Pointer-driven cases that genuinely need a browser belong to playwright hand-back protocol, not unit test.