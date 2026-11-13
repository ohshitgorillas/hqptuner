---
phase: 5
plan: 13
requirements: [TEST-01]
files:
  - tests/js/components/faceplate-settings/rail.test.js
  - tests/js/components/faceplate-settings/engine-rows.test.js
  - tests/js/components/faceplate-settings/visual.test.js
  - tests/js/components/faceplate-settings/hardware-blocks.test.js
  - tests/js/components/faceplate-settings/hardware.test.js
  - tests/js/components/faceplate-settings/logging.test.js
  - tests/js/components/matrix/library-clear.test.js
---

# Phase 5: Untested behaviors covered - Plan 13: Settings components

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the "settings (components)" bullet.

## Must be true when done

- The Timing title gains its dot when an idle time is staged and has none before.
- The pinned-rates preference reads false before the tap.
- The nblocks slider goes live once Set manually is ticked.
- The hardware apply group is not live before an edit.
- The log path row is not grayed while logging is on.
- Pressing Clear drops the selected hit.
- Each new test was seen red against a deliberate break, the break reverted, and no existing assertion line changed.

## Context

- D-02 / AC3 bite protocol for every task: apply the named break to the source line, run the test file, see each new test fail on an assertion (an import or collection error is no bite), revert, and confirm `git diff --quiet -- <source>`. The commit message lists each break and the test it turned red.
- D-01: a negative claim gets a test only when it fails against a named plausible wrong implementation; with none, write no test and stop with the claim as an owner strike candidate. Already covered: where an existing test already turns red under the named break, add no duplicate (rule 12); record that test and its red run as the claim's coverage.
- D-10 and `docs/spec/testing.md` (read it first, and its Frontend section): one assertion per test; rendered output asserted by state-bearing classes, `disabled`, attributes and `data-*` (rule 9); a preference's default is a decision (rule 11), so a "false before the tap" case pins its role (the tap moves it), never the default alone. Fakes at the wire; signals reset every case; jscpd at 2.3%.
- Every task's gate: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <file>` and `scripts/gate.sh npx eslint <file>` print exit=0, and `git diff -U0 -- <file>` removes no line holding an assertion (AC4).

## Tasks

### Task 1: Pin the Timing title's dot following a staged idle time

- **Files:** tests/js/components/faceplate-settings/rail.test.js, tests/js/components/faceplate-settings/engine-rows.test.js
- **Reads:** hqptuner/static/components/faceplate/settings/SettingsRail.js, hqptuner/static/components/faceplate/settings/engine-rows.js, hqptuner/static/store/faceplate/settings/rail.js
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-settings/rail.test.js
- **Action:** Behavior: the Timing title carries no dot before an idle time is staged and gains one once it is. The pair discriminates; the wrong implementations are a dot that never shows for the Timing group and one that shows whatever is staged. The test writer picks whichever declared file already renders the Timing title.
- **Verify:** The touched file passes under the plan's gate. Breaks, each alone: the Timing title's dot reading a constant false, and a constant true; each turns one of the pair red on an assertion and is reverted.

### Task 2: Pin the pinned-rates preference reading false until the tap

- **Files:** tests/js/components/faceplate-settings/visual.test.js
- **Reads:** hqptuner/static/components/faceplate/settings/visual.js, hqptuner/static/store/ui/prefs.js#allowPinnedRates, hqptuner/static/store/ui/prefs.js#setAllowPinnedRates
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-settings/visual.test.js
- **Action:** Behavior: the pinned-rates preference reads false before its control is tapped and true after. Rule 11 makes the default a decision, so the case is the tap's effect: false before, true after, as one relation (or the after-tap case, if already pinned, is the contrast to the before case). The wrong implementation it kills is a control rendered checked before any tap.
- **Verify:** The visual file passes under the plan's gate. Making the control render checked whatever `allowPinnedRates` reads turns the new case red on an assertion, and is reverted.

### Task 3: Pin the nblocks slider going live once Set manually is ticked

- **Files:** tests/js/components/faceplate-settings/hardware-blocks.test.js
- **Reads:** hqptuner/static/components/faceplate/settings/HardwareBlocks.js, hqptuner/static/store/faceplate/settings/hardware.js#setHardware
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-settings/hardware-blocks.test.js
- **Action:** Behavior: the nblocks slider renders disabled while Set manually is unticked and enabled once it is ticked. The wrong implementation it kills leaves the slider disabled after the tick.
- **Verify:** The hardware-blocks file passes under the plan's gate. Making the slider's `disabled` ignore the Set manually box turns the new case red on an assertion, and is reverted.

### Task 4: Pin the hardware apply group unlit before an edit

- **Files:** tests/js/components/faceplate-settings/hardware.test.js
- **Reads:** hqptuner/static/components/faceplate/settings/hardware.js, hqptuner/static/store/faceplate/settings/hardware.js#staged
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-settings/hardware.test.js
- **Action:** Behavior: before any hardware edit the settings' apply group is not live; after an edit it is (the contrast, check whether it is pinned). The wrong implementation it kills paints the apply group live whenever the section is open (D-01's always-lit example).
- **Verify:** The hardware component file passes under the plan's gate. Making the apply group read live whatever `staged` reads turns the new case red on an assertion, and is reverted.

### Task 5: Pin the log path row ungrayed while logging is on

- **Files:** tests/js/components/faceplate-settings/logging.test.js
- **Reads:** hqptuner/static/components/faceplate/settings/logging.js, hqptuner/static/store/schema/gray.js
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-settings/logging.test.js
- **Action:** Behavior: with logging on, the log path row is not grayed; with logging off it is (the contrast, check whether it is pinned). The wrong implementation it kills grays the row whatever logging reads.
- **Verify:** The logging file passes under the plan's gate. Making the log path row's gray ignore the logging switch turns the new case red on an assertion, and is reverted.

### Task 6: Pin Clear dropping the selected hit

- **Files:** tests/js/components/matrix/library-clear.test.js
- **Reads:** hqptuner/static/components/matrix/Library.js, tests/js/components/matrix/library-clear.test.js
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/components/matrix/library-clear.test.js
- **Action:** Behavior: with a hit selected in the library search, pressing Clear leaves no hit selected; the selection before the press is the contrast. The wrong implementation it kills clears the query and keeps the selection.
- **Verify:** The library-clear file passes under the plan's gate. Making Clear reset the query only turns the new case red on an assertion, and is reverted. `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0.
