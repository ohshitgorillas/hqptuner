---
phase: 5
plan: 10
requirements: [TEST-01]
files:
  - tests/js/components/faceplate-drawers-output/drawers-output-pin.test.js
  - tests/js/components/faceplate-drawers-output/drawers-output-ratehead.test.js
  - tests/js/components/faceplate-drawers-output/drawers-output-schema.test.js
  - tests/js/components/faceplate-drawers/drawers-resampling-two-stage.test.js
  - tests/js/components/faceplate-drawers/drawers-source-paint.test.js
---

# Phase 5: Untested behaviors covered - Plan 10: Output drawer components

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the "output drawers (components)" bullet. The hardware draft claims of the "list, page and settings stores" bullet are Plan 17's.

## Must be true when done

- The Output drawer shows no picker while pinned rates are off; picking f44 or f48 takes the restart mark off the rate row; the channel number is not grayed under the manual layout; a staged rate leaves the device tab undotted and a staged device leaves the rate tab undotted.
- Nothing of the two-stage note shows after the see-more trigger, and each source-paint close, range change and reopen makes its exact put and draw counts.
- Each new test was seen red against a deliberate break, the break reverted, and no existing assertion line changed.

## Context

- D-02 / AC3 bite protocol for every task: apply the named break to the source line, run the test file, see each new test fail on an assertion (an import or collection error is no bite), revert, and confirm `git diff --quiet -- <source>`. The commit message lists each break and the test it turned red.
- D-01: a negative claim gets a test only when it fails against a named plausible wrong implementation; with none, write no test and stop with the claim as an owner strike candidate. Already covered: where an existing test already turns red under the named break, add no duplicate (rule 12); record that test and its red run as the claim's coverage.
- D-10 and `docs/spec/testing.md` (read it first, and its Frontend section): one assertion per test; components render through `preact-render-to-string` and are asserted by state-bearing classes, attributes and `data-*` (rule 9); a branch reachable only through a module-private signal written from an event handler is documented in the suite header, never reached by exporting the signal. Fakes at the wire; signals reset every case; jscpd at 2.3%.
- Every task's gate: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <file>` and `scripts/gate.sh npx eslint <file>` print exit=0, and `git diff -U0 -- <file>` removes no line holding an assertion (AC4).

## Tasks

### Task 1: Pin no pin picker while pinned rates are off

- **Files:** tests/js/components/faceplate-drawers-output/drawers-output-pin.test.js
- **Reads:** hqptuner/static/components/faceplate/drawers/output/RateDial.js, hqptuner/static/store/ui/prefs.js#allowPinnedRates, hqptuner/static/store/faceplate/drawers/output.js#pickPin
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-drawers-output/drawers-output-pin.test.js
- **Action:** Behavior: with the pinned-rates preference off, the Output drawer renders no pin picker; with it on, it does (the contrast, likely already in the file). The wrong implementation it kills renders the picker whatever the preference.
- **Verify:** The pin component file passes under the plan's gate. Making the rate dial render its pin picker regardless of `allowPinnedRates` turns the new case red on an assertion, and is reverted.

### Task 2: Pin f44 and f48 taking the restart mark off the rate row

- **Files:** tests/js/components/faceplate-drawers-output/drawers-output-ratehead.test.js, tests/js/components/faceplate-drawers-output/drawers-output-pin.test.js
- **Reads:** hqptuner/static/components/faceplate/drawers/output.js, hqptuner/static/store/faceplate/drawers/output.js#pickPin, tests/js/components/faceplate-drawers-output/drawers-output-ratehead.test.js
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-drawers-output/drawers-output-ratehead.test.js
- **Action:** Behavior: picking the f44 or the f48 family pin takes the restart mark off the rate row, while a pick that restarts leaves it on (the contrast). Two results for the two families; a case table with one assertion per case. The wrong implementation it kills marks every pin pick as a restart. The test writer picks whichever of the two declared files already holds the rate row's restart-mark cases.
- **Verify:** The touched file passes under the plan's gate. Making the rate row's restart mark read true for every staged pin turns the new cases red on an assertion, and is reverted.

