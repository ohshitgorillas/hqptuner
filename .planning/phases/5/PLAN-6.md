---
phase: 5
plan: 6
requirements: [TEST-01]
files:
  - tests/js/store/faceplate/drawer-family.test.js
  - tests/js/store/faceplate/drawer-grammar.test.js
  - tests/js/store/faceplate/drawer.test.js
---

# Phase 5: Untested behaviors covered - Plan 6: Drawer family, grammar and head stores

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the drawer-framework claims of the "faceplate stores" bullet (drawer-family apply group, the `when` restart row, the multi-tab title dot, a row's question) and the two drawer claims of the "client store" bullet (an own form's apply, the DAC correction edit and the Matrix engine's discard).

## Must be true when done

- A family drawer's apply group is unlit before any edit, and a staged DAC correction edit makes the Matrix engine drawer's discard live.
- A restart row left out by its `when` leaves its tab a live tab.
- An own form's apply writes through that form and does not also POST the staged set.
- A multi-tab drawer's title carries no dot, and a row's question is pinned under its own drawer only.
- Each new test was seen red against a deliberate break, the break reverted, and no existing assertion line changed.

## Context

- D-02 / AC3 bite protocol for every task: apply the named break to the source line, run the test file, see each new test fail on an assertion (an import or collection error is no bite), revert, and confirm `git diff --quiet -- <source>`. The commit message lists each break and the test it turned red.
- D-01: a negative claim gets a test only when it fails against a named plausible wrong implementation; with none, write no test and stop with the claim as an owner strike candidate.
- Already covered: where an existing test already turns red under the named break, add no duplicate (rule 12); record that test and its red run in the commit message, or in the plan summary when nothing is committed, as the claim's coverage.
- D-10 and `docs/spec/testing.md` (read it first): one assertion per test, fakes at the wire (the staging wire fake, `globalThis.fetch` on real REST paths), no store function stubbed, module-level signals reset every case. jscpd at 2.3%: reuse each file's own fixtures (`member`, `drawerOf`, `ownForm`, `twoTabs`, `oneTab`).
- Every task's gate: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <file>` and `scripts/gate.sh npx eslint <file>` print exit=0, and `git diff -U0 -- <file>` removes no line holding an assertion (AC4).

## Tasks

### Task 1: Pin the family apply group unlit before an edit

- **Files:** tests/js/store/faceplate/drawer-family.test.js
- **Reads:** hqptuner/static/store/faceplate/drawer.js#drawerHead, tests/js/store/faceplate/drawer-family.test.js#MEMBER_EDITS
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawer-family.test.js
- **Action:** Behavior: before any edit, a matrix-family drawer's apply group is unlit. The wrong implementation it kills is an apply group always lit (D-01's named example), and the existing member-edit cases are its contrast.
- **Verify:** The drawer-family file passes under the plan's gate. Making `drawerHead` paint the apply group live whatever is staged turns the new case red on an assertion, and is reverted.

### Task 2: Pin a staged DAC correction edit lighting the Matrix engine drawer's discard

- **Files:** tests/js/store/faceplate/drawer-family.test.js
- **Reads:** hqptuner/static/store/faceplate/drawer.js#FAMILY_KEYS, hqptuner/static/store/faceplate/drawer.js#discardDrawer, tests/js/store/faceplate/drawer-family.test.js#MEMBER_EDITS
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawer-family.test.js
- **Action:** Behavior: a staged DAC correction edit makes the discard of the Matrix engine drawer itself live, read through the shipped Matrix engine drawer's schema rather than the file's fixture member. The existing `dac_correction` entry of `MEMBER_EDITS` lights the fixture's apply group; check whether it already pins the real drawer's discard before adding a case.
- **Verify:** The drawer-family file passes under the plan's gate. Dropping `dac_correction_enabled` and `dac_correction_profile` from the matrix family's keys turns the DAC correction case red on an assertion, and is reverted.

### Task 3: Pin a restart row left out by when leaving its tab live

- **Files:** tests/js/store/faceplate/drawer-grammar.test.js
- **Reads:** hqptuner/static/store/faceplate/drawer/grammar.js#rowShown, hqptuner/static/store/faceplate/drawer/grammar.js#shownKeys, tests/js/store/faceplate/drawer-grammar.test.js#test_a_restart_row_kept_in_by_when_makes_its_tab_a_restart_tab
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawer-grammar.test.js#test_a_restart_row_kept_in_by_when_makes_its_tab_a_restart_tab
- **Action:** Behavior: a tab whose only restart row is left out by its `when` is a live tab, not a restart tab. The existing "kept in by when" case is the contrast; the wrong implementation it kills reads restart keys off every row the schema declares, shown or not.
- **Verify:** The drawer-grammar file passes under the plan's gate. Making `shownKeys` ignore `when` turns the new case red on an assertion, and is reverted.

### Task 4: Pin an own form's apply not also posting the staged set

- **Files:** tests/js/store/faceplate/drawer-grammar.test.js
- **Reads:** hqptuner/static/store/faceplate/drawer.js#applyDrawer, hqptuner/static/store/faceplate/drawer.js#runApply, tests/js/store/faceplate/drawer-grammar.test.js#ownForm
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawer.test.js#test_the_apply_mode_posts_the_staged_set_without_a_save
- **Action:** Behavior: applying a drawer that has its own form writes through that form and sends no POST of the staged set (the apply route `runApply` uses), even while the shared buffer holds an edit. The wrong implementation it kills applies the own form and then the staged set too. Observe the POST at the wire fake; the form's own apply is observed through what the fixture form records, which is the form the test hands in, not a store function.
- **Verify:** The drawer-grammar file passes under the plan's gate. Changing `applyDrawer` to run the own form's apply and then `runApply()` turns the new case red on an assertion, and is reverted.

### Task 5: Pin a multi-tab drawer's title carrying no dot

- **Files:** tests/js/store/faceplate/drawer.test.js
- **Reads:** hqptuner/static/store/faceplate/drawer.js#drawerHead, tests/js/store/faceplate/drawer.test.js#twoTabs, tests/js/store/faceplate/drawer.test.js#test_the_dot_goes_on_the_title_of_a_one_tab_drawer
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawer.test.js#test_the_dot_goes_on_the_title_of_a_one_tab_drawer
- **Action:** Behavior: with an edit staged on one of its tabs, a drawer of two or more tabs carries the dot on that tab and none on its title. The one-tab title case is the contrast; the wrong implementation it kills puts the dot on the title whenever any tab is dirty.
- **Verify:** The drawer test file passes under the plan's gate. Dropping the `drawer.tabs.length === 1` operand of `titleDot` turns the new case red on an assertion, and is reverted.

### Task 6: Pin a row's question belonging to its own drawer only

- **Files:** tests/js/store/faceplate/drawer.test.js
- **Reads:** hqptuner/static/store/faceplate/drawer.js#drawerQuestion, hqptuner/static/store/ask.js, tests/js/store/faceplate/drawer.test.js#test_the_apply_time_question_belongs_to_every_drawer
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/drawer.test.js#test_the_apply_time_question_belongs_to_every_drawer
- **Action:** Behavior: a question a row's key asked is pinned under the drawer holding that key and under no other drawer. The apply-time question belonging to every drawer is the contrast; the wrong implementation it kills treats every open question as every drawer's.
- **Verify:** The drawer test file passes under the plan's gate. Making `drawerQuestion` return every open question turns the new case red on an assertion, and is reverted. `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0.
