---
phase: 5
plan: 15
requirements: [TEST-01]
files:
  - tests/js/store/faceplate/drawers-pipelines.test.js
  - tests/js/store/faceplate/drawers-source/drawers-source.test.js
  - tests/js/store/faceplate-page/meter-span.test.js
  - tests/js/store/faceplate-page/profile.test.js
---

# Phase 5: Untested behaviors covered - Plan 15: Pipelines, source plot and page stores

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the pipelines and source claims of the "faceplate stores" bullet and the page claims of the "list, page and settings stores" bullet.

## Must be true when done

- A plain pipeline set marks no crosspoint generated, and a bypassed Matrix engine grays the set.
- The source plot's Nyquist tick sits at the top and its timed window axis ends at 0.
- A tick above the top of the view is dropped.
- A finished profile switch is no longer busy, and the next switch clears a refusal.
- Each new test was seen red against a deliberate break, the break reverted, and no existing assertion line changed.

## Context

- D-02 / AC3 bite protocol for every task: apply the named break to the source line, run the test file, see each new test fail on an assertion (an import or collection error is no bite), revert, and confirm `git diff --quiet -- <source>`. The commit message lists each break and the test it turned red.
- D-01: a negative claim gets a test only when it fails against a named plausible wrong implementation; with none, write no test and stop with the claim as an owner strike candidate. Already covered: where an existing test already turns red under the named break, add no duplicate (rule 12); record that test and its red run as the claim's coverage.
- D-10 and `docs/spec/testing.md` (read it first): one assertion per test; a "reads none" or "no" case needs its contrast somewhere on the surface (rule 10). Fakes at the wire; module-level signals reset every case; jscpd at 2.3%: reuse each file's own fixtures.
- Every task's gate: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <file>` and `scripts/gate.sh npx eslint <file>` print exit=0, and `git diff -U0 -- <file>` removes no line holding an assertion (AC4).

## Tasks

### Task 1: Pin a plain pipeline set marking no crosspoint generated

- **Files:** tests/js/store/faceplate/drawers-pipelines.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/pipelines.js#pipelinesView
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawers-pipelines.test.js
- **Action:** Behavior: a plain pipeline set (rows no crossfeed or compensation block wrote) marks no crosspoint as generated, while a set carrying a generated block marks its crosspoints (the contrast). The wrong implementation it kills marks every crosspoint generated.
- **Verify:** The pipelines store file passes under the plan's gate. Making `pipelinesView` mark every crosspoint generated turns the new case red on an assertion, and is reverted.

### Task 2: Pin the pipeline set grayed under a bypassed Matrix engine

- **Files:** tests/js/store/faceplate/drawers-pipelines.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/pipelines.js#pipelinesView, hqptuner/static/store/schema/gray.js#matrixBypassed
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawers-pipelines.test.js
- **Action:** Behavior: with the Matrix engine bypassed, the set reads grayed; with it running, not (the contrast).
- **Verify:** The pipelines store file passes under the plan's gate. Making `pipelinesView`'s `gray` read `''` whatever the bypass turns the new case red on an assertion, and is reverted.

### Task 3: Pin the source plot's Nyquist tick at the top at the whole band

- **Files:** tests/js/store/faceplate/drawers-source/drawers-source.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/source.js#meterGrid
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawers-source/drawers-source.test.js
- **Action:** Behavior of the plot's grid: at the whole band, the source Nyquist's tick sits at the top edge (fraction 0 down from the top). Its contrast on the same surface: at a narrower span the Nyquist is above the view (the drop itself is Task 5's).
- **Verify:** The source store file passes under the plan's gate. Making the frequency ticks measure up from the bottom instead of down from the top turns the new case red on an assertion, and is reverted.

### Task 4: Pin the timed window's time axis ending at 0

- **Files:** tests/js/store/faceplate/drawers-source/drawers-source.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/source.js#meterGrid, hqptuner/static/store/faceplate/drawers/source.js#spectrogramSpan
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawers-source/drawers-source.test.js
- **Action:** Behavior of the plot's grid: on a timed window, the time axis's last tick is 0 (now) at the window's end. Its contrast on the same surface: a different window length moves the other ticks while the end stays 0.
- **Verify:** The source store file passes under the plan's gate. Making the time ticks run from 0 at the start of the window turns the new case red on an assertion, and is reverted.

### Task 5: Pin a tick above the top of the view being dropped

- **Files:** tests/js/store/faceplate-page/meter-span.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/source.js#meterGrid, hqptuner/static/store/faceplate/drawers/source.js#setSpectrogramSpan
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-page/meter-span.test.js
- **Action:** Behavior: when the span picked keeps less than the whole band, a frequency tick above the top of the view is not in the grid, while every tick at or under the top is (the contrast, the whole band keeping that tick). The wrong implementation it kills keeps every tick and lets it sit at a negative fraction. Read the frequency ticks the page's meter reads, at the store.
- **Verify:** The meter-span file passes under the plan's gate. Removing the filter that drops ticks above the top from the grid's frequency ticks turns the new case red on an assertion, and is reverted.

### Task 6: Pin a finished profile switch no longer reading busy

- **Files:** tests/js/store/faceplate-page/profile.test.js
- **Reads:** hqptuner/static/store/faceplate/page/profile.js#switchProfile, hqptuner/static/store/faceplate/page/profile.js#profileChoices
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-page/profile.test.js
- **Action:** Behavior: once a switch has finished, `profileChoices` no longer reads busy; busy mid-switch is the contrast. The wrong implementation it kills is busy latched after the first switch.
- **Verify:** The page profile file passes under the plan's gate. Making the switch operation never clear busy turns the new case red on an assertion, and is reverted.

### Task 7: Pin the next profile switch clearing a refusal

- **Files:** tests/js/store/faceplate-page/profile.test.js
- **Reads:** hqptuner/static/store/faceplate/page/profile.js#switchProfile, hqptuner/static/store/faceplate/page/profile.js#profileChoices, hqptuner/static/store/faceplate/page/profile.js#profileUnsettled
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-page/profile.test.js
- **Action:** Behavior: after a refused switch, the next switch clears the refusal; the refusal standing after the refused switch is the contrast. Refusals are observed by presence, never by their sentence. The wrong implementation it kills is a refusal kept until the user leaves the page.
- **Verify:** The page profile file passes under the plan's gate. Making a new switch not clear the previous error turns the new case red on an assertion, and is reverted. `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0.
