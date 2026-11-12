---
phase: 5
plan: 12
requirements: [TEST-01]
files:
  - tests/js/components/faceplate-builders/rail.test.js
  - tests/js/components/faceplate-lists/console.test.js
  - tests/js/components/faceplate-lists/default-mark.test.js
  - tests/js/components/faceplate-lists/option-list.test.js
---

# Phase 5: Untested behaviors covered - Plan 12: Builder rail and list components

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the builders bullet's stations trigger and the "lists (components)" bullet.

## Must be true when done

- Tapping the stations trigger opens the stations menu.
- Tapping Reset clears the facets.
- A setting with no recorded default marks no option, and a default narrowed out of the list drops from the legend.
- An open list is not marked `data-closed`, and dither rows carry no heart.
- Each new test was seen red against a deliberate break, the break reverted, and no existing assertion line changed.

## Context

- D-02 / AC3 bite protocol for every task: apply the named break to the source line, run the test file, see each new test fail on an assertion (an import or collection error is no bite), revert, and confirm `git diff --quiet -- <source>`. The commit message lists each break and the test it turned red.
- D-01: a negative claim gets a test only when it fails against a named plausible wrong implementation; with none, write no test and stop with the claim as an owner strike candidate. Already covered: where an existing test already turns red under the named break, add no duplicate (rule 12); record that test and its red run as the claim's coverage.
- D-10 and `docs/spec/testing.md` (read it first, and its Frontend section): one assertion per test; rendered output asserted by state-bearing classes, attributes and `data-*` (rule 9). A tap is driven the way each file already drives one (the handler a rendered element carries, or the store action it calls); a tap SSR cannot fire is documented in the suite header as the Frontend section requires, never reached by exporting a private signal. Fakes at the wire; signals reset every case; jscpd at 2.3%.
- Every task's gate: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <file>` and `scripts/gate.sh npx eslint <file>` print exit=0, and `git diff -U0 -- <file>` removes no line holding an assertion (AC4).

## Tasks

### Task 1: Pin the stations trigger opening the stations menu

- **Files:** tests/js/components/faceplate-builders/rail.test.js
- **Reads:** hqptuner/static/components/faceplate/builders/SnapshotRail.js, hqptuner/static/components/faceplate/builders/StationsMenu.js, hqptuner/static/store/faceplate/builders/rail.js
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-builders/rail.test.js
- **Action:** Behavior: tapping the builder rail's stations trigger opens the stations menu; before the tap it is closed (the contrast). The wrong implementation it kills wires the trigger to nothing, or to a different menu.
- **Verify:** The builder rail file passes under the plan's gate. Removing the trigger's open action turns the new case red on an assertion, and is reverted.

### Task 2: Pin Reset clearing the facets

- **Files:** tests/js/components/faceplate-lists/console.test.js
- **Reads:** hqptuner/static/components/faceplate/lists/Console.js, hqptuner/static/store/faceplate/lists/facets.js#resetFacets, hqptuner/static/store/faceplate/lists/facets.js#facetsMoved
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-lists/console.test.js
- **Action:** Behavior: with a facet moved, tapping the console's Reset returns every facet to unmoved. The moved state before the tap is the contrast. The store half of reset is Plan 16's; this case pins that the console's Reset reaches it.
- **Verify:** The console file passes under the plan's gate. Wiring Reset to a no-op turns the new case red on an assertion, and is reverted.

### Task 3: Pin no default mark for a setting with no recorded default

- **Files:** tests/js/components/faceplate-lists/default-mark.test.js
- **Reads:** hqptuner/static/components/faceplate/lists/OptionList.js, hqptuner/static/components/faceplate/lists/Rows.js
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-lists/default-mark.test.js
- **Action:** Behavior: a setting with no recorded default marks no option. The wrong implementation it kills marks the first option as the default.
- **Verify:** The default-mark file passes under the plan's gate. Making the mark fall back to the first option when no default is recorded turns the new case red on an assertion, and is reverted.

### Task 4: Pin a default narrowed out of the list dropping from the legend

- **Files:** tests/js/components/faceplate-lists/default-mark.test.js
- **Reads:** hqptuner/static/components/faceplate/lists/OptionList.js, hqptuner/static/store/faceplate/lists/options.js#narrowedOptions
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-lists/default-mark.test.js
- **Action:** Behavior: a default narrowed out of the list drops from the legend, while one still in the list keeps its legend entry (the contrast). The wrong implementation it kills keeps a legend entry for a default no row shows.
- **Verify:** The default-mark file passes under the plan's gate. Making the legend read the default from the raw options instead of the narrowed ones turns the new case red on an assertion, and is reverted.

### Task 5: Pin an open list not marked data-closed

- **Files:** tests/js/components/faceplate-lists/option-list.test.js
- **Reads:** hqptuner/static/components/faceplate/lists/OptionList.js, hqptuner/static/store/faceplate/view.js#openList
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-lists/option-list.test.js
- **Action:** Behavior: a list that is open renders without `data-closed`; a closed one carries it (the contrast, already in the file if a case asserts it). The wrong implementation it kills sets `data-closed` unconditionally.
- **Verify:** The option-list file passes under the plan's gate. Making the list render `data-closed` whatever `openList` reads turns the new case red on an assertion, and is reverted.

### Task 6: Pin dither rows carrying no heart

- **Files:** tests/js/components/faceplate-lists/option-list.test.js
- **Reads:** hqptuner/static/components/faceplate/lists/Rows.js, hqptuner/static/store/faceplate/lists/options.js#isListFavorite
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-lists/option-list.test.js
- **Action:** Behavior: the dither list's rows carry no heart (favorite control), while a filters list's rows do (the contrast). The wrong implementation it kills renders a heart on every list kind's rows. Find the heart by its `data-*` or `data-testid` hook or its state-bearing class.
- **Verify:** The option-list file passes under the plan's gate. Making the rows render the heart for every list kind turns the new case red on an assertion, and is reverted. `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0.
