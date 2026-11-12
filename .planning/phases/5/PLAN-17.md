---
phase: 5
plan: 17
requirements: [TEST-01]
files:
  - tests/js/store/faceplate-settings/hardware.test.js
---

# Phase 5: Untested behaviors covered - Plan 17: Hardware draft store

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the hardware draft claims of the "list, page and settings stores" bullet (less "all-stations starts off", struck).

## Must be true when done

- The hardware draft is unloaded before its first read.
- An edit back to base stops differing, and a string equal to a numeric base does not differ.
- `staged` reads false while every edit matches the base.
- All-stations alone does not differ, and an apply with all-stations off sends `all_presets` false.
- Each new test was seen red against a deliberate break, the break reverted, and no existing assertion line changed.

## Context

- D-02 / AC3 bite protocol for every task: apply the named break to the source line, run the test file, see each new test fail on an assertion (an import or collection error is no bite), revert, and confirm `git diff --quiet -- <source>`. The commit message lists each break and the test it turned red.
- D-01: a negative claim gets a test only when it fails against a named plausible wrong implementation; with none, write no test and stop with the claim as an owner strike candidate. Already covered: where an existing test already turns red under the named break, add no duplicate (rule 12); record that test and its red run as the claim's coverage.
- D-05: "all-stations starts off" is struck; nothing here tests the default. D-10 and `docs/spec/testing.md` (read it first): one assertion per test; fakes at the wire; signals reset every case; jscpd at 2.3%: reuse the file's own fixtures.
- Every task's gate: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <file>` and `scripts/gate.sh npx eslint <file>` print exit=0, and `git diff -U0 -- <file>` removes no line holding an assertion (AC4).
- All five tasks write the one hardware store test file, so they run in order in one plan.

## Tasks

### Task 1: Pin the hardware draft reading unloaded before its first read

- **Files:** tests/js/store/faceplate-settings/hardware.test.js
- **Reads:** hqptuner/static/store/faceplate/settings/hardware.js#hardwareDraft, hqptuner/static/store/faceplate/settings/hardware.js#loadHardware
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-settings/hardware.test.js
- **Action:** Behavior: before the first read lands, the draft reads unloaded; loaded after it is the contrast. The wrong implementation it kills is a draft treating the empty base as loaded.
- **Verify:** The hardware store file passes under the plan's gate. Making the draft read loaded with a null base turns the new case red on an assertion, and is reverted.

### Task 2: Pin a hardware edit differing only by value from its base

- **Files:** tests/js/store/faceplate-settings/hardware.test.js
- **Reads:** hqptuner/static/store/faceplate/settings/hardware.js#setHardware, hqptuner/static/model/store/draft.js#draftDiffers
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-settings/hardware.test.js
- **Action:** Two cases of one reading, the differ list: an edit set back to the base value stops differing; a string edit equal to a numeric base (`"50"` over `50`) does not differ. Wrong implementations: a differ list that keeps every key ever set, and a strict `!==` across types.
- **Verify:** The hardware store file passes under the plan's gate. Making `draftDiffers` compare with `!==` on raw values turns the string-over-number case red on an assertion, and is reverted.

### Task 3: Pin staged reading false while every edit matches the base

- **Files:** tests/js/store/faceplate-settings/hardware.test.js
- **Reads:** hqptuner/static/store/faceplate/settings/hardware.js#staged, hqptuner/static/store/faceplate/settings/hardware.js#setHardware
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-settings/hardware.test.js
- **Action:** Behavior: `staged` reads false while every edit matches the base. The wrong implementation it kills is `staged` reading "any edit set".
- **Verify:** The hardware store file passes under the plan's gate. Making `staged` read the edit count instead of the differ list turns the new case red on an assertion, and is reverted.

### Task 4: Pin all-stations alone not making the draft differ

- **Files:** tests/js/store/faceplate-settings/hardware.test.js
- **Reads:** hqptuner/static/store/faceplate/settings/hardware.js#allStations, hqptuner/static/store/faceplate/settings/hardware.js#setAllStations
- **Decisions:** D-01, D-02, D-05, D-10
- **Pins:** tests/js/store/faceplate-settings/hardware.test.js
- **Action:** Behavior: ticking all-stations with no hardware edit leaves the draft not differing. The wrong implementation it kills is all-stations counted as an edit.
- **Verify:** The hardware store file passes under the plan's gate. Making the differ list include all-stations turns the new case red on an assertion, and is reverted.

### Task 5: Pin an apply with all-stations off sending all_presets false

- **Files:** tests/js/store/faceplate-settings/hardware.test.js
- **Reads:** hqptuner/static/store/faceplate/settings/hardware.js#applyHardware, hqptuner/static/store/faceplate/settings/hardware.js#setAllStations
- **Decisions:** D-01, D-02, D-05, D-10
- **Pins:** tests/js/store/faceplate-settings/hardware.test.js
- **Action:** Behavior: an apply with all-stations off sends `all_presets: false` on the wire, and with it on sends true (the contrast, if not already pinned). Read the body at the wire fake. The wrong implementation it kills is the flag omitted or always true on the wire.
- **Verify:** The hardware store file passes under the plan's gate. Making `applyHardware` send `all_presets: true` always turns the new case red on an assertion, and is reverted. `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0.
