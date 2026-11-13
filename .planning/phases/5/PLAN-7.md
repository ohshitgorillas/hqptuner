---
phase: 5
plan: 7
requirements: [TEST-01]
files:
  - tests/js/store/faceplate/drawers-loudness.test.js
  - tests/js/store/faceplate/drawers-modes.test.js
---

# Phase 5: Untested behaviors covered - Plan 7: Loudness and modes drawer stores

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the loudness and modes claims of the "faceplate stores" bullet. The bullet's crossfeed claims are Plan 14's.

## Must be true when done

- Loudness shows no needle with no volume, shows no dot once the shown side is the edited side, stages nothing mid-drag and leaves no bound active after a drop.
- The modes ALSA dither line does not name the network bits nor the network line the ALSA bits, and zero DAC bits read differently from a set-bits line.
- Each new test was seen red against a deliberate break, the break reverted, and no existing assertion line changed.

## Context

- D-02 / AC3 bite protocol for every task: apply the named break to the source line, run the test file, see each new test fail on an assertion (an import or collection error is no bite), revert, and confirm `git diff --quiet -- <source>`. The commit message lists each break and the test it turned red.
- D-01: a negative claim gets a test only when it fails against a named plausible wrong implementation; with none, write no test and stop with the claim as an owner strike candidate. Already covered: where an existing test already turns red under the named break, add no duplicate (rule 12); record that test and its red run as the claim's coverage, in the commit message or, when nothing is committed, the plan summary.
- D-10 and `docs/spec/testing.md` (read it first): one assertion per test; gray reasons and dither lines are owner copy, so a test asserts that two readings differ, or a number off the wire, never the sentence (rule 9). Fakes at the wire; module-level signals reset every case. jscpd at 2.3%: reuse each file's own fixtures.
- Every task's gate: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <file>` and `scripts/gate.sh npx eslint <file>` print exit=0, and `git diff -U0 -- <file>` removes no line holding an assertion (AC4).

## Tasks

### Task 1: Pin loudness showing no needle without a volume

- **Files:** tests/js/store/faceplate/drawers-loudness.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/loudness.js#loudnessBar
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawers-loudness.test.js
- **Action:** Behavior: with no volume reading, the loudness bar carries no needle; the wrong implementation it kills draws the needle at a default level (a needle with a volume is the contrast).
- **Verify:** The loudness store file passes under the plan's gate. Making `loudnessBar` place a needle when the volume is absent turns the new case red on an assertion, and is reverted.

### Task 2: Pin no dot on the loudness side being shown

- **Files:** tests/js/store/faceplate/drawers-loudness.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/loudness.js#sideDots, hqptuner/static/store/faceplate/drawers/loudness.js#showSide
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawers-loudness.test.js
- **Action:** Behavior: once the side shown is the side edited, that side carries no dot, while the other side's edit still dots it; the wrong implementation it kills dots every edited side whatever is shown.
- **Verify:** The loudness store file passes under the plan's gate. Making `sideDots` ignore the shown side turns the new case red on an assertion, and is reverted.

### Task 3: Pin a loudness drag staging nothing until dropped

- **Files:** tests/js/store/faceplate/drawers-loudness.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/loudness.js#grabHandle, hqptuner/static/store/faceplate/drawers/loudness.js#dragHandle, hqptuner/static/store/faceplate/drawers/loudness.js#dropHandle
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawers-loudness.test.js
- **Action:** Behavior: a drag in progress stages nothing on the wire; the drop is what stages (the contrast). Observe staging at the staging wire fake.
- **Verify:** The loudness store file passes under the plan's gate. Making `dragHandle` stage each move turns the new case red on an assertion, and is reverted.

### Task 4: Pin no loudness bound left active after a drop

- **Files:** tests/js/store/faceplate/drawers-loudness.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/loudness.js#dropHandle, hqptuner/static/store/faceplate/drawers/loudness.js#moveBound
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawers-loudness.test.js
- **Action:** Behavior: after a drop, no bound reads active; the wrong implementation it kills leaves the last-grabbed bound active.
- **Verify:** The loudness store file passes under the plan's gate. Making `dropHandle` leave the active bound set turns the new case red on an assertion, and is reverted.

### Task 5: Pin the dither line naming its own backend's DAC bits

- **Files:** tests/js/store/faceplate/drawers-modes.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/modes.js#ditherNote, hqptuner/static/store/faceplate/drawers/modes.js#BITS_KEY
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawers-modes.test.js
- **Action:** Three results. Under the ALSA backend the dither line carries the ALSA bits and not the network bits; under the network backend it carries the network bits and not the ALSA bits (each case stages the two bits keys to two different numbers, which are wire data a test may look for); zero DAC bits read differently from a line with bits set. The wrong implementations they kill: one bits key read for every backend, and a zero read as a bit depth.
- **Verify:** The modes store file passes under the plan's gate. Breaks, each alone: `BITS_KEY` mapping both backends to `alsa_bits` turns the network case red, mapping both to `net_bits` turns the ALSA case red, and `ditherNote`'s `bits > 0` test widened to `bits >= 0` turns the zero case red. Under that break the zero line still differs from a line with bits set (it reads a depth of 0), so an assertion that the two lines merely differ does not bite: the zero case must assert something the break changes, such as the zero line equal to the line under a backend with no bits key at its correct reading, or the zero line carrying no staged bit count. The test writer picks the assertion; the red run under the break is the check. Each on an assertion, each reverted. `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0.
