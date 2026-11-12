---
phase: 5
plan: 5
requirements: [TEST-01]
files:
  - tests/js/store/meter/feed.test.js
  - tests/js/store/meter/loop.test.js
  - tests/js/store/prefs/prefs-rangebuttons.test.js
  - tests/js/store/prefs/prefs-rangebuttons-load.test.js
  - tests/js/store/fixed-volume-readings.test.js
  - tests/js/store/guards/shaperfit-alerts.test.js
  - tests/js/components/faceplate-page/meter-rangebuttons.test.js
  - tests/js/components/faceplate-page/meter.test.js
---

# Phase 5: Untested behaviors covered - Plan 5: Meter, preferences, guards and the page's range buttons

## Goal

Every behavior on `todo.txt`'s triaged "untested behaviors" list is covered by a test, or struck from the list. This plan covers the "narrowing, prefs, meter, guards" bullet (less its two struck claims and its one already-covered claim) and the "page (components)" bullet.

## Must be true when done

- `meterFeedOpen` reads false once metering is switched off, and a test fails when it stays true.
- Before the feed covers a 0.1 s delay, a paint hands the painters a scene with nothing in it, pinned at the meter loop's frame contract.
- A stored range-buttons choice is in force when the preferences module loads, and `setRangeButtons` moves the `rangeButtons` signal.
- The Range tab stops graying once Manual is off under an unchecked Auto headroom box.
- In source mode with no chain loaded, the shaper fit raises no third alert beside its SDM and PCM ones, or that claim goes to the owner as a strike candidate.
- Hidden range buttons draw none; Wider is not dimmed below the widest range and Narrower not dimmed above the narrowest.

## Context

- D-02 / AC3 bite protocol for every task: apply the named break to the source line, run the test file, see each new test fail on an assertion (an import or collection error is no bite), revert, and confirm `git diff --quiet -- <source>`. The commit message lists each break and the test it turned red.
- D-01: a negative claim gets a test only when it fails against a named plausible wrong implementation; with none, write no test and stop with the claim as an owner strike candidate. Already covered: where an existing test already turns red under the named break, add no duplicate (rule 12); record that test and its red run as the claim's coverage, in the commit message or, when nothing is committed, the plan summary.
- D-09: the 0.1 s trace claim is pinned at `store/meter/loop.js`'s frame contract, never at the painters' trace drawing, so Phase 7 does not rewrite it. D-03: "an idle or stopped loop queues no frame" is already covered and is Plan 19's bite check, not this plan's. D-05: "pref off returns options in input order, exactly three" and "shaperfit source mode lists SDM before PCM" are struck; nothing here tests them.
- D-10 and `docs/spec/testing.md` (read it first): one assertion per test, fakes at the wire, rendered output asserted by state-bearing classes, attributes and `data-*` only (rule 9); jscpd at 2.3%: repeated setup is factored into a helper in the same file.
- Every task's gate: `scripts/gate.sh node --import ./tests/js/support/vendor-resolve.js --test <file>` and `scripts/gate.sh npx eslint <file>` print exit=0, and `git diff -U0 -- <file>` removes no line holding an assertion (AC4).

## Tasks

### Task 1: Pin meterFeedOpen reading false while metering is off

- **Files:** tests/js/store/meter/feed.test.js
- **Reads:** hqptuner/static/store/meter/feed.js#meterFeedOpen, hqptuner/static/store/meter/feed.js#closeMeterFeed, hqptuner/static/store/meter/feed.js#initMeterFeed
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/store/meter/feed.test.js#test_meter_feed_open_is_true_while_metering_runs, tests/js/store/meter/feed.test.js#test_metering_switched_off_closes_the_stream
- **Action:** Behavior: once metering is switched off, `meterFeedOpen` reads false. The existing "true while metering runs" case is the contrast; the wrong implementation this kills closes the stream but leaves the flag up.
- **Verify:** The feed test file passes under the plan's gate. Removing the line in `closeMeterFeed` that sets `meterFeedOpen` false turns the new case red on an assertion, and is reverted.

