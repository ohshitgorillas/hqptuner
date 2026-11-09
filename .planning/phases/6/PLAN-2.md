---
phase: 6
plan: 2
# Phase 6 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against findings F-004, F-005, F-015, F-017, F-020, F-021, F-022 and F-023, the Success Criteria and CONTEXT AC1-AC7.
requirements: []
files:
  - hqptuner/static/store/setup.js
  - hqptuner/static/components/Setup.js
  - hqptuner/static/css/features/setup.css
  - tests/js/store/setup.test.js
  - tests/js/store/setup-verdict.test.js
  - tests/js/components/chrome/setup.test.js
  - CHANGELOG.md
  - .filepawl.toml
---

# Phase 6: Connection host and stored credential - Plan 2: The Connection panel lists daemons and reports the host rule

## Goal

Findings F-004, F-005, F-015, F-017, F-020, F-021, F-022 and F-023 are each fixed or carry an owner ruling. This plan closes the browser side of F-021 and carries Plan 1's host rule to the user: discovered daemons are listed for the user to choose and never fill the host field silently, a refused save says why in the backend's own sentence, the password row and its note say what is kept and how, and the daemon link works for an IPv6 host.

## Must be true when done

- Opening the Connection panel or pressing Detect lists every answering daemon; the host field changes only when the user picks one (D-07).
- A save refused for a host change without credentials, for an invalid host or for a pinned value shows the backend's sentence and leaves the panel open.
- The password row and the stored-password note read in the owner-approved wording, including that the stored password is not encrypted (D-17, F-023).
- The "port 8088" link for an IPv6 host the browser can follow is `http://[<address>]:8088/auth`.
- `CHANGELOG.md` `[Unreleased]` carries the owner-approved `### Security` entry for this phase.

## Context

- Builds on Plan 1: the save refuses an invalid host and a host change without both credentials, each with its own error code (`hqptuner/api/errors.py` `STATUS`), and the pinned refusal `login_values_pinned` as the login does.
- Locked: D-07, D-17 (every visible text change in owner-approved wording), D-18 (`tests/js/store/setup.test.js` `test_discovery_fills_a_host_field_the_user_has_not_touched` is replaced as an owner-approved behavior change, not edited to pass).
- The login path (`logIn` in `hqptuner/static/store/setup.js`) keeps sending a host the user typed: the backend checks the typed pair at that host (D-01, unchanged by this phase), and `test_save_while_logged_out_sends_the_host_the_user_typed` stays as it is.
- Frontend layout binds by `docs/design-system.md`, read before any CSS; reuse the panel's `setup-options` list and `setup-fill` button before writing new CSS. Copy stays out of assertions and selectors (`docs/testing.md` rule 9). No em dashes in copy (gated).
- `CLAUDE.local.md`: this tree ends at `make check`; there is no `:8090` container for v1, so the visual check is the `e2e` CI job and the owner's own look.

## Tasks

### Task 1: Discovery lists the daemons it found, and the user picks one

