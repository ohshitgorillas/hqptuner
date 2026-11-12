---
phase: 5
plan: 14
requirements: [TEST-01]
files:
  - tests/js/store/faceplate/drawers-crossfeed.test.js
---

# Phase 5: Untested behaviors covered - Plan 14: Crossfeed drawer store

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the crossfeed claims of the "faceplate stores" bullet. The bullet's loudness and modes claims are Plan 7's.

## Must be true when done

- Crossfeed's gray reason follows the picked line's switch, and a bypassed reason reads differently from a switched-off one.
- The folded Bauer compensation reads 0 when none is installed, and compensation is not ready over an asymmetric pair.
- The Structural gate is not engaged before `setGate`, and no conflicts stand at `iir2fir=0`.
- Each new test was seen red against a deliberate break, the break reverted, and no existing assertion line changed.

## Context

- D-02 / AC3 bite protocol for every task: apply the named break to the source line, run the test file, see each new test fail on an assertion (an import or collection error is no bite), revert, and confirm `git diff --quiet -- <source>`. The commit message lists each break and the test it turned red.
- D-01: a negative claim gets a test only when it fails against a named plausible wrong implementation; with none, write no test and stop with the claim as an owner strike candidate. Already covered: where an existing test already turns red under the named break, add no duplicate (rule 12); record that test and its red run as the claim's coverage, in the commit message or, when nothing is committed, the plan summary.
- D-10 and `docs/spec/testing.md` (read it first): one assertion per test; gray reasons are owner copy, so a test asserts that two readings differ, or a number off the wire, never the sentence (rule 9). Fakes at the wire; module-level signals reset every case. jscpd at 2.3%: reuse the file's own fixtures.
- Every task's gate: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <file>` and `scripts/gate.sh npx eslint <file>` print exit=0, and `git diff -U0 -- <file>` removes no line holding an assertion (AC4).
- All five tasks write the one crossfeed store test file, so they run in order in one plan.

## Tasks

### Task 1: Pin crossfeed's gray reason following the picked line's switch

- **Files:** tests/js/store/faceplate/drawers-crossfeed.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/crossfeed.js#crossfeedView, hqptuner/static/store/faceplate/drawers/crossfeed.js#pickLine, hqptuner/static/model/gauges/crossfeed.js#crossfeedGray
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawers-crossfeed.test.js
- **Action:** Two behaviors. The gray reason the drawer shows follows the switch of the line picked (Bauer's post-process switch, Structural's installed block), not the other line's; and a crossfeed bypassed reads a different reason from one switched off. Both are relations between two readings, which is what rule 9 lets a test assert about copy.
- **Verify:** The crossfeed store file passes under the plan's gate. Breaks, each alone: `crossfeedView` reading the gate of the line not picked turns the first case red; `crossfeedGray` returning the switched-off reason for a bypass turns the second red. Both on an assertion, both reverted.

### Task 2: Pin the folded Bauer compensation reading 0 with none installed

- **Files:** tests/js/store/faceplate/drawers-crossfeed.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/crossfeed/comp.js#compPct, hqptuner/static/store/faceplate/drawers/crossfeed.js#crossfeedView
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawers-crossfeed.test.js
- **Action:** Behavior: with the Structural line picked and no compensation block installed, the folded Bauer line's compensation reads 0; the wrong implementation it kills reads the last-dragged or a default percent.
- **Verify:** The crossfeed store file passes under the plan's gate. Making the folded Bauer summary take its compensation from a constant non-zero percent turns the new case red on an assertion, and is reverted.

### Task 3: Pin compensation not ready over an asymmetric pair

- **Files:** tests/js/store/faceplate/drawers-crossfeed.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/crossfeed/comp.js#compView
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawers-crossfeed.test.js
- **Action:** Behavior: over a pipeline pair that is not symmetric, compensation is not ready to build; the wrong implementation it kills treats any two rows as a buildable pair, and a symmetric pair reading ready is the contrast.
- **Verify:** The crossfeed store file passes under the plan's gate. Making `compView`'s `ready` ignore the pair's symmetry turns the new case red on an assertion, and is reverted.

### Task 4: Pin the Structural gate not engaged before setGate

- **Files:** tests/js/store/faceplate/drawers-crossfeed.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/crossfeed.js#setGate, hqptuner/static/store/faceplate/drawers/crossfeed/structural.js#structuralView
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawers-crossfeed.test.js
- **Action:** Behavior: with the Structural line picked and no block installed, its gate reads not engaged until `setGate` throws it; after `setGate("1")` it reads engaged. The pair discriminates; the wrong implementation it kills reads a picked line as engaged.
- **Verify:** The crossfeed store file passes under the plan's gate. Making the Structural line's engaged reading true whenever it is picked turns the before-`setGate` case red on an assertion, and is reverted.

### Task 5: Pin no conflicts standing at iir2fir 0

- **Files:** tests/js/store/faceplate/drawers-crossfeed.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/crossfeed/structural.js#structuralView, hqptuner/static/store/faceplate/drawers/crossfeed.js#xfRefusal
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawers-crossfeed.test.js
- **Action:** Behavior: with `matrix_iir2fir` at 0 the Structural view lists no conflicts, and with the setting that does conflict the list names it. The conflicting case is the contrast (check whether an existing case already pins it); the wrong implementation it kills reports the iir2fir conflict whatever the setting reads. Assert keys, never reasons.
- **Verify:** The crossfeed store file passes under the plan's gate. Making the iir2fir conflict raise regardless of `matrix_iir2fir` turns the new case red on an assertion, and is reverted. `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0.