### Task 2: Pin an empty scene before the feed covers a 0.1 s delay

- **Files:** tests/js/store/meter/loop.test.js
- **Reads:** hqptuner/static/store/meter/loop.js#onMeterPaint, hqptuner/static/store/meter/loop.js#initMeterLoop, hqptuner/static/model/gauges/playhead.js#pacePaint, tests/js/store/meter/loop.test.js#DELAYS_S
- **Decisions:** D-02, D-04, D-09, D-10
- **Pins:** tests/js/store/meter/loop.test.js
- **Action:** Behavior: with a 0.1 s delay, a paint before the queued frames reach that far back hands every painter subscribed through `onMeterPaint` a scene that shows no frame (nothing heard), so no trace can draw; the wrong implementation it kills shows the newest frame at once, ignoring the delay. Observe the scene a subscribed painter is handed, never a painter's drawing (D-09).
- **Verify:** The loop test file passes under the plan's gate. Making the loop's decision ignore `effectiveDelay` (a delay of 0 always) turns the new case red on an assertion, and is reverted.

### Task 3: Pin the range-buttons choice stored before load being the one in force

- **Files:** tests/js/store/prefs/prefs-rangebuttons.test.js, tests/js/store/prefs/prefs-rangebuttons-load.test.js
- **Reads:** hqptuner/static/store/ui/prefs.js#rangeButtons, hqptuner/static/store/ui/prefs.js#loadBool, tests/js/store/prefs/prefs-rangebuttons.test.js, tests/js/support/vendor-resolve.js
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/store/prefs/prefs-rangebuttons.test.js
- **Action:** Behavior: a range-buttons choice already stored when the module first loads is the one in force (shown stored, shown read; the default is hidden, `loadBool(K_RANGE_BUTTONS, false)`, so a stored-hidden case cannot tell a stored read from the default and is not the bite case). The module reads its keys once at import, so the load-time case needs storage seeded before an import of its own: either a separate test file (declared here) or the `<name>.fresh-<tag>.js` convention `tests/js/support/vendor-resolve.js` provides; never a `?v=` query, which destroys the file's coverage (`docs/spec/testing.md` harness facts). The test writer chooses; an unused declared file is left uncreated.
- **Verify:** Each touched file passes under the plan's gate. Initializing `rangeButtons` to a constant instead of the stored read turns the load case red on an assertion, and is reverted.

### Task 4: Pin setRangeButtons moving the rangeButtons signal

- **Files:** tests/js/store/prefs/prefs-rangebuttons.test.js
- **Reads:** hqptuner/static/store/ui/prefs.js#setRangeButtons, hqptuner/static/store/ui/prefs.js#rangeButtons, tests/js/store/prefs/prefs-rangebuttons.test.js
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/store/prefs/prefs-rangebuttons.test.js
- **Action:** Behavior: `setRangeButtons` moves the `rangeButtons` signal, not only the storage. The wrong implementation it kills writes storage and leaves the signal where it was.
- **Verify:** The prefs-rangebuttons file passes under the plan's gate. Making `setRangeButtons` write storage without assigning the signal turns the new case red on an assertion, and is reverted.

### Task 5: Pin the Range tab's gray lifting once Manual is off under unchecked Auto headroom