- **Files:** hqptuner/static/store/setup.js, hqptuner/static/components/Setup.js, hqptuner/static/css/features/setup.css, tests/js/store/setup.test.js, tests/js/components/chrome/setup.test.js
- **Action:** `runDiscovery` keeps the answering daemons in panel state instead of writing `form.value.host` when exactly one answers; the panel renders them as a list with a prompt, each entry picking its address into the host field through `fillHost` (which marks the field touched). No answer count fills the field on its own, on open or on Detect (D-07, F-021). Each entry shows what the daemon said it is (`Daemon`'s `address`, `name`, `product`, `platform` from `GET /api/discover`), in the owner-approved list and prompt wording (D-17); if it is not in hand when this task runs, stop and ask. Rewrite the comments this reverses: `Setup.js`'s header ("what it finds fills the host field ... nothing to list"), `openSetup`'s ("the sweep's answer is the one that should win"), `runDiscovery`'s and `detectHosts`'s docstrings. Replace `test_discovery_fills_a_host_field_the_user_has_not_touched` (D-18). Keep `hostTouched` only if something still reads it.
- **Verify:** Testing scope, store lane for the decision and component lane for the render: after a discovery that answers one daemon the host field still holds what `loadConnection` seeded; after one that answers two, the panel state holds both addresses; picking an entry puts its address in the host field; the rendered panel shows one pickable entry per answering daemon, selected by a `data-testid` or wire value, never by copy. `test_discovery_leaves_a_host_the_user_typed_alone` stays green unchanged. Bite: the first and third red against the commit before this one (the replaced test is the D-18 change). `scripts/gate.sh make check` prints `exit=0` (JS suite at lines 95 / branches 90 / functions 85, knip, jscpd, css-dead).

### Task 2: A refused save shows the backend's sentence

- **Files:** hqptuner/static/store/setup.js, hqptuner/static/components/Setup.js, tests/js/store/setup-verdict.test.js, CHANGELOG.md
- **Action:** `submitConnection` catches the save's refusal for Plan 1's two new codes and for `login_values_pinned`, and shows the error's own message as the panel's report, the way the logged-out path already shows `loginSentence` for the `pinned` verdict (the wording is the server's, so the panel adds none). The panel stays open, `awaitingVerdict` is cleared, and any other refusal still rethrows as today. `logIn` gets the same treatment for Plan 1 Task 2's invalid-host code, which the login now answers: it joins `LOGIN_VERDICTS`, and its message is shown as `loginSentence` shows the `pinned` verdict's, so a logged-out save of an invalid host shows the refusal instead of rethrowing. Update the `verdict` signal's doc comment, which enumerates its members. Land the `CHANGELOG.md` `[Unreleased]` `### Security` entry in this commit, in the owner-approved wording (D-17), under the existing `### Security` heading; this is the commit that completes what a user of the panel meets. If that approval is not in hand, stop and ask. Style is checked by `scripts/gates/check_changelog.py`.
- **Verify:** Testing scope, store lane with the `api` fake the suite already uses: a save refused with each of the three codes sets the panel's refusal verdict (parametrized, three cases); the shown sentence is the error's message unchanged (asserted against the string the test itself put in the fake's refusal, rule 9); after it the panel is still open; a save refused with an unrelated code still rejects; a logged-out login refused with the invalid-host code shows that error's message unchanged. Bite: the first three and the login case red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`, `check_changelog.py` included.

### Task 3: The password row says what a blank field keeps

- **Files:** hqptuner/static/components/Setup.js, tests/js/components/chrome/setup.test.js
- **Action:** The password placeholder reads the owner-approved wording for a blank field (D-17 names "Leave blank to keep the stored password" as the item; the owner approves the wording that ships, which may be the same or reworded now that a blank field keeps the stored password only at the same host, Plan 1 Task 4). If it is not in hand, stop and ask. Change no other text in the row.
- **Verify:** Testing scope: copy only. The row is already rendered by the component suite, and a test asserting the placeholder would pin copy (rule 9), so no new test; the check is the owner's approval of the wording and `scripts/gate.sh make check` printing `exit=0`. If the approved wording equals the current one, the task makes no change and the hand-back says so.

### Task 4: The panel says the stored password is not encrypted

- **Files:** hqptuner/static/components/Setup.js, hqptuner/static/css/features/setup.css, tests/js/components/chrome/setup.test.js
- **Action:** Beside the remember choice ("Let HQPTuner store my password"), the panel carries the owner-approved note that the stored password is unencrypted (D-17, F-023's remediation). If it is not in hand, stop and ask. Place it with existing caption classes (`t-caption`) per `docs/design-system.md`; new CSS only if the design system requires it.
- **Verify:** Testing scope: copy plus placement. A component-lane case shows a caption element in the remember block, found by `data-testid`, never by its text (rule 9); bite: red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`. The owner looks at the panel in the `e2e` job's run or a local run before the phase is called done.

### Task 5: The daemon link brackets an IPv6 host

- **Files:** hqptuner/static/components/Setup.js, tests/js/components/chrome/setup.test.js
- **Action:** `eightyEightyEight` builds `http://[<address>]:8088/auth` when the address it links to is an IPv6 literal, and `http://<address>:8088/auth` otherwise (D-03). This covers both the field's host and `pageHost` (a page served from an IPv6 address arrives in `location.hostname` already bracketed in some browsers and bare in others; bracket once, never twice). `SERVER_SIDE_ONLY` keeps `::1`.
- **Verify:** Testing scope, component lane on the `daemon-auth-link` test id: host field `2001:db8::5` gives `href` `http://[2001:db8::5]:8088/auth`; host field `10.0.0.9` keeps `http://10.0.0.9:8088/auth` (already covered if an existing case asserts it; add it only if none does); a `pageHost` of `[2001:db8::7]` gives one pair of brackets. Bite: the first and third red against the commit before this one. `scripts/gate.sh make check` prints `exit=0`.

## Notes

- **Copy (D-17), each pending owner approval before its task:** the discovered-daemon list and its prompt (Task 1), the `CHANGELOG.md` `[Unreleased]` `### Security` entry (Task 2), the blank-password placeholder (Task 3), the stored-unencrypted note (Task 4). Shown as the server sends it, no panel copy: the three refusal sentences of Task 2.
- The Windows meaning of "owner-only" (Plan 5 Task 3) bears on the stored-unencrypted note's wording; the note should not claim a file protection Windows does not give (CONTEXT flagged assumption).
- Shared with Plan 3, which runs after this one: `hqptuner/static/store/setup.js`, `hqptuner/static/components/Setup.js`, the two JS test files, `CHANGELOG.md`, `.filepawl.toml`.
