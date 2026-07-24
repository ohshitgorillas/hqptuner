# Testing policy — binding for all contributors, human or agent

Violations of this document are rejected in review regardless of whether the tests pass.

## Core rules

1. **Test behavior and intent, never implementation.** A test asserts an observable contract: given this input / wire traffic, the public API yields this result. If a refactor that preserves behavior breaks a test, the test was defective — module layout, private helpers, internal state, call sequences, and log text are all off-limits.

2. **One assertion per test.** Each test asserts exactly one condition (`assert` statement or one `pytest.raises` block). A failure must name exactly one broken behavior. Case sweeps use `@pytest.mark.parametrize` — one condition per generated case — never assert-in-a-loop or assertion stacks.

3. **Public API only.** Tests import and exercise the same surface a caller would. No reaching into `_private` attributes, no monkeypatching internals.

4. **Fakes speak the wire protocol; mocks of our own code are forbidden.** To test the 4321 client, run a fake daemon speaking real XML over a real socket (including the protocol's documented quirks: split frames, bare `&`, double-escaped entities). Never stub the client's own methods to test the client.

5. **Anchor on stable contract facts, not golden dumps.** Compare specific fields with known meaning (`channels min == 2`), never whole-structure equality against a snapshot — snapshots re-assert the implementation back at itself and break on any harmless change.

6. **Test names state the behavior**: `test_<behavior in plain words>` — `test_checked_checkbox_parses_true`, not `test_parse_2`.

7. **No test waits on the wall clock.** A retry, verify, or poll loop is tested for how many passes it makes and what it concludes — never for how long it takes. Production code must therefore pace itself through an injectable clock, and the suite must virtualize it.
   - **Lanes pace on the manager's seams**, `ConnectionManager.sleep` and `ConnectionManager.monotonic` — never `asyncio.sleep` or `time.monotonic` directly. A deadline is `mgr.monotonic() + mgr.alarm_threshold`; a wait is `await mgr.sleep(...)`. A new lane that reaches for the module-level clock is a review flag.
   - **`tests/conftest.py` `virtual_clock` (autouse) virtualizes both**: `sleep` advances an offset, `monotonic` reads it back. Both are public methods, so this is a seam, not a violation of rule 3 — patching a private `_sleep` would be.
   - **Advance the clock; never freeze one half of it.** A no-op `sleep` with a real `monotonic` turns every deadline loop into a hot spin that hammers the fake for the full wall-clock deadline — slower than the sleeps it removed, and a different code path than production takes.
   - **`ConnectionManager.run()` stays on the real clock** by design. It paces on the private stop-event wait, which `virtual_clock` does not touch, so a manager started with `create_task(manager.run())` polls at its real interval instead of spinning.
   - **Fake servers tear down promptly.** `http.server.HTTPServer.shutdown()` blocks on `serve_forever`'s `poll_interval`, whose 0.5 s default is charged to every fixture teardown; `fake_http.spawn` passes `poll_interval=0.01`. Any new threaded fake does the same.

   These rules exist because the suite once took 84 s, ~80 s of it real sleeps. It is 7 s now. A test that reintroduces a wall-clock wait is defective even when it passes.

## Markers

- Default suite is offline and deterministic; it must pass on a machine with no hqplayerd.
- Tests needing the real daemon are marked `@pytest.mark.live` and must be read-only against it. Everything write-shaped runs against fakes until the roadmap phase that owns the write path.

## Frontend

The six core rules are language-independent and bind the JS suite identically. Runner is node's built-in `node --test`, via `make test-js`.

- **One assertion per test is enforced, not merely asked for.** `eslint-rules/one-assertion-per-test.js` is the peer of `scripts/check_test_assertions.py`. It does not look inside nested functions, so an assertion wrapped in a helper or a `.then()` callback counts as **zero** and is flagged. That is deliberate: a gate you can defeat by moving the assert into a function is not a gate. Keep the assert at the call site — if a helper builds the condition, have it return `[ok, message]` and spread that into one `assert.ok(...)`.
- **Fakes go at the wire, never over our own code.** Components and stores are driven by assigning exported signals and by faking `globalThis.fetch` on the real REST paths (`hqptuner/static/lib/api.js`) with real response shapes. No store function is ever stubbed.
- **Components render through `preact-render-to-string`.** Assertions are on rendered output — classes, attributes, text — never on internal flags.

### Harness facts, learned the hard way

- **Module-level signals persist for the life of a test file.** Reset *every* source signal a test touches, not just the ones that case cares about, or tests pass alone and fail in sequence. `staged` is private — clear it with `await discardAll()`.
- **Writing the same object reference to a signal does not notify.** Every simulated poll must be a fresh object.
- **SSR escapes HTML entities** (`"` becomes `&quot;`, `&` becomes `&amp;`) and emits an empty-string attribute **bare** — an empty `title` renders as ` title`, never as an empty quoted pair. Decode before asserting on user-visible text.
- **Substring-matching a class name needs a delimiter** — `class="vr-tick-label"` matches a naive `vr-tick` needle.
- **`node --test` rejects a bare directory argument** here; pass an explicit file list.
- Uncontrolled inputs (`NumberBox`, `TextBox`) sync by ref in `useEffect`, which never runs under SSR, so their *value* is not observable server-side. Their `min`/`max`/`step` are.

### Branches that cannot be reached

Several component branches are gated behind module-private signals written only from event handlers, which SSR never fires. **Do not export a private signal to reach one, and do not test through it.** Document the gap in the suite header instead — honest partial coverage beats coverage manufactured by widening the public surface. The pointer-driven cases that genuinely need a browser belong to the playwright hand-back protocol, not to a unit test.
