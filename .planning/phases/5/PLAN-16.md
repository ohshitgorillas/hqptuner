---
phase: 5
plan: 16
requirements: [TEST-01]
files:
  - tests/js/store/faceplate-lists/dsd-kind.test.js
  - tests/js/store/faceplate-lists/facets.test.js
  - tests/js/store/faceplate-lists/folds.test.js
---

# Phase 5: Untested behaviors covered - Plan 16: List stores

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the list claims of the "list, page and settings stores" bullet. The bullet's page claims are Plan 15's and its hardware draft claims Plan 17's.

## Must be true when done

- A DSD list has no console and no favorites.
- An untouched facet and the unset rate rule read unmoved, and reset returns facets to unmoved.
- A second tap opens a folded variant, and a fold is kept per list kind.
- Each new test was seen red against a deliberate break, the break reverted, and no existing assertion line changed.

## Context

- D-02 / AC3 bite protocol for every task: apply the named break to the source line, run the test file, see each new test fail on an assertion (an import or collection error is no bite), revert, and confirm `git diff --quiet -- <source>`. The commit message lists each break and the test it turned red.
- D-01: a negative claim gets a test only when it fails against a named plausible wrong implementation; with none, write no test and stop with the claim as an owner strike candidate. Already covered: where an existing test already turns red under the named break, add no duplicate (rule 12); record that test and its red run as the claim's coverage.
- D-10 and `docs/spec/testing.md` (read it first): one assertion per test; fakes at the wire; module-level signals reset every case; jscpd at 2.3%: reuse each file's own fixtures.
- Every task's gate: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <file>` and `scripts/gate.sh npx eslint <file>` print exit=0, and `git diff -U0 -- <file>` removes no line holding an assertion (AC4).

## Tasks

### Task 1: Pin a DSD list carrying no console

- **Files:** tests/js/store/faceplate-lists/dsd-kind.test.js
- **Reads:** hqptuner/static/store/faceplate/lists/open.js#hasConsole, hqptuner/static/store/faceplate/lists/options.js#listOptions
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-lists/dsd-kind.test.js
- **Action:** Behavior: a DSD list has no console (the facets bar), while the filters list has one (the contrast). The wrong implementation it kills gives the DSD list the filters list's console.
- **Verify:** The dsd-kind file passes under the plan's gate. Making `hasConsole` in `hqptuner/static/store/faceplate/lists/open.js` return true for every kind turns the new case red on an assertion, and is reverted. The `kind === "dsd"` early return in `options.js` `narrowedOptions` only controls narrowing, not the console, so it is not the break site.

### Task 2: Pin a DSD list carrying no favorites

- **Files:** tests/js/store/faceplate-lists/dsd-kind.test.js
- **Reads:** hqptuner/static/store/faceplate/lists/options.js#isListFavorite
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-lists/dsd-kind.test.js
- **Action:** Behavior: no option in a DSD list reads as a favorite, while a favorite in the filters list does (the contrast). The wrong implementation it kills gives the DSD list the filters list's favorites.
- **Verify:** The dsd-kind file passes under the plan's gate. Making `isListFavorite` read the filter favorites for every kind turns the new case red on an assertion, and is reverted.

### Task 3: Pin an untouched facet reading unmoved

- **Files:** tests/js/store/faceplate-lists/facets.test.js
- **Reads:** hqptuner/static/store/faceplate/lists/facets.js#facetsMoved, hqptuner/static/store/faceplate/lists/facets.js#FACETS
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-lists/facets.test.js
- **Action:** Behavior of `facetsMoved`: a facet other than the rate rule, never set on the console, reads unmoved. A moved facet reading moved is the contrast and is already pinned (`test_a_facet_set_on_the_console_reads_moved`); add no duplicate. The wrong implementation it kills reads a facet as moved whatever it holds.
- **Verify:** The facets file passes under the plan's gate. Removing the `!` before `sameJson` in `facetsMoved`, so a facet at its starting value reads moved, turns the new case red on an assertion, and is reverted.

### Task 4: Pin the unset rate rule reading unmoved

- **Files:** tests/js/store/faceplate-lists/facets.test.js
- **Reads:** hqptuner/static/store/faceplate/lists/facets.js#facetsMoved, hqptuner/static/store/faceplate/lists/facets.js#setFacet
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-lists/facets.test.js
- **Action:** Behavior of `facetsMoved`: the rate rule left at its auto default reads unmoved, whatever the default resolves to. The rate rule set off reading moved is the contrast and is already pinned (`test_the_rate_rule_reads_moved_once_the_user_sets_it_off`); add no duplicate. The wrong implementation it kills is an unset rate rule read as a moved rule.
- **Verify:** The facets file passes under the plan's gate. Making `facetsMoved` count an unset rate rule as moved turns the new case red on an assertion, and is reverted.

### Task 5: Pin resetFacets returning the facets to unmoved

- **Files:** tests/js/store/faceplate-lists/facets.test.js
- **Reads:** hqptuner/static/store/faceplate/lists/facets.js#resetFacets, hqptuner/static/store/faceplate/lists/facets.js#facetsMoved, hqptuner/static/store/faceplate/lists/facets.js#setFacet
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-lists/facets.test.js
- **Action:** Behavior: `resetFacets` after a move returns `facetsMoved` to unmoved. The wrong implementation it kills is a reset that clears the facets but leaves the moved flag up.
- **Verify:** The facets file passes under the plan's gate. Making `resetFacets` not reset the facets it reads turns the new case red on an assertion, and is reverted.

### Task 6: Pin a second tap opening a folded variant

- **Files:** tests/js/store/faceplate-lists/folds.test.js
- **Reads:** hqptuner/static/store/faceplate/lists/folds.js#toggleFold, hqptuner/static/store/faceplate/lists/folds.js#isFolded
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-lists/folds.test.js
- **Action:** Behavior: a second tap on a folded variant opens it again. The wrong implementation it kills is a toggle that only folds.
- **Verify:** The folds file passes under the plan's gate. Making `toggleFold` set folded true on every tap turns the new case red on an assertion, and is reverted.

### Task 7: Pin a fold kept per list kind

- **Files:** tests/js/store/faceplate-lists/folds.test.js
- **Reads:** hqptuner/static/store/faceplate/lists/folds.js#isFolded, hqptuner/static/store/faceplate/lists/folds.js#toggleFold
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate-lists/folds.test.js
- **Action:** Behavior: a fold made in one list kind is kept for that kind and does not fold the same variant in another kind. The wrong implementation it kills is folds keyed by variant alone.
- **Verify:** The folds file passes under the plan's gate. Making the fold key drop its list kind turns the new case red on an assertion, and is reverted. `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0.
