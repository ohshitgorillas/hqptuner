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

   Reason: suite once took 84 s, ~80 s of it real sleeps. Now 7 s. Test reintroducing wall-clock wait is defective even when it passes.

## Markers

- Default suite offline and deterministic; must pass on machine with no hqplayerd.
- Tests needing real daemon marked `@pytest.mark.live`, must be read-only against it. Everything write-shaped runs against fakes — permanently: live tests never write to production daemon.

## Frontend

Seven core rules are language-independent, bind JS suite identically. Runner is node's built-in `node --test`, via `make test-js`.

- **One assertion per test enforced, not merely asked for.** `eslint-rules/one-assertion-per-test.js` is peer of `scripts/check_test_assertions.py`. Does not look inside nested functions, so assertion wrapped in helper or `.then()` callback counts as **zero** and is flagged. Deliberate: gate you defeat by moving assert into function is not a gate. Keep assert at call site — if helper builds condition, have it return `[ok, message]` and spread into one `assert.ok(...)`.
- **Fakes go at wire, never over our own code.** Components and stores driven by assigning exported signals and faking `globalThis.fetch` on real REST paths (`hqptuner/static/lib/api.js`) with real response shapes. No store function ever stubbed.
- **Components render through `preact-render-to-string`.** Assertions on rendered output — classes, attributes, text — never internal flags.

### Harness facts, learned the hard way

- **Module-level signals persist for life of test file.** Reset *every* source signal a test touches, not just ones that case cares about, or tests pass alone and fail in sequence. `staged` is private — clear with `await discardAll()`.
- **Writing same object reference to signal does not notify.** Every simulated poll must be fresh object.
- **SSR escapes HTML entities** (`"` becomes `&quot;`, `&` becomes `&amp;`) and emits empty-string attribute **bare** — empty `title` renders as ` title`, never empty quoted pair. Decode before asserting on user-visible text.
- **Substring-matching a class name needs delimiter** — `class="vr-tick-label"` matches naive `vr-tick` needle.
- **`node --test` rejects bare directory argument** here; pass explicit file list.
- Uncontrolled inputs (`NumberBox`, `TextBox`) sync by ref in `useEffect`, which never runs under SSR, so their *value* not observable server-side. Their `min`/`max`/`step` are.

### Branches that cannot be reached

Several component branches gated behind module-private signals written only from event handlers, which SSR never fires. **Do not export a private signal to reach one, do not test through it.** Document gap in suite header instead — honest partial coverage beats coverage manufactured by widening public surface. Pointer-driven cases that genuinely need a browser belong to playwright hand-back protocol, not unit test.