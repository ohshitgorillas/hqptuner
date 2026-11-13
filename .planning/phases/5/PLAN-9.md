---
phase: 5
plan: 9
requirements: [TEST-01]
files:
  - tests/js/store/faceplate/switcher.test.js
  - tests/js/store/faceplate/view.test.js
---

# Phase 5: Untested behaviors covered - Plan 9: Switcher and view stores

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the switcher and view claims of the "faceplate stores" bullet. The list claims of the "list, page and settings stores" bullet are Plan 16's, its page claims Plan 15's, and its hardware draft claims Plan 17's.

## Must be true when done

- The switcher reads a null variant for a name with no variant, the not-running chain's slot off under Output mode, nothing opened by a slot list under Volume, `sw` empty under a non-Volume target, and an exact post count in the unsettled-tap scenarios.
- Escape closes a popover first then the setup panel, the setup panel over a drawer, and a list over a drawer.
- Each new test was seen red against a deliberate break, the break reverted, and no existing assertion line changed.

## Context

- D-02 / AC3 bite protocol for every task: apply the named break to the source line, run the test file, see each new test fail on an assertion (an import or collection error is no bite), revert, and confirm `git diff --quiet -- <source>`. The commit message lists each break and the test it turned red.
- D-01: a negative claim gets a test only when it fails against a named plausible wrong implementation; with none, write no test and stop with the claim as an owner strike candidate. Already covered: where an existing test already turns red under the named break, add no duplicate (rule 12); record that test and its red run as the claim's coverage.
- D-10 and `docs/spec/testing.md` (read it first): one assertion per test; fakes at the wire (POSTs counted at the wire fake, never by stubbing a store function); module-level signals reset every case; jscpd at 2.3%: reuse each file's own fixtures.
- Every task's gate: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <file>` and `scripts/gate.sh npx eslint <file>` print exit=0, and `git diff -U0 -- <file>` removes no line holding an assertion (AC4).

## Tasks

### Task 1: Pin a slot naming no variant reading a null variant

- **Files:** tests/js/store/faceplate/switcher.test.js
- **Reads:** hqptuner/static/store/faceplate/bottom/switcher.js#switcherView, hqptuner/static/store/faceplate/bottom/switcher.js#slotList
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/switcher.test.js
- **Action:** Behavior: a slot holding a name with no variant reads a null variant; a name with one is the contrast. The wrong implementation it kills is a variant defaulted to the family name.
- **Verify:** The switcher store file passes under the plan's gate. Making the slot breakdown return `variant: ""` for a name with none turns the new case red on an assertion, and is reverted.

### Task 2: Pin the not-running chain's slot reading off under Output mode

- **Files:** tests/js/store/faceplate/switcher.test.js
- **Reads:** hqptuner/static/store/faceplate/bottom/switcher.js#modeSlots, hqptuner/static/store/faceplate/bottom/switcher.js#setSwitcherTarget
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/switcher.test.js
- **Action:** Behavior: under the Output mode target, the slot of the chain that is not running reads off; the running chain's reads on (the contrast). The wrong implementation it kills is every chain's slot on.
- **Verify:** The switcher store file passes under the plan's gate. Making `modeSlots` set every slot on (its `on = run === m.wire` read replaced by `true`) turns the new case red on an assertion, and is reverted. The on/off is computed in `modeSlots`, not in `slotLive`, which is the tap handler and reads no running chain.

### Task 3: Pin a slot list under Volume opening nothing

- **Files:** tests/js/store/faceplate/switcher.test.js
- **Reads:** hqptuner/static/store/faceplate/bottom/switcher.js#slotList, hqptuner/static/store/faceplate/bottom/switcher.js#setSwitcherTarget
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/switcher.test.js
- **Action:** Behavior: a slot list under the Volume target opens nothing. The wrong implementation it kills is a Volume slot list opening the last list.
- **Verify:** The switcher store file passes under the plan's gate. Making the slot list open its list under Volume turns the new case red on an assertion, and is reverted.

### Task 4: Pin plateBottom's sw empty under any target but Volume

- **Files:** tests/js/store/faceplate/switcher.test.js
- **Reads:** hqptuner/static/store/faceplate/bottom/switcher.js#plateBottom, hqptuner/static/store/faceplate/bottom/switcher.js#setSwitcherTarget
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/switcher.test.js
- **Action:** Behavior: under any target but Volume, `plateBottom`'s `sw` is empty; Volume's `"volume"` is the contrast. The wrong implementation it kills is `sw` set for every target.
- **Verify:** The switcher store file passes under the plan's gate. Making `plateBottom` return `"volume"` for every target turns the new case red on an assertion, and is reverted.

### Task 5: Pin the exact post count in the unsettled-tap scenarios

- **Files:** tests/js/store/faceplate/switcher.test.js
- **Reads:** hqptuner/static/store/faceplate/bottom/switcher.js#slotLive, hqptuner/static/store/faceplate/bottom/switcher.js#setSlot, hqptuner/static/store/faceplate/page/profile.js#profileUnsettled
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/switcher.test.js
- **Action:** Behavior: in the file's unsettled-tap scenarios (a tap on a slot already on while its path is unsettled, a repeated tap before the first settles), the switcher posts exactly as many writes as the scenario owes; the count is the assertion and it differs between scenarios, so a table of scenarios is one surface with distinct expected values (rule 10). Count at the wire fake. The wrong implementations: a tap on an "on" slot posting again while unsettled, and an unsettled tap swallowed.
- **Verify:** The switcher store file passes under the plan's gate. Breaks, each alone: dropping the `!unsettled(v.target)` operand from `slotLive`'s guard (`switcher.js`, the `s.on && !unsettled(v.target)` clause), and making that guard refuse every "on" slot; `pickId` is only the anchor id and holds no guard; each turns at least one scenario's count red on an assertion and is reverted.

### Task 6: Pin Escape's close order

- **Files:** tests/js/store/faceplate/view.test.js
- **Reads:** hqptuner/static/store/faceplate/view.js#closeTop, hqptuner/static/store/faceplate/view.js#panelOpen, hqptuner/static/store/faceplate/view.js#openList
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/store/faceplate/view.test.js
- **Action:** Three behaviors of `closeTop`: with the setup panel open over a drawer, Escape closes the panel and leaves the drawer; with a popover open over the panel, the first Escape closes the popover and the second the panel; with a list open over a drawer, Escape closes the list and leaves the drawer. Each case reads what is still open after the press; the wrong implementations are each pair of branches swapped.
- **Verify:** The view store file passes under the plan's gate. Breaks, each alone: swapping the popover and panel branches of `closeTop`; swapping the list and drawer branches; closing the drawer before the panel. Each turns its case red on an assertion and is reverted. `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0.
