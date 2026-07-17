# Testing policy — binding for all contributors, human or agent

Violations of this document are rejected in review regardless of whether the tests pass.

## Core rules

1. **Test behavior and intent, never implementation.** A test asserts an observable contract: given this input / wire traffic, the public API yields this result. If a refactor that preserves behavior breaks a test, the test was defective — module layout, private helpers, internal state, call sequences, and log text are all off-limits.

2. **One assertion per test.** Each test asserts exactly one condition (`assert` statement or one `pytest.raises` block). A failure must name exactly one broken behavior. Case sweeps use `@pytest.mark.parametrize` — one condition per generated case — never assert-in-a-loop or assertion stacks.

3. **Public API only.** Tests import and exercise the same surface a caller would. No reaching into `_private` attributes, no monkeypatching internals.

4. **Fakes speak the wire protocol; mocks of our own code are forbidden.** To test the 4321 client, run a fake daemon speaking real XML over a real socket (including the protocol's documented quirks: split frames, bare `&`, double-escaped entities). Never stub the client's own methods to test the client.

5. **Anchor on stable contract facts, not golden dumps.** Compare specific fields with known meaning (`channels min == 2`), never whole-structure equality against a snapshot — snapshots re-assert the implementation back at itself and break on any harmless change.

6. **Test names state the behavior**: `test_<behavior in plain words>` — `test_checked_checkbox_parses_true`, not `test_parse_2`.

## Markers

- Default suite is offline and deterministic; it must pass on a machine with no hqplayerd.
- Tests needing the real daemon are marked `@pytest.mark.live` and must be read-only against it. Everything write-shaped runs against fakes until the roadmap phase that owns the write path.