### Task 3: Pin the channel number left ungrayed under the manual layout

- **Files:** tests/js/components/faceplate-drawers-output/drawers-output-schema.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/output.js#channelLayout, hqptuner/static/store/faceplate/drawers/output.js#pickChannelLayout, hqptuner/static/components/faceplate/drawers/output.js
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-drawers-output/drawers-output-schema.test.js
- **Action:** Behavior: under the manual channel layout the channel number control is not grayed, while under an automatic layout it is (the contrast). The wrong implementation it kills grays the channel number under every layout.
- **Verify:** The output schema file passes under the plan's gate. Making the channel number's gray ignore the layout turns the new case red on an assertion, and is reverted.

### Task 4: Pin the rate and device tabs each dotting only their own staged edit

- **Files:** tests/js/components/faceplate-drawers-output/drawers-output-schema.test.js
- **Reads:** hqptuner/static/store/faceplate/drawer.js#drawerHead, hqptuner/static/store/faceplate/drawer/tabs.js#shownTab, hqptuner/static/components/faceplate/drawers/output.js
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-drawers-output/drawers-output-schema.test.js
- **Action:** Two behaviors: a staged rate dots the rate tab and leaves the device tab undotted; a staged device dots the device tab and leaves the rate tab undotted. Each case's dotted tab is the contrast to its undotted one. The wrong implementation it kills dots every tab of the drawer once anything in it is staged.
- **Verify:** The output schema file passes under the plan's gate. Making the drawer's dirty tabs list every tab whenever any key is staged turns both cases red on an assertion, and is reverted.

### Task 5: Pin nothing of the two-stage note showing after the see-more trigger

- **Files:** tests/js/components/faceplate-drawers/drawers-resampling-two-stage.test.js
- **Reads:** hqptuner/static/components/faceplate/SeeMore.js, tests/js/components/faceplate-drawers/drawers-resampling-two-stage.test.js
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-drawers/drawers-resampling-two-stage.test.js
- **Action:** Behavior: no held-back part of the two-stage note renders in sight after the see-more trigger; the held-back paragraphs render only inside the note popover (the contrast). The wrong implementation it kills renders the held-back paragraphs in sight after the trigger. Locate the note by a `data-*` or `data-testid` hook, never its text.
- **Verify:** The two-stage file passes under the plan's gate. `SeeMore` has no open or closed render state: `folded()` always renders the held-back paragraphs inside the `MoreNote` popover (`hqptuner/static/components/faceplate/SeeMore.js`), and the suite's `wordsInSight` already drops popovers. The break is moving `more` into the in-sight `after` paragraphs in `folded()`, which turns the new case red on an assertion, and is reverted. No gap is documented for an open state, since none exists.

### Task 6: Pin the source paint's exact put and draw counts

- **Files:** tests/js/components/faceplate-drawers/drawers-source-paint.test.js
- **Reads:** hqptuner/static/components/faceplate/drawers/source/paint.js, hqptuner/static/components/faceplate/page/sourcepaint.js, tests/js/support/page/canvas.js
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-drawers/drawers-source-paint.test.js
- **Action:** Behavior: across a source-paint close, a range change and a reopen, the paint makes exactly the image puts and draws each step owes, counted on the suite's canvas fake. The counts differ between the steps, so a table of steps is one surface with distinct expected values (rule 10). The wrong implementations: a close that keeps painting, a range change that repaints twice, and a reopen that does not repaint.
- **Verify:** The source-paint file passes under the plan's gate. Breaks, each alone: the paint loop not unsubscribing on close; a range change scheduling two repaints; a reopen skipping its first paint. Each turns at least one step's count red on an assertion and is reverted. `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0.
