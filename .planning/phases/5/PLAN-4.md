---
phase: 5
plan: 4
requirements: [TEST-01]
files:
  - tests/js/store/live/polling.test.js
  - tests/js/store/faceplate-alerts/alerts.test.js
  - tests/js/components/faceplate/rail-staged.test.js
  - tests/js/store/faceplate-builders/shell.test.js
  - tests/js/store/faceplate-builders/profile.test.js
---

# Phase 5: Untested behaviors covered - Plan 4: Client store lines and plate failure lines

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the "client store" bullet's push-event, failure-line and rail-mark behaviors and the "failure lines on the plate" bullet. The client store bullet's own-form apply and DAC-correction discard are Plan 6's, since they live in the drawer-family and drawer-grammar suites.

## Must be true when done

- A `health` push event lands in the `health` signal, and a test fails when that route is dropped.
- A live write failing on a reset control connection and a refused credential each reach the faceplate as a line of their own.
- The rail's staged mark goes once the edit is discarded, and once it is applied.
- A failed description, favorite or narrowing load each raise their line; a failed snapshot save or delete in `store/faceplate/builders/shell.js`, and a failed description save through `store/faceplate/builders/profile-save.js`, each raise theirs.
- Each new test was seen red against a deliberate break of its line, the break reverted, and no existing assertion line changed.

## Context

- D-02 / AC3 bite protocol for every task: apply the named break to the source line, run the test file, see each new test fail on an assertion (an import or collection error is no bite), revert, and confirm `git diff --quiet -- <source>`. The commit message lists each break and the test it turned red.
- D-01: a negative claim gets a test only when it fails against a named plausible wrong implementation; with none, write no test and stop with the claim as an owner strike candidate. Already covered: where an existing test already turns red under the named break, add no duplicate (rule 12); record that test and its red run as the claim's coverage, in the commit message or, when nothing is committed, the plan summary.
- D-10 and `docs/spec/testing.md` (read it first): one assertion per test; fakes at the wire (`globalThis.fetch` on the real REST paths), no store function stubbed; line text is owner copy and is never asserted (rule 9): assert the line's `kind`, its presence or count. jscpd at 2.3% over `tests/`: factor repeated setup into a helper in the same file.
- Every task's gate: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <file>` and `scripts/gate.sh npx eslint <file>` print exit=0, and `git diff -U0 -- <file>` removes no line holding an assertion (AC4).

## Tasks

### Task 1: Pin the health push event landing in the health signal

- **Files:** tests/js/store/live/polling.test.js
- **Reads:** hqptuner/static/store/sync.js#ROUTES, hqptuner/static/store/sync.js#openStream, tests/js/store/live/polling.test.js#EVENTS
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/store/live/polling.test.js#EVENTS
- **Action:** Behavior: a `health` event on the push stream lands in the `health` signal, whole body (a raw route, unlike the wrapped snapshot routes). The file's `EVENTS` table and its `test_a_push_event_lands_in_its_signal` loop are the shape; a `health` entry added to that table is an insertion, not a changed assertion.
- **Verify:** The polling test file passes under the plan's gate. Removing the `["health", health, raw]` entry from `ROUTES` in `hqptuner/static/store/sync.js` turns the new case red on an assertion, and is reverted.

### Task 2: Pin a reset control connection reaching the plate as its own line