- **Files:** tests/js/store/fixed-volume-readings.test.js
- **Reads:** hqptuner/static/store/faceplate/drawers/volume.js#fixedMode, hqptuner/static/store/faceplate/drawers/volume.js#RANGE_KEYS, hqptuner/static/store/schema/gray.js, tests/js/store/fixed-volume-readings.test.js#uncheckAutoHeadroom
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/store/fixed-volume-readings.test.js#test_unchecking_auto_headroom_over_a_running_manual_moves_the_drawers_line_to_manual
- **Action:** Behavior the file header states: the Range tab grays while Fixed volume is not Off, and it reads the staged edit by the same rule the drawer's line does. With Auto headroom unchecked over a running Auto headroom and Manual off, Fixed volume is Off, so the Range tab is not grayed; the wrong implementation it kills reads the bare-bool unchecked box as still on (the spelling hazard the header describes). Use the file's `uncheckAutoHeadroom` helper; read the gray through the store surface the Range tab reads, not through the component.
- **Verify:** The fixed-volume-readings file passes under the plan's gate. Making the Range tab's gray read Auto headroom by `"0"` only, so a bare `false` counts as on, turns the new case red on an assertion, and is reverted.

### Task 6: Pin the shaper fit raising no third alert in source mode

- **Files:** tests/js/store/guards/shaperfit-alerts.test.js
- **Reads:** hqptuner/static/store/alerts/shaperfit.js#shaperAlerts, tests/js/store/guards/shaperfit-alerts.test.js#test_with_no_chain_loaded_source_mode_reports_the_sdm_conflict
- **Decisions:** D-01, D-02, D-05, D-10
- **Pins:** tests/js/store/guards/shaperfit-alerts.test.js
- **Action:** Behavior: in source mode with no chain loaded and both families conflicting, the shaper fit raises its SDM and its PCM alert and nothing more. This is a negative claim (D-01): it gets a test only if the executor names a plausible wrong implementation it kills (for example a source-mode branch that raises a family's alert once per chain it judges against); with none, write no test and stop with the claim as an owner strike candidate. Its struck sibling, "lists SDM before PCM", is not tested: assert no order.
- **Verify:** Either the shaperfit-alerts file passes under the plan's gate with the new case red under the named break (reverted), or no test is added and the claim is recorded as an owner strike candidate in the plan summary.

### Task 7: Pin hidden range buttons drawing none

- **Files:** tests/js/components/faceplate-page/meter-rangebuttons.test.js
- **Reads:** hqptuner/static/store/ui/prefs.js#rangeButtons, tests/js/components/faceplate-page/meter-rangebuttons.test.js#test_shown_range_buttons_draw_both
- **Decisions:** D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-page/meter-rangebuttons.test.js#test_shown_range_buttons_draw_both
- **Action:** Behavior: with the range-buttons preference off, the page's spectrum renders no range button. The existing "shown draw both" case is the contrast that makes the count discriminating.
- **Verify:** The meter-rangebuttons file passes under the plan's gate. Making the meter component render its range buttons regardless of `rangeButtons` turns the new case red on an assertion, and is reverted.

### Task 8: Pin the range buttons' dimming at the ends of the range list

- **Files:** tests/js/components/faceplate-page/meter-rangebuttons.test.js, tests/js/components/faceplate-page/meter.test.js
- **Reads:** hqptuner/static/store/ui/prefs.js#METER_RANGES, tests/js/components/faceplate-page/meter-rangebuttons.test.js
- **Decisions:** D-01, D-02, D-04, D-10
- **Pins:** tests/js/components/faceplate-page/meter-rangebuttons.test.js
- **Action:** Behaviors: Wider is not dimmed at any range below the widest, and Narrower is not dimmed at any range above the narrowest. These are negative claims; the plausible wrong implementations they kill are a button dimmed whenever the range is not at its middle, and the two ends swapped (Wider dimmed at the narrowest). If the dimming at the ends themselves is not already pinned, the pair needs it as its contrast; check before adding. Find each button by its `data-*` or `data-testid` hook, never by its label.
- **Verify:** The touched file passes under the plan's gate. Swapping the two buttons' end conditions turns the new cases red on an assertion, and is reverted. `PYTHONPATH=$(pwd) scripts/gate.sh make check` prints exit=0.

## Notes

- Task 6's reading of the struck bullet: D-05 strikes "shaperfit source mode lists SDM before PCM"; the bullet's "and raises no third row" is read as still on the list, so it is either covered under D-01 or raised as a strike candidate.
