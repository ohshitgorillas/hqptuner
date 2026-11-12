---
phase: 5
plan: 18
requirements: [TEST-01]
files:
  - tests/js/components/faceplate-builders/builder.test.js
  - tests/js/components/faceplate-builders/profile.test.js
  - tests/js/components/faceplate-builders/rows.test.js
---

# Phase 5: Untested behaviors covered - Plan 18: Builder components

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers three claims of the "builders" bullet. The bullet's stations trigger is Plan 12's.

## Must be true when done

- A builder shows no refusal line and no confirm line while idle.
- The profile select is enabled once a profile is held.
- A row that is off carries no diff mark.
- Each new test was seen red against a deliberate break, the break reverted, and no existing assertion line changed.

## Context

- D-02 / AC3 bite protocol for every task: apply the named break to the source line, run the test file, see each new test fail on an assertion (an import or collection error is no bite), revert, and confirm `git diff --quiet -- <source>`. The commit message lists each break and the test it turned red.
- D-01: most claims here are negative (no, not); each gets a test only when it fails against a named plausible wrong implementation; with none, write no test and stop with the claim as an owner strike candidate. Already covered: where an existing test already turns red under the named break, add no duplicate (rule 12); record that test and its red run as the claim's coverage.
- D-10 and `docs/spec/testing.md` (read it first, and its Frontend section): one assertion per test; components render through `preact-render-to-string` and are asserted by state-bearing classes, `disabled`, attributes and `data-*` (rule 9), never text; a branch reachable only through a module-private signal written from an event handler is documented in the suite header, not reached by exporting the signal. Fakes at the wire; signals reset every case; jscpd at 2.3%.
- Every task's gate: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <file>` and `scripts/gate.sh npx eslint <file>` print exit=0, and `git diff -U0 -- <file>` removes no line holding an assertion (AC4).

## Tasks

### Task 1: Pin a builder showing no refusal line while idle

- **Files:** tests/js/components/faceplate-builders/builder.test.js
- **Reads:** hqptuner/static/components/faceplate/builders/SnapshotBuilder.js, hqptuner/static/store/faceplate/builders/shell.js#refused
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-builders/builder.test.js
- **Action:** Behavior: with nothing refused, the builder renders no refusal line; after a refusal, it renders (the contrast). The wrong implementation it kills is the refusal line rendered from a stale refusal of an earlier session.
- **Verify:** The builder component file passes under the plan's gate. Making the refusal line render whenever the builder has a name turns the new case red on an assertion, and is reverted.

### Task 2: Pin a builder showing no confirm line while idle

- **Files:** tests/js/components/faceplate-builders/builder.test.js
- **Reads:** hqptuner/static/components/faceplate/builders/SnapshotBuilder.js, hqptuner/static/store/faceplate/builders/shell.js#ask
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-builders/builder.test.js
- **Action:** Behavior: with nothing asked, the builder renders no confirm line; after an ask, it renders (the contrast). The wrong implementation it kills is the confirm line rendered whenever the builder is open.
- **Verify:** The builder component file passes under the plan's gate. Making the confirm line render whenever the builder is open turns the new case red on an assertion, and is reverted.

### Task 3: Pin the profile select enabled once a profile is held

- **Files:** tests/js/components/faceplate-builders/profile.test.js
- **Reads:** hqptuner/static/components/faceplate/builders/ProfileBuilder.js, hqptuner/static/store/faceplate/builders/profile.js
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-builders/profile.test.js
- **Action:** Behavior: once the builder holds a profile, its profile select renders enabled; before, disabled (the contrast, check whether it is pinned). The wrong implementation it kills leaves the select disabled after the hold lands.
- **Verify:** The profile builder component file passes under the plan's gate. Making the select's `disabled` read true whatever is held turns the new case red on an assertion, and is reverted.

### Task 4: Pin no diff mark on a row that is off

- **Files:** tests/js/components/faceplate-builders/rows.test.js
- **Reads:** hqptuner/static/components/faceplate/builders/SnapshotRows.js, hqptuner/static/store/faceplate/builders/rows.js
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-builders/rows.test.js
- **Action:** Behavior: a builder row that is off carries no diff mark even where its value differs from the running one, while an on row with the same difference carries it (the contrast). The wrong implementation it kills marks every differing row whatever its switch.
- **Verify:** The builder rows file passes under the plan's gate. Making the diff mark ignore the row's off state turns the new case red on an assertion, and is reverted. `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0.
