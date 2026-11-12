---
phase: 5
plan: 11
requirements: [TEST-01]
files:
  - tests/js/components/faceplate-drawers/drawers-speakers.test.js
  - tests/js/components/faceplate-drawers/drawers-volume-range.test.js
  - tests/js/components/faceplate-drawers/drawers-loudness.test.js
  - tests/js/components/faceplate-drawers/drawers-volume-schema.test.js
---

# Phase 5: Untested behaviors covered - Plan 11: Speakers and volume drawer components

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the "speakers and volume drawers (components)" bullet. The "builders" bullet's claims are Plan 18's and Plan 12's.

## Must be true when done

- The Speakers drawer's discard goes live after an edit, and no control is disabled while the engine is idle.
- The Volume range block is not grayed and its boxes are enabled while fixed volume is off; its needle is absent while the engine does not report the control; the Level tab has no dot before an edit.
- The Loudness drawer's readouts show while loudness runs.
- Each new test was seen red against a deliberate break, the break reverted, and no existing assertion line changed.

## Context

- D-02 / AC3 bite protocol for every task: apply the named break to the source line, run the test file, see each new test fail on an assertion (an import or collection error is no bite), revert, and confirm `git diff --quiet -- <source>`. The commit message lists each break and the test it turned red.
- D-01: most claims here are negative (no, not, absent); each gets a test only when it fails against a named plausible wrong implementation; with none, write no test and stop with the claim as an owner strike candidate. Already covered: where an existing test already turns red under the named break, add no duplicate (rule 12); record that test and its red run as the claim's coverage.
- D-10 and `docs/spec/testing.md` (read it first, and its Frontend section): one assertion per test; components render through `preact-render-to-string` and are asserted by state-bearing classes, `disabled`, attributes and `data-*` (rule 9), never text; a branch reachable only through a module-private signal written from an event handler is documented in the suite header, not reached by exporting the signal. Fakes at the wire; signals reset every case; jscpd at 2.3%.
- Every task's gate: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <file>` and `scripts/gate.sh npx eslint <file>` print exit=0, and `git diff -U0 -- <file>` removes no line holding an assertion (AC4).

## Tasks

### Task 1: Pin the Speakers drawer's discard going live after an edit

- **Files:** tests/js/components/faceplate-drawers/drawers-speakers.test.js
- **Reads:** hqptuner/static/components/faceplate/drawers/Speakers.js, hqptuner/static/components/faceplate/drawers/speakers-drawer.js, hqptuner/static/store/faceplate/drawers/speakers.js
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-drawers/drawers-speakers.test.js
- **Action:** Behavior: after an edit, the drawer's discard renders live; before the edit, not live (the contrast).
- **Verify:** The speakers component file passes under the plan's gate. Inverting the discard's condition, so it reads live only before an edit, turns the new case red on an assertion, and is reverted.

### Task 2: Pin no Speakers control disabled while the engine is idle

- **Files:** tests/js/components/faceplate-drawers/drawers-speakers.test.js
- **Reads:** hqptuner/static/components/faceplate/drawers/Speakers.js, hqptuner/static/components/faceplate/drawers/speakers-drawer.js
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-drawers/drawers-speakers.test.js
- **Action:** Behavior: with the engine idle, no control in the drawer renders disabled. The wrong implementation it kills disables the drawer's controls whenever nothing is playing, which the binding product rule "user actions always proceed" forbids.
- **Verify:** The speakers component file passes under the plan's gate. Making the drawer's controls take `disabled` from the engine's idle state turns the new case red on an assertion, and is reverted.

### Task 3: Pin the Volume range block ungrayed with boxes enabled while fixed volume is off

- **Files:** tests/js/components/faceplate-drawers/drawers-volume-range.test.js
- **Reads:** hqptuner/static/components/faceplate/drawers/VolumeRange.js, hqptuner/static/store/faceplate/drawers/volume.js#fixedMode, hqptuner/static/store/faceplate/drawers/volume.js#RANGE_KEYS
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-drawers/drawers-volume-range.test.js
- **Action:** Behavior: with fixed volume Off, the range block is not grayed and its number boxes are enabled; with fixed volume Manual or Auto, the block grays (the contrast, check whether it is pinned). The wrong implementation it kills grays the block whatever the fixed mode reads. Assert the gray class or attribute and the boxes' `disabled`, never the reason text.
- **Verify:** The volume range file passes under the plan's gate. Making the range block's gray ignore `fixedMode` (always grayed) turns the new case red on an assertion, and is reverted.

### Task 4: Pin the Volume range needle absent while the engine does not report the control

- **Files:** tests/js/components/faceplate-drawers/drawers-volume-range.test.js
- **Reads:** hqptuner/static/components/faceplate/drawers/VolumeRange.js, hqptuner/static/components/faceplate/drawers/volume/marks.js, hqptuner/static/store/faceplate/drawers/volume.js#volumeRangeNow
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-drawers/drawers-volume-range.test.js
- **Action:** Behavior: while the engine's VolumeRange does not report the control, the range renders no needle; while it does, the needle renders (the contrast). The wrong implementation it kills draws the needle at the last level whatever the engine reports.
- **Verify:** The volume range file passes under the plan's gate. Making the component draw the needle whenever a level is held, ignoring the reported control, turns the new case red on an assertion, and is reverted.

### Task 5: Pin the Loudness drawer's readouts showing while loudness runs

- **Files:** tests/js/components/faceplate-drawers/drawers-loudness.test.js
- **Reads:** hqptuner/static/components/faceplate/drawers/Loudness.js, hqptuner/static/components/faceplate/drawers/loudness/parts.js, hqptuner/static/store/faceplate/drawers/loudness.js#loudnessGray
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-drawers/drawers-loudness.test.js
- **Action:** Behavior: while loudness runs, the drawer renders its readouts; while it is off, it does not (the contrast). The wrong implementation it kills hides the readouts whatever loudness reads. Locate the readouts by a `data-*` or `data-testid` hook.
- **Verify:** The loudness component file passes under the plan's gate. Making the readouts render only while loudness is off turns the new case red on an assertion, and is reverted.

### Task 6: Pin the Level tab carrying no dot before an edit

- **Files:** tests/js/components/faceplate-drawers/drawers-volume-schema.test.js
- **Reads:** hqptuner/static/components/faceplate/drawers/volume.js, hqptuner/static/store/faceplate/drawer.js#drawerHead
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-drawers/drawers-volume-schema.test.js
- **Action:** Behavior: before any edit the Volume drawer's Level tab carries no dot; after a Level edit it does (the contrast, check whether it is pinned). The wrong implementation it kills dots the Level tab from the running fixed-volume state rather than from a staged edit (D-01's latched-dirty example).
- **Verify:** The volume schema file passes under the plan's gate. Making the Level tab's dirty reading true whenever fixed volume is enabled turns the new case red on an assertion, and is reverted. `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0.