- **Files:** tests/js/store/faceplate-alerts/alerts.test.js
- **Reads:** hqptuner/static/store/alerts/failures.js#failureAlerts, hqptuner/static/store/live/write.js#liveOp, hqptuner/engine/controlerrors.py
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-alerts/alerts.test.js
- **Action:** Behavior: a live write that fails because the control connection was reset (the backend's `daemon_unavailable` failure) raises its own line on the faceplate. This is the planner's reading of the bullet's "reach the user as their own line": if the code shows the cause reaching the user on a different surface, stop and raise it rather than test this one. Drive the live write's failure over the wire, never by stubbing `liveOp`.
- **Verify:** The alerts test file passes under the plan's gate. Making `failureAlerts` drop the `live` area from its filter turns the new case red on an assertion, and is reverted.

### Task 3: Pin a reset connection and a refused credential each keeping their own line at once

- **Files:** tests/js/store/faceplate-alerts/alerts.test.js
- **Reads:** hqptuner/static/store/faceplate/alerts.js#faceplateAlerts, hqptuner/static/store/alerts/credentials.js#credentialsAlert, hqptuner/static/store/alerts/failures.js#failureAlerts
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-alerts/alerts.test.js#test_refused_credentials_raise_the_credentials_kind
- **Action:** Behavior: with a reset control connection and a refused credential at once, the faceplate carries one line for each, neither absorbed by the other. The refused credential alone is already pinned by `test_refused_credentials_raise_the_credentials_kind`, and Task 2's case pins the reset line alone; this task adds only the pair. Drive the live write's failure over the wire, never by stubbing `liveOp`.
- **Verify:** The alerts test file passes under the plan's gate. Making `faceplateAlerts` build the credentials line only when no failure line exists turns the new case red on an assertion, and is reverted.

### Task 4: Pin the rail's staged mark clearing on discard and on apply

- **Files:** tests/js/components/faceplate/rail-staged.test.js
- **Reads:** hqptuner/static/components/faceplate/Rail.js, hqptuner/static/store/actions.js#discardAll, hqptuner/static/store/actions.js#applyAll, tests/js/components/faceplate/rail-staged.test.js#MEMBER_EDITS
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate/rail-staged.test.js
- **Action:** Behavior the file header already promises: a stage marked `dirty` for a staged edit loses the mark once the edit is discarded, and once it is applied. Two results, two cases. The wrong implementation each kills is a mark that latches dirty (D-01's named example); the existing marked-stage cases are the contrast. The staging wire fake's apply answer clears the buffer, as the header says.
- **Verify:** The rail-staged test file passes under the plan's gate. Making the Rail's `dirty` class read a latched "ever staged" flag instead of the current staged set turns both new cases red on an assertion, and is reverted. Testing stops at the two transitions.

### Task 5: Pin the hydration failure lines

- **Files:** tests/js/store/faceplate-alerts/alerts.test.js
- **Reads:** hqptuner/static/store/matrix/descriptions.js#hydrateDescriptions, hqptuner/static/store/narrow/favorites.js#hydrateFavorites, hqptuner/static/store/narrow/persist.js#hydrateNarrowing, hqptuner/static/store/alerts/failures.js#failureAlerts
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-alerts/alerts.test.js
- **Action:** Behavior: a description load, a favorites load and a narrowing load that fail on the wire each raise their own failure line on the plate. Three results, three cases (a table is fine). Each load is driven through its exported `hydrate*` function over a failing fetch on its real REST path, never by writing the error signal directly: writing the signal would test `failureAlerts` alone and miss the hydration path this bullet names.
- **Verify:** The alerts test file passes under the plan's gate. Breaks, each alone: each `hydrate*` function swallowing its failure without recording it (its catch leaving the error signal empty) turns its own case red on an assertion, and is reverted.

### Task 6: Pin the snapshot save and delete failure lines

- **Files:** tests/js/store/faceplate-builders/shell.test.js
- **Reads:** hqptuner/static/store/faceplate/builders/shell.js#save, hqptuner/static/store/faceplate/builders/shell.js#remove, hqptuner/static/store/live/presets.js#snapshotFailed, hqptuner/static/store/live/presets.js#livePresetError
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-builders/shell.test.js
- **Action:** Behavior: a snapshot save that fails on the wire, and a snapshot delete that fails on the wire, each leave the snapshot failure line raised. Two results, two cases. Observe the line through the public failure surface (`livePresetError` or the plate's line list), never the shell's internals.
- **Verify:** The shell test file passes under the plan's gate. Breaks, each alone: `save`'s catch and `remove`'s catch in `hqptuner/static/store/faceplate/builders/shell.js` no longer recording the failure turns the matching case red on an assertion, and is reverted.

### Task 7: Pin the description save failure line through the profile builder

- **Files:** tests/js/store/faceplate-builders/profile.test.js
- **Reads:** hqptuner/static/store/faceplate/builders/profile-save.js#saveProfile, hqptuner/static/store/matrix/descriptions.js#descriptionFailed, hqptuner/static/store/matrix/descriptions.js#descriptionError
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-builders/profile.test.js
- **Action:** Behavior: a profile save whose apply lands but whose description save fails on the wire raises the description failure line. The wrong implementation it kills is a save path that drops the description failure once the apply succeeded.
- **Verify:** The profile builder test file passes under the plan's gate. Breaking the catch after the description write in `hqptuner/static/store/faceplate/builders/profile-save.js` so it no longer calls `descriptionFailed` turns the new case red on an assertion, and is reverted. `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0.
